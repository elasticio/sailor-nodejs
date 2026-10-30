import http2 from 'node:http2';
import type { Http2Server, Http2Session, ServerHttp2Stream, IncomingHttpHeaders } from 'node:http2';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Encryptor } from '../../../src/crypto/index.ts';

const MESSAGE_METADATA_HEADER = 'message-metadata';

const { HTTP2_HEADER_STATUS, HTTP2_HEADER_PATH, HTTP2_HEADER_METHOD } = http2.constants;

export interface QueuedMessageMetadata {
    messageId: string;
    threadId: string;
    parentMessageId?: string;
    protocolVersion: number;
    stepId?: string;
    reply_to?: string;
}

export interface ReceivedMessage {
    metadata: Record<string, unknown>;
    body: Buffer;
}

interface QueuedMessage {
    metadata: QueuedMessageMetadata;
    body: Buffer;
}

/**
 * A fake Sailor Proxy HTTP/2 server for integration tests.
 *
 *   GET  /message            – delivers queued messages to the sailor
 *   POST /message            – receives outgoing messages (emits `message`)
 *   POST /finish-processing  – acknowledges completion (emits `finish-processing`)
 *   POST /resume-processing  – no-op
 *   POST /object, GET /object/:id – object store (leftover endpoints, see D10)
 */
export class FakeSailorProxy extends EventEmitter {
    readonly encryptor: Encryptor;
    readonly port: number;
    server: Http2Server | null = null;
    readonly sessions = new Set<Http2Session>();
    /** Waiting to be fetched by the sailor. */
    messageQueue: QueuedMessage[] = [];
    /** GET /message streams waiting for a queued message. */
    pendingRequests: { stream: ServerHttp2Stream }[] = [];
    readonly objects = new Map<string, Buffer>();
    /** Messages received from the sailor with `type=data`. */
    readonly dataMessages: ReceivedMessage[] = [];

    constructor(encryptor: Encryptor, port: number) {
        super();
        this.encryptor = encryptor;
        this.port = port;
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const server = http2.createServer();
            this.server = server;

            server.on('session', (session) => {
                this.sessions.add(session);
                session.once('close', () => this.sessions.delete(session));
                session.on('error', () => {}); // suppress ECONNRESET etc.
            });
            server.on('stream', (stream, headers) => this.#handleStream(stream, headers));
            server.on('error', (err) => {
                // Suppress errors after deliberate close
                if (this.server) {
                    this.emit('error', err);
                }
            });

            server.once('error', reject);
            server.listen(this.port, 'localhost', () => {
                server.removeListener('error', reject);
                resolve();
            });
        });
    }

    stop(): Promise<void> {
        // Respond 204 to still-waiting GET /message requests so the sailor unblocks.
        for (const { stream } of this.pendingRequests) {
            try {
                if (!stream.closed && !stream.destroyed) {
                    stream.respond({ [HTTP2_HEADER_STATUS]: 204 });
                    stream.end();
                }
            } catch { /* ignore */ }
        }
        this.pendingRequests = [];
        this.messageQueue = [];

        // Force-close client sessions so the port is freed immediately.
        for (const session of this.sessions) {
            try {
                session.destroy();
            } catch { /* ignore */ }
        }
        this.sessions.clear();

        return new Promise((resolve) => {
            const srv = this.server;
            if (!srv) {
                return resolve();
            }
            this.server = null;
            srv.close(() => resolve());
        });
    }

    /**
     * Queue a plaintext message for the next GET /message.
     * The outgoing `parentMessageId` will equal the returned `messageId`.
     */
    queueMessage(
        message: { headers?: Record<string, unknown> } & Record<string, unknown>,
        meta: { threadId?: string; parentMessageId?: string } = {},
        options: { protocolVersion?: number; reply_to?: string; threadId?: string } = {}
    ): { messageId: string; threadId: string } {
        const { protocolVersion = 1, reply_to: replyTo, threadId: optThreadId } = options;
        const threadId = meta.threadId || optThreadId || randomUUID();
        const messageId = randomUUID();

        const metadata: QueuedMessageMetadata = {
            messageId, threadId, parentMessageId: meta.parentMessageId, protocolVersion
        };
        // Propagate stepId so the sailor applies NO_SELF_PASSTHROUGH correctly.
        const stepId = message?.headers?.stepId as string | undefined;
        if (stepId) {
            metadata.stepId = stepId;
        }
        if (replyTo) {
            metadata.reply_to = replyTo;
        }

        const body = this.encryptor.encryptMessageContent(message, protocolVersion < 2 ? 'base64' : undefined);

        const pending = this.pendingRequests.shift();
        if (pending) {
            this.#serveMessage(pending.stream, { metadata, body });
        } else {
            this.messageQueue.push({ metadata, body });
        }
        return { messageId, threadId };
    }

    /** Copy of queued messages not yet consumed, optionally sampled after `timeout` ms. */
    async retrieveMessagesNotConsumed(timeout = 0): Promise<QueuedMessage[]> {
        if (timeout > 0) {
            await new Promise(resolve => setTimeout(resolve, timeout));
        }
        return [...this.messageQueue];
    }

    #handleStream(stream: ServerHttp2Stream, headers: IncomingHttpHeaders): void {
        const url = new URL(String(headers[HTTP2_HEADER_PATH] ?? '/'), 'http://localhost');
        const method = headers[HTTP2_HEADER_METHOD];
        const { pathname, searchParams } = url;

        stream.on('error', () => {}); // prevent unhandled stream errors

        if (method === 'GET' && pathname === '/message') {
            this.#handleGetMessage(stream);
        } else if (method === 'POST' && pathname === '/message') {
            this.#handlePostMessage(stream, headers, searchParams);
        } else if (method === 'POST' && pathname === '/finish-processing') {
            this.#handleFinishProcessing(stream, searchParams);
        } else if (method === 'POST' && pathname === '/resume-processing') {
            this.#readBody(stream, () => this.#respond(stream, 200));
        } else if (method === 'POST' && pathname === '/object') {
            this.#readBody(stream, (body) => {
                const objectId = randomUUID();
                this.objects.set(objectId, body);
                this.#respond(stream, 200, JSON.stringify({ objectId }));
            });
        } else if (method === 'GET' && pathname.startsWith('/object/')) {
            const data = this.objects.get(pathname.slice('/object/'.length));
            this.#respond(stream, data ? 200 : 404, data);
        } else {
            this.#respond(stream, 404);
        }
    }

    #handleGetMessage(stream: ServerHttp2Stream): void {
        const queued = this.messageQueue.shift();
        if (queued) {
            this.#serveMessage(stream, queued);
            return;
        }
        this.pendingRequests.push({ stream });
        stream.once('close', () => {
            this.pendingRequests = this.pendingRequests.filter(r => r.stream !== stream);
        });
    }

    #serveMessage(stream: ServerHttp2Stream, { metadata, body }: QueuedMessage): void {
        try {
            if (stream.closed || stream.destroyed) {
                return;
            }
            stream.respond({
                [HTTP2_HEADER_STATUS]: 200,
                [MESSAGE_METADATA_HEADER]: JSON.stringify(metadata)
            });
            stream.end(body);
        } catch { /* stream may have already closed */ }
    }

    #handlePostMessage(stream: ServerHttp2Stream, headers: IncomingHttpHeaders, params: URLSearchParams): void {
        const type = params.get('type');
        let metadata: Record<string, unknown> = {};
        try {
            const raw = headers[MESSAGE_METADATA_HEADER];
            if (raw) {
                metadata = JSON.parse(String(raw));
            }
        } catch { /* ignore malformed metadata */ }

        this.#readBody(stream, (body) => {
            this.#respond(stream, 200);
            if (type === 'data') {
                this.dataMessages.push({ metadata, body });
            }
            this.emit('message', { metadata, body }, type);
        });
    }

    #handleFinishProcessing(stream: ServerHttp2Stream, params: URLSearchParams): void {
        this.#respond(stream, 200);
        this.emit('finish-processing', {
            incomingMessageId: params.get('incomingMessageId'),
            status: params.get('status')
        });
    }

    #readBody(stream: ServerHttp2Stream, onEnd: (body: Buffer) => void): void {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => onEnd(Buffer.concat(chunks)));
    }

    #respond(stream: ServerHttp2Stream, status: number, body?: string | Buffer): void {
        stream.respond({ [HTTP2_HEADER_STATUS]: status });
        stream.end(body);
    }
}
