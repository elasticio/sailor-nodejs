'use strict';

const http2 = require('http2');
const EventEmitter = require('events');
const uuid = require('uuid');

const MESSAGE_METADATA_HEADER = 'message-metadata';

const {
    HTTP2_HEADER_STATUS,
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_METHOD
} = http2.constants;

/**
 * A fake Sailor Proxy HTTP/2 server for integration tests.
 *
 * Handles the same endpoints as the real Sailor Proxy:
 *   GET  /message            – delivers queued messages to the sailor
 *   POST /message            – receives outgoing messages from the sailor
 *   POST /finish-processing  – acknowledges message completion
 *   POST /resume-processing  – acknowledges resumed processing (no-op here)
 *   POST /object             – stores a large-message body
 *   GET  /object/:id         – retrieves a stored large-message body
 *
 * Usage:
 *   const proxy = new FakeSailorProxy(encryptor, port);
 *   await proxy.start();
 *   proxy.queueMessage(msgBody, { threadId, parentMessageId }, { protocolVersion, reply_to });
 *   proxy.once('message', ({ metadata, body }, type) => { ... });
 *   await proxy.stop();
 */
class FakeSailorProxy extends EventEmitter {
    constructor(encryptor, port) {
        super();
        this.encryptor = encryptor;
        this.port = port;
        this.server = null;
        this.sessions = new Set();
        this.messageQueue = []; // { metadata, body } – waiting to be fetched by sailor
        this.pendingRequests = []; // { stream } – waiting for a queued message
        this.objects = new Map(); // objectId → Buffer, for lightweight-message tests
        this.dataMessages = [];     // messages received from the sailor with type='data'
    }

    start() {
        return new Promise((resolve, reject) => {
            this.server = http2.createServer();

            this.server.on('session', (session) => {
                this.sessions.add(session);
                session.once('close', () => this.sessions.delete(session));
                session.on('error', () => {}); // suppress ECONNRESET etc.
            });

            this.server.on('stream', (stream, headers) => {
                this._handleStream(stream, headers);
            });

            this.server.on('error', (err) => {
                // Suppress errors after deliberate close
                if (!this.server) {
                    return;
                }
                this.emit('error', err);
            });

            this.server.once('error', reject);
            this.server.listen(this.port, 'localhost', () => {
                this.server.removeListener('error', reject);
                resolve();
            });
        });
    }

    stop() {
        // Respond 204 to any still-waiting GET /message requests so the sailor
        // unblocks and notices that the connection is closing.
        for (const { stream } of this.pendingRequests) {
            try {
                if (!stream.closed && !stream.destroyed) {
                    stream.respond({ [HTTP2_HEADER_STATUS]: 204 });
                    stream.end();
                }
            } catch (_) { /* ignore */ }
        }
        this.pendingRequests = [];
        this.messageQueue = [];

        // Force-close all active client sessions so the port is freed immediately.
        for (const session of this.sessions) {
            try {
                session.destroy();
            } catch (_) { /* ignore */ }
        }
        this.sessions.clear();

        return new Promise((resolve) => {
            if (!this.server) {
                return resolve();
            }
            const srv = this.server;
            this.server = null;
            srv.close(() => resolve());
        });
    }

    // ─── public API ────────────────────────────────────────────────────────────

    /**
     * Queue a plaintext message so that the next GET /message from the sailor
     * receives it.  Returns `{ messageId, threadId }` for use in test assertions
     * (the outgoing `parentMessageId` will equal the returned `messageId`).
     *
     * @param {object} message            – plaintext message object
     * @param {object} [meta={}]          – { threadId, parentMessageId }
     * @param {object} [options={}]       – { protocolVersion, reply_to, threadId }
     * @returns {{ messageId: string, threadId: string }}
     */
    queueMessage(message, meta = {}, options = {}) {
        const { threadId: metaThreadId, parentMessageId } = meta;
        const { protocolVersion = 1, reply_to: replyTo, threadId: optThreadId } = options;

        const effectiveThreadId = metaThreadId || optThreadId || uuid.v4();
        const messageId = uuid.v4();

        // Propagate stepId from the message's own headers so the sailor can
        // apply NO_SELF_PASSTHROUGH passthrough logic correctly.
        const stepId = message && message.headers && message.headers.stepId;

        const metadata = { messageId, threadId: effectiveThreadId, parentMessageId, protocolVersion };
        if (stepId) {
            metadata.stepId = stepId;
        }
        if (replyTo) {
            metadata.reply_to = replyTo;
        }

        const body = this.encryptor.encryptMessageContent(
            message,
            protocolVersion < 2 ? 'base64' : undefined
        );

        if (this.pendingRequests.length > 0) {
            const { stream } = this.pendingRequests.shift();
            this._serveMessage(stream, metadata, body);
        } else {
            this.messageQueue.push({ metadata, body });
        }

        return { messageId, threadId: effectiveThreadId };
    }

    /**
     * Return a copy of messages that were queued but not yet consumed by the sailor.
     * Optionally waits `timeout` ms before sampling (mirrors the old amqpHelper API).
     */
    async retrieveMessagesNotConsumed(timeout = 0) {
        if (timeout > 0) {
            await new Promise(resolve => setTimeout(resolve, timeout));
        }
        return [...this.messageQueue];
    }

    _handleStream(stream, headers) {
        const rawPath = headers[HTTP2_HEADER_PATH] || '/';
        const method = headers[HTTP2_HEADER_METHOD];

        const qIdx = rawPath.indexOf('?');
        const pathname = qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath;
        const params = new URLSearchParams(qIdx >= 0 ? rawPath.slice(qIdx + 1) : '');

        stream.on('error', () => {}); // prevent unhandled stream errors

        if (method === 'GET' && pathname === '/message') {
            this._handleGetMessage(stream);
        } else if (method === 'POST' && pathname === '/message') {
            this._handlePostMessage(stream, headers, params);
        } else if (method === 'POST' && pathname === '/finish-processing') {
            this._handleFinishProcessing(stream, params);
        } else if (method === 'POST' && pathname === '/resume-processing') {
            this._handleResumeProcessing(stream);
        } else if (method === 'POST' && pathname === '/object') {
            this._handleUploadObject(stream);
        } else if (method === 'GET' && pathname.startsWith('/object/')) {
            this._handleGetObject(stream, pathname.slice('/object/'.length));
        } else {
            stream.respond({ [HTTP2_HEADER_STATUS]: 404 });
            stream.end();
        }
    }

    _handleGetMessage(stream) {
        if (this.messageQueue.length > 0) {
            this._serveMessage(stream, ...Object.values(this.messageQueue.shift()));
        } else {
            this.pendingRequests.push({ stream });
            stream.once('close', () => {
                const idx = this.pendingRequests.findIndex(r => r.stream === stream);
                if (idx !== -1) {
                    this.pendingRequests.splice(idx, 1);
                }
            });
        }
    }

    _serveMessage(stream, metadata, body) {
        try {
            if (stream.closed || stream.destroyed) {
                return;
            }
            stream.respond({
                [HTTP2_HEADER_STATUS]: 200,
                [MESSAGE_METADATA_HEADER]: JSON.stringify(metadata)
            });
            stream.end(body);
        } catch (_) { /* stream may have already closed */ }
    }

    _handlePostMessage(stream, headers, params) {
        const type = params.get('type');
        let metadata = {};
        try {
            const raw = headers[MESSAGE_METADATA_HEADER];
            if (raw) {
                metadata = JSON.parse(raw);
            }
        } catch (_) { /* ignore malformed metadata */ }

        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
            stream.respond({ [HTTP2_HEADER_STATUS]: 200 });
            stream.end();
            const body = Buffer.concat(chunks);
            if (type === 'data') this.dataMessages.push({ metadata, body });
            this.emit('message', { metadata, body }, type);
        });
    }

    _handleFinishProcessing(stream, params) {
        stream.respond({ [HTTP2_HEADER_STATUS]: 200 });
        stream.end();
        this.emit('finish-processing', {
            incomingMessageId: params.get('incomingMessageId'),
            status: params.get('status')
        });
    }

    _handleResumeProcessing(stream) {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
            stream.respond({ [HTTP2_HEADER_STATUS]: 200 });
            stream.end();
        });
    }

    _handleUploadObject(stream) {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
            const objectId = uuid.v4();
            this.objects.set(objectId, Buffer.concat(chunks));
            stream.respond({ [HTTP2_HEADER_STATUS]: 200 });
            stream.end(JSON.stringify({ objectId }));
        });
    }

    _handleGetObject(stream, objectId) {
        const data = this.objects.get(objectId);
        if (!data) {
            stream.respond({ [HTTP2_HEADER_STATUS]: 404 });
            stream.end();
            return;
        }
        stream.respond({ [HTTP2_HEADER_STATUS]: 200 });
        stream.end(data);
    }
}

module.exports = FakeSailorProxy;
