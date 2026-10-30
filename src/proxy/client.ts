import http2, { type ClientHttp2Stream, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http2';
import { setTimeout as sleep } from 'node:timers/promises';
import pThrottle from 'p-throttle';
import logging from '../logging/index.ts';
import { Encryptor } from '../crypto/index.ts';
import type { Settings } from '../settings/index.ts';
import { createProxyAuthHeader } from './auth.ts';
import { ProxySession, type Connect, type SessionHooks } from './session.ts';
import { ProxyRequestError, ResumeProcessingFailedError, isRetryable } from './errors.ts';
import {
    HEADER_ROUTING_KEY, MESSAGE_METADATA_HEADER, decodeMessage, encodingFor, extractMessageMetadata,
    lowerCaseKeys, type DecodedMessage, type MessageMetadata
} from './codec.ts';

const {
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_METHOD,
    HTTP2_HEADER_AUTHORIZATION,
    HTTP2_HEADER_CONTENT_LENGTH,
    NGHTTP2_NO_ERROR
} = http2.constants;

export const MESSAGE_PROCESSING_STATUS = {
    SUCCESS: 'success',
    ERROR: 'error'
} as const;
export type MessageProcessingStatus = typeof MESSAGE_PROCESSING_STATUS[keyof typeof MESSAGE_PROCESSING_STATUS];

export type OutgoingMessageType = 'data' | 'error' | 'rebound' | 'snapshot' | 'http-reply' | 'pub-sub';
type ThrottledType = 'data' | 'error' | 'snapshot';

/** Metadata sent with an outgoing message in the `message-metadata` header. */
export type OutgoingMetadata = Record<string, unknown>;

export interface OutgoingData {
    headers?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface SendMessageOptions {
    incomingMessageId?: string;
    type: OutgoingMessageType;
    /** An object is encrypted when a protocol version applies; a string is sent as is. */
    data?: OutgoingData | string | null;
    metadata: OutgoingMetadata;
    forceProtocolVersion?: number;
}

export type MessageHandler = (metadata: MessageMetadata, message: DecodedMessage) => Promise<void>;

export interface ProxyClientOptions {
    encryptor?: Encryptor;
    connect?: Connect;
    /** B6: called with ResumeProcessingFailedError. Defaults to criticalErrorAndExit. */
    onFatalError?: SessionHooks['onFatalError'];
}

interface ReceivedMessage {
    headers: IncomingHttpHeaders;
    body: Buffer;
}

/**
 * Typed endpoints of the sailor proxy (GET/POST /message, /finish-processing, /resume-processing),
 * with outgoing size check, per-type throttling and retries.
 */
export class ProxyClient {
    readonly #settings: Settings;
    readonly #encryptor: Encryptor;
    readonly #session: ProxySession;
    readonly #authHeader: string;
    readonly #getMessageStreams = new Set<ClientHttp2Stream>();
    readonly #processingMessagesMetadata = new Set<MessageMetadata>();
    #listening = true;
    #throttleAbort = new AbortController();
    #throttles: Record<ThrottledType, () => Promise<void>>;

    constructor(settings: Settings, options: ProxyClientOptions = {}) {
        this.#settings = settings;
        this.#encryptor = options.encryptor
            ?? new Encryptor(settings.MESSAGE_CRYPTO_PASSWORD, settings.MESSAGE_CRYPTO_IV);
        this.#authHeader = createProxyAuthHeader(settings);
        this.#session = new ProxySession(settings, {
            onDisconnect: () => this.#cleanupMessageStreams(),
            onReconnect: () => this.resumeProcessing(),
            onFatalError: options.onFatalError
        }, options.connect);
        this.#throttles = this.#createThrottles();
    }

    isHealthy(): boolean {
        return this.#session.isHealthy();
    }

    isConnected(): boolean {
        return this.#session.isConnected();
    }

    connect(): Promise<void> {
        return this.#session.connect();
    }

    async disconnect(): Promise<void> {
        // Reject pending throttled sends so their timers don't fire after the session is gone.
        this.#throttleAbort.abort();
        this.#throttles = this.#createThrottles();
        await this.#session.disconnect();
    }

    async listenForMessages(handler: MessageHandler): Promise<void> {
        while (this.#listening) {
            try {
                logging.debug('Starting to listen for messages from proxy');
                await this.#session.ensureConnection();
                const prefetch = this.#settings.PROXY_PREFETCH_SAILOR;
                await Promise.all(Array.from({ length: prefetch }, () => this.#receiveOne(prefetch, handler)));
            } catch (err) {
                logging.error(err, 'Error while listening for messages');
                if (this.#session.closed) {
                    logging.debug('Connection closed, stopping message listener');
                    break;
                }
                this.#cleanupMessageStreams();
            } finally {
                if (this.#session.closed || !this.#listening) {
                    logging.debug('Cleaning up message streams on exit');
                    this.#cleanupMessageStreams();
                }
            }
        }
    }

    async stopListeningForMessages(): Promise<void> {
        logging.debug('Stopping listening for messages');
        await Promise.all(Array.from(this.#getMessageStreams, stream => {
            if (stream.closed || stream.destroyed) {
                logging.debug({ closed: stream.closed, destroyed: stream.destroyed },
                    'Message stream is already closed or destroyed');
                return undefined;
            }
            return new Promise<void>(resolve => stream.close(NGHTTP2_NO_ERROR, () => {
                logging.debug('Closed message stream');
                resolve();
            }));
        }));
        this.#listening = false;
    }

    async sendMessage({ incomingMessageId, type, data, metadata, forceProtocolVersion }: SendMessageOptions)
        : Promise<void> {
        const throttle = this.#throttles[type as ThrottledType];
        if (throttle) {
            logging.debug({ incomingMessageId, type, metadata }, 'Applying rate limiting for message send');
            await throttle();
        }

        const headers = typeof data === 'object' && data?.headers ? lowerCaseKeys(data.headers) : {};
        const customRoutingKey = headers[HEADER_ROUTING_KEY] as string | undefined;

        logging.debug({ incomingMessageId, type, metadata, customRoutingKey, forceProtocolVersion },
            'Sending message to proxy');
        logging.trace({ data }, 'Message data to send to proxy');
        const { preparedMetadata, preparedData } = this.#prepareData(data, metadata, type, forceProtocolVersion);
        const preparedDataSize = preparedData?.length ?? 0;
        logging.debug({ preparedMetadata, preparedDataSize }, 'Prepared message for sending to proxy');

        // Checked here rather than relying on the proxy's 413: an oversized request hits the
        // session's maxSessionMemory and fails with NGHTTP2_ENHANCE_YOUR_CALM, which blocks every
        // later request until the session is re-established.
        const limit = this.#settings.OUTGOING_MESSAGE_SIZE_LIMIT;
        if (preparedDataSize > limit) {
            logging.error({ preparedDataSize, messageSizeLimit: limit }, 'Outgoing message size exceeds limit');
            throw new Error(`Outgoing message size ${preparedDataSize} exceeds limit of ${limit}`);
        }

        const query = new URLSearchParams({
            ...(incomingMessageId !== undefined ? { incomingMessageId } : {}),
            type,
            ...(customRoutingKey ? { customRoutingKey } : {})
        });
        await this.#post('Send message', `/message?${query}`, preparedData, {
            [HTTP2_HEADER_CONTENT_LENGTH]: preparedDataSize,
            [MESSAGE_METADATA_HEADER]: JSON.stringify(preparedMetadata)
        });
    }

    async finishProcessing(metadata: MessageMetadata, status: MessageProcessingStatus): Promise<void> {
        if (!Object.values(MESSAGE_PROCESSING_STATUS).includes(status)) {
            throw new Error(`Invalid message processing status: ${status}`);
        }
        const incomingMessageId = metadata.messageId ?? '';
        logging.debug({ incomingMessageId, status }, 'Finishing processing of message');
        const query = new URLSearchParams({ incomingMessageId, status });
        await this.#post('Finish processing', `/finish-processing?${query}`);
        if (!this.#processingMessagesMetadata.has(metadata)) {
            logging.warn({ metadata }, 'Finished processing message that is not tracked as being processed');
        }
        this.#processingMessagesMetadata.delete(metadata);
    }

    /** Claims the in-flight messages back after a reconnect. Throws ResumeProcessingFailedError on non-200. */
    async resumeProcessing(): Promise<void> {
        const messages = Array.from(this.#processingMessagesMetadata);
        logging.debug({ numberOfMessages: messages.length },
            'Resuming processing of in-flight messages after reconnection');
        if (messages.length === 0) {
            logging.debug('No in-flight messages to resume');
            return;
        }
        const body = messages.map(metadata => ({
            messageId: metadata.messageId,
            stepId: this.#settings.STEP_ID,
            taskId: this.#settings.FLOW_ID
        }));
        logging.debug({ body }, 'Request body for resuming processing');
        await this.#post('Resume processing', '/resume-processing', Buffer.from(JSON.stringify(body)), {},
            (statusCode, responseBody) => new ResumeProcessingFailedError(statusCode, responseBody));
        logging.debug('Successfully resumed processing of in-flight messages');
    }

    encryptMessageContent(body: unknown, protocolVersion = 1): Buffer {
        logging.debug({ protocolVersion }, 'Encrypting message content with protocol version');
        return this.#encryptor.encryptMessageContent(body, encodingFor(protocolVersion));
    }

    async sendError(err: Error, outgoingMetadata: OutgoingMetadata, originalMessage?: unknown,
        metadata?: MessageMetadata): Promise<void> {
        const payload: { error: string; errorInput?: string } = {
            error: this.#encryptor.encryptMessageContent({
                name: err.name,
                message: err.message,
                stack: err.stack
            }, 'base64').toString()
        };
        if (originalMessage) {
            // errorInput is always base64, whatever the protocol version.
            payload.errorInput = this.#encryptor.encryptMessageContent(originalMessage, 'base64').toString();
        }
        await this.sendMessage({
            incomingMessageId: metadata?.messageId,
            type: 'error',
            data: JSON.stringify(payload),
            metadata: outgoingMetadata
        });
    }

    async sendRebound(reboundError: Error, metadata: MessageMetadata | undefined,
        outgoingMetadata: OutgoingMetadata): Promise<void> {
        outgoingMetadata.end = Date.now();
        outgoingMetadata.reboundReason = reboundError.message;
        await this.sendMessage({
            type: 'rebound',
            metadata: outgoingMetadata,
            incomingMessageId: metadata?.messageId
        });
    }

    async sendSnapshot(data: unknown, metadata: OutgoingMetadata): Promise<void> {
        await this.sendMessage({
            type: 'snapshot',
            data: JSON.stringify(data),
            metadata
        });
    }

    #createThrottles(): Record<ThrottledType, () => Promise<void>> {
        const s = this.#settings;
        this.#throttleAbort = new AbortController();
        const make = (limit: number) => pThrottle({
            limit,
            interval: s.RATE_INTERVAL,
            signal: this.#throttleAbort.signal
        })(async () => undefined);
        return {
            data: make(s.DATA_RATE_LIMIT),
            error: make(s.ERROR_RATE_LIMIT),
            snapshot: make(s.SNAPSHOT_RATE_LIMIT)
        };
    }

    #prepareData(data: SendMessageOptions['data'], metadata: OutgoingMetadata, type: OutgoingMessageType,
        forceProtocolVersion?: number): { preparedMetadata: OutgoingMetadata; preparedData: Buffer | null } {
        let protocolVersion: number | undefined;
        if (forceProtocolVersion) {
            protocolVersion = forceProtocolVersion;
        } else if (type === 'data') {
            protocolVersion = this.#settings.PROTOCOL_VERSION;
        } else if (type === 'http-reply') {
            protocolVersion = 1;
        }

        const preparedMetadata = { ...metadata };
        if (!data) {
            delete preparedMetadata.protocolVersion;
            return { preparedMetadata, preparedData: null };
        }

        let payload: OutgoingData | string = data;
        if (typeof payload === 'object' && payload.headers) {
            // The routing key travels as a query param, not inside the message.
            payload = {
                ...payload,
                headers: Object.fromEntries(Object.entries(payload.headers)
                    .filter(([key]) => key.toLowerCase() !== HEADER_ROUTING_KEY))
            };
        }
        if (protocolVersion) {
            preparedMetadata.protocolVersion = protocolVersion;
            return { preparedMetadata, preparedData: this.encryptMessageContent(payload, protocolVersion) };
        }
        delete preparedMetadata.protocolVersion;
        return {
            preparedMetadata,
            preparedData: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))
        };
    }

    async #receiveOne(prefetch: number, handler: MessageHandler): Promise<void> {
        logging.debug({ prefetch }, 'Requesting message from proxy');
        const stream = this.#session.request({
            [HTTP2_HEADER_PATH]: `/message?${new URLSearchParams({ prefetch: String(prefetch) })}`,
            [HTTP2_HEADER_METHOD]: 'GET',
            [HTTP2_HEADER_AUTHORIZATION]: this.#authHeader
        });
        this.#getMessageStreams.add(stream);
        try {
            const received = await this.#readMessage(stream);
            if (!received) {
                // Closed without a message (e.g. 204: duplicate delivery); request the next one.
                return;
            }
            const metadata = extractMessageMetadata(received.headers);
            const message = decodeMessage(this.#encryptor, received.body, metadata, this.#settings.INPUT_FORMAT);
            logging.debug({ messageMetadata: metadata, message }, 'Processing received message');
            this.#processingMessagesMetadata.add(metadata);
            await handler(metadata, message);
        } finally {
            this.#getMessageStreams.delete(stream);
            if (!stream.closed && !stream.destroyed) {
                try {
                    stream.destroy();
                } catch (err) {
                    logging.debug({ err }, 'Error closing message stream');
                }
            }
        }
    }

    #readMessage(stream: ClientHttp2Stream): Promise<ReceivedMessage | null> {
        return new Promise((resolve, reject) => {
            stream.on('response', (headers, flags) => {
                logging.debug({ headers, flags }, 'Connected to message stream');
                const status = headers[':status'];
                const chunks: Buffer[] = [];
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                if (status === 204) {
                    logging.debug('Received empty message stream, closing stream and going to request again');
                    stream.close(NGHTTP2_NO_ERROR);
                    return;
                }
                if (status !== 200) {
                    logging.error({ headers }, 'Failed to get message');
                }
                stream.on('end', () => {
                    logging.debug('Message stream ended by server');
                    const body = Buffer.concat(chunks);
                    if (status === 200) {
                        logging.debug({ messageId: headers.messageId, messageSize: body.length },
                            'Received complete message from server');
                        logging.trace({ body: body.toString() }, 'Message body as string');
                        resolve({ headers, body });
                    } else {
                        reject(new ProxyRequestError(
                            body.toString() || `Failed to get message, status code: ${status}`,
                            { statusCode: status }
                        ));
                    }
                });
            });
            stream.on('close', () => {
                const isConnected = this.isConnected();
                logging.warn({ rstCode: stream.rstCode, isConnected }, 'Message stream closed by server');
                if (!isConnected) {
                    logging.warn('Message stream closed due to lost connection, will retry on next reconnection');
                    reject(new ProxyRequestError('Message stream closed due to lost connection',
                        { isNetworkError: true }));
                } else if (stream.rstCode !== NGHTTP2_NO_ERROR) {
                    reject(new ProxyRequestError(`Message stream closed with error, rstCode: ${stream.rstCode}`));
                } else {
                    resolve(null);
                }
            });
            stream.on('error', err => {
                logging.error(err, 'Error on message stream');
                reject(err);
            });
            stream.on('aborted', () => logging.warn('Message stream aborted by server'));
            stream.on('timeout', () => logging.warn('Message stream timeout'));
        });
    }

    /** POSTs with retries. A non-200 response becomes `toError(status, body)`. */
    #post(operation: string, path: string, body: Buffer | null = null, headers: OutgoingHttpHeaders = {},
        toError: (statusCode: number | undefined, body: string) => Error = (statusCode, responseBody) =>
            new ProxyRequestError(
                responseBody || `${operation} failed, status code: ${statusCode}`,
                { statusCode }
            )): Promise<void> {
        return this.#withRetries(operation, () => new Promise<void>((resolve, reject) => {
            const stream = this.#session.request({
                [HTTP2_HEADER_PATH]: path,
                [HTTP2_HEADER_METHOD]: 'POST',
                [HTTP2_HEADER_AUTHORIZATION]: this.#authHeader,
                ...headers
            });
            if (body) {
                stream.write(body);
            }
            stream.end();

            stream.on('response', responseHeaders => {
                const status = responseHeaders[':status'];
                logging.debug({ status }, `${operation} response`);
                const isSuccess = status === 200;
                const chunks: Buffer[] = [];
                if (!isSuccess) {
                    logging.error({ headers: responseHeaders }, `${operation} failed`);
                    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                }
                stream.on('end', () => {
                    logging.debug(`${operation} end event`);
                    if (isSuccess) {
                        resolve();
                        return;
                    }
                    const responseBody = Buffer.concat(chunks).toString('utf8');
                    logging.error({ body: responseBody, statusCode: status }, `${operation} error response body`);
                    reject(toError(status, responseBody));
                });
            });
            stream.on('error', err => {
                logging.error(err, `Error during ${operation}`);
                reject(new ProxyRequestError(err.message, { isNetworkError: true, cause: err }));
            });
            stream.on('close', () => {
                const isConnected = this.isConnected();
                logging.debug({ rstCode: stream.rstCode, isConnected }, `${operation} stream closed`);
                if (!isConnected) {
                    logging.warn(`${operation} stream closed due to lost connection, will retry on next reconnection`);
                    reject(new ProxyRequestError(`${operation} stream closed due to lost connection`,
                        { isNetworkError: true }));
                } else if (stream.rstCode !== NGHTTP2_NO_ERROR) {
                    logging.error({ rstCode: stream.rstCode }, `${operation} stream closed with error`);
                    reject(new ProxyRequestError(`${operation} stream closed with error, rstCode: ${stream.rstCode}`));
                } else {
                    resolve();
                }
            });
            stream.on('aborted', () => logging.debug(`${operation} stream aborted`));
            stream.on('timeout', () => logging.debug(`${operation} stream timeout`));
        }));
    }

    async #withRetries<T>(operation: string, requestFn: () => Promise<T>): Promise<T> {
        const s = this.#settings;
        const maxRetries = s.PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS;
        for (let attempt = 0; ; attempt++) {
            try {
                await this.#session.ensureConnection();
                const result = await requestFn();
                if (attempt > 0) {
                    logging.debug({ attempt, maxRetries }, `${operation} succeeded after retry`);
                }
                return result;
            } catch (err) {
                const e = err as { message?: string; code?: string; statusCode?: number };
                if (!isRetryable(err) || attempt >= maxRetries) {
                    logging.error({ attempt, maxRetries, error: e.message, errorCode: e.code,
                        errorStatusCode: e.statusCode }, `${operation} failed and will not be retried`);
                    throw err;
                }
                const delay = Math.min(s.PROXY_OBJECT_REQUEST_RETRY_DELAY * 2 ** attempt,
                    s.PROXY_OBJECT_REQUEST_MAX_RETRY_DELAY);
                logging.warn({ attempt, maxRetries, error: e.message, nextRetryIn: delay },
                    `${operation} failed, retrying...`);
                await sleep(delay);

                // A reconnect in progress is waited for by ensureConnection() on the next attempt.
                if (!this.isConnected() && !this.#session.reconnecting && !this.#session.closed) {
                    logging.debug('Reconnecting before retry...');
                    await this.#session.connect();
                }
            }
        }
    }

    #cleanupMessageStreams(): void {
        logging.debug({ streamCount: this.#getMessageStreams.size }, 'Cleaning up message streams');
        for (const stream of this.#getMessageStreams) {
            if (!stream.closed && !stream.destroyed) {
                try {
                    stream.destroy();
                } catch (err) {
                    logging.debug({ err }, 'Error destroying message stream');
                }
            }
        }
        this.#getMessageStreams.clear();
    }
}
