import http2, { type ClientHttp2Session, type ClientHttp2Stream, type OutgoingHttpHeaders } from 'node:http2';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import logging from '../logging/index.ts';
import type { Settings } from '../settings/index.ts';
import { ResumeProcessingFailedError } from './errors.ts';

export type SessionSettings = Pick<Settings, 'SAILOR_PROXY_URI' | 'OUTGOING_MESSAGE_SIZE_LIMIT'
    | 'PROXY_PING_INTERVAL_MS' | 'PROXY_RECONNECT_MAX_RETRIES' | 'PROXY_RECONNECT_INITIAL_DELAY'
    | 'PROXY_RECONNECT_MAX_DELAY' | 'PROXY_RECONNECT_BACKOFF_MULTIPLIER' | 'PROXY_RECONNECT_JITTER_FACTOR'>;

export type Connect = (authority: string, options: http2.ClientSessionOptions) => ClientHttp2Session;

export interface SessionHooks {
    /** Called when the connection is lost, before the reconnect is scheduled. */
    onDisconnect?(): void;
    /** Called after a successful reconnect. A throw schedules another reconnect attempt. */
    onReconnect?(): Promise<void>;
    /** Called with a ResumeProcessingFailedError thrown from `onReconnect`. */
    onFatalError?(err: Error): void;
}

/** How long a request waits for an in-progress reconnect. */
const RECONNECT_WAIT_MS = 30000;
const RECONNECT_POLL_MS = 100;

export function getJitteredDelay(baseDelay: number, jitterFactor: number): number {
    const minJitter = baseDelay * -jitterFactor;
    const maxJitter = baseDelay * jitterFactor;
    return baseDelay + Math.random() * (maxJitter - minJitter) + minJitter;
}

/** Max session memory: 1.2x the message limit in MB, but at least 10MB (the http2 default). */
export function getMaxSessionMemory(outgoingMessageSizeLimit: number): number {
    return Math.max(10, Math.ceil(outgoingMessageSizeLimit / (1024 * 1024) * 1.2));
}

/**
 * The HTTP/2 session to the sailor proxy: connect, PING keepalive, reconnect with jittered
 * exponential backoff, health.
 */
export class ProxySession {
    readonly #settings: SessionSettings;
    readonly #hooks: SessionHooks;
    readonly #connect: Connect;

    #session: ClientHttp2Session | null = null;
    #closed = true;
    #reconnecting = false;
    #reconnectAttempts = 0;
    #reconnectTimer: NodeJS.Timeout | null = null;
    #pingInterval: NodeJS.Timeout | null = null;

    constructor(settings: SessionSettings, hooks: SessionHooks = {}, connect: Connect = http2.connect) {
        this.#settings = settings;
        this.#hooks = hooks;
        this.#connect = connect;
    }

    get closed(): boolean {
        return this.#closed;
    }

    get reconnecting(): boolean {
        return this.#reconnecting;
    }

    isConnected(): boolean {
        return !this.#closed && this.#session !== null && !this.#session.destroyed;
    }

    /**
     * For K8s health checks. True while reconnecting, so transient network issues do not restart
     * the pod; false once closed on purpose or after the reconnect attempts are exhausted.
     */
    isHealthy(): boolean {
        if (this.#reconnecting && !this.#closed) {
            return true;
        }
        return this.isConnected();
    }

    async connect(): Promise<void> {
        try {
            logging.trace('connecting to http2 server');
            this.#closed = false;
            this.#reconnectAttempts = 0;
            await this.#open();
            logging.debug('Successfully connected to Sailor Proxy');
        } catch (err) {
            logging.error({ err }, 'Failed to connect to Sailor Proxy');
            throw err;
        }
    }

    async disconnect(): Promise<void> {
        this.#closed = true;
        this.#reconnecting = false;
        this.#stopPing();

        if (this.#reconnectTimer) {
            logging.debug('Clearing pending reconnection timer');
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }

        logging.debug('Disconnecting from Sailor Proxy');
        const session = this.#session;
        if (!session || session.destroyed) {
            logging.debug('Session already destroyed');
            return;
        }
        await new Promise<void>(resolve => session.close(() => resolve()));
        logging.debug('Successfully closed HTTP2 connection');
    }

    /** Resolves once there is a usable session, waiting for an in-progress reconnect. */
    async ensureConnection(): Promise<void> {
        if (this.isConnected()) {
            return;
        }
        if (this.#reconnecting) {
            logging.debug('Waiting for reconnection to complete');
            const start = Date.now();
            while ((this.#reconnecting || !this.#hasLiveSession()) && !this.#closed
                && Date.now() - start < RECONNECT_WAIT_MS) {
                await sleep(RECONNECT_POLL_MS);
            }
            if (this.#closed || !this.#hasLiveSession()) {
                throw new Error('Failed to establish valid connection within timeout period');
            }
            return;
        }
        if (this.#closed) {
            throw new Error('Connection is closed. Call connect() first.');
        }
        throw new Error('Connection lost and no reconnection in progress');
    }

    /** Opens a stream on the current session. Call `ensureConnection()` first. */
    request(headers: OutgoingHttpHeaders): ClientHttp2Stream {
        if (!this.#session) {
            throw new Error('No HTTP2 session');
        }
        return this.#session.request(headers);
    }

    #hasLiveSession(): boolean {
        return this.#session !== null && !this.#session.destroyed;
    }

    async #open(): Promise<void> {
        const maxSessionMemory = getMaxSessionMemory(this.#settings.OUTGOING_MESSAGE_SIZE_LIMIT);
        logging.debug({ maxSessionMemory }, 'Setting max session memory for http/2 server');
        const session = this.#connect(this.#settings.SAILOR_PROXY_URI, { maxSessionMemory });
        this.#session = session;
        this.#listen(session);
        // Rejects if the session emits 'error' first.
        await once(session, 'connect');
        this.#reconnectAttempts = 0;
        this.#startPing();
    }

    #listen(session: ClientHttp2Session): void {
        session.on('error', (err: Error) => {
            logging.error({ err, closed: this.#closed }, 'HTTP2 session error');
            if (!this.#closed) {
                this.#handleDisconnection('error', err);
            }
        });
        session.on('close', () => {
            logging.debug({ closed: this.#closed, reconnecting: this.#reconnecting }, 'HTTP2 session closed');
            if (!this.#closed && !this.#reconnecting) {
                logging.warn('HTTP2 session closed unexpectedly, initiating reconnection');
                this.#handleDisconnection('close');
            }
        });
        session.on('goaway', (errorCode: number, lastStreamID: number) => {
            logging.debug({ errorCode, lastStreamID, closed: this.#closed }, 'Received GOAWAY from server');
            if (!this.#closed) {
                logging.warn('Received GOAWAY frame from server, initiating reconnection');
                this.#handleDisconnection('goaway', { errorCode, lastStreamID });
            }
        });
        session.on('timeout', () => {
            logging.debug({ closed: this.#closed }, 'HTTP2 session timeout');
            if (!this.#closed) {
                logging.warn('HTTP2 session timeout, initiating reconnection');
                this.#handleDisconnection('timeout');
            }
        });
    }

    #handleDisconnection(reason: string, details?: unknown): void {
        if (this.#reconnecting || this.#closed) {
            return;
        }
        this.#stopPing();
        logging.warn({ reason, details }, 'Connection lost, initiating reconnection');
        this.#reconnecting = true;

        this.#hooks.onDisconnect?.();

        if (this.#session && !this.#session.destroyed) {
            this.#session.destroy();
        }
        this.#session = null;
        this.#scheduleReconnect();
    }

    #scheduleReconnect(): void {
        if (this.#closed) {
            logging.debug('Connection closed intentionally, skipping reconnection');
            this.#reconnecting = false;
            return;
        }
        const s = this.#settings;
        if (this.#reconnectAttempts >= s.PROXY_RECONNECT_MAX_RETRIES) {
            logging.error({ attempts: this.#reconnectAttempts }, 'Max reconnection attempts reached, giving up');
            this.#reconnecting = false;
            // Marked closed so the K8s health check fails and the pod restarts.
            this.#closed = true;
            return;
        }

        this.#reconnectAttempts++;
        const baseDelay = Math.min(
            s.PROXY_RECONNECT_INITIAL_DELAY * s.PROXY_RECONNECT_BACKOFF_MULTIPLIER ** (this.#reconnectAttempts - 1),
            s.PROXY_RECONNECT_MAX_DELAY
        );
        // Jitter avoids a thundering herd.
        const delay = getJitteredDelay(baseDelay, s.PROXY_RECONNECT_JITTER_FACTOR);
        logging.debug({ attempt: this.#reconnectAttempts, baseDelayMs: baseDelay, jitteredDelayMs: delay },
            'Scheduling reconnection attempt');

        this.#reconnectTimer = setTimeout(() => void this.#reconnect(), delay);
    }

    async #reconnect(): Promise<void> {
        this.#reconnectTimer = null;
        try {
            logging.debug({ attempt: this.#reconnectAttempts }, 'Attempting to reconnect');
            await this.#open();
            if (this.#closed) {
                // disconnect() was called while connecting: drop the new session.
                this.#stopPing();
                this.#session?.close();
                return;
            }
            logging.debug('Successfully reconnected to Sailor Proxy, going to resume processing in-flight messages');
            await this.#hooks.onReconnect?.();
            this.#reconnecting = false;
        } catch (err) {
            if (this.#closed) {
                logging.debug({ err }, 'Reconnection attempt ended after disconnect');
                this.#reconnecting = false;
                return;
            }
            if (err instanceof ResumeProcessingFailedError) {
                this.#reconnecting = false;
                if (this.#hooks.onFatalError) {
                    this.#hooks.onFatalError(err);
                    return;
                }
                logging.criticalErrorAndExit('proxy.resumeProcessing', err);
            }
            logging.error({ attempt: this.#reconnectAttempts, error: err }, 'Reconnection attempt failed');
            this.#scheduleReconnect();
        }
    }

    #startPing(): void {
        if (this.#pingInterval) {
            return;
        }
        const intervalMs = this.#settings.PROXY_PING_INTERVAL_MS;
        this.#pingInterval = setInterval(() => {
            const session = this.#session;
            if (!session || session.destroyed) {
                return;
            }
            session.ping((err, duration) => {
                if (err) {
                    logging.debug({ duration, err }, 'HTTP/2 ping failed, connection likely dead');
                    if (!this.#closed) {
                        this.#handleDisconnection('ping_timeout', err);
                    }
                }
            });
        }, intervalMs);
        logging.trace({ intervalMs }, 'Started HTTP/2 ping interval');
    }

    #stopPing(): void {
        if (this.#pingInterval) {
            clearInterval(this.#pingInterval);
            this.#pingInterval = null;
            logging.debug('Stopped HTTP/2 ping interval');
        }
    }
}
