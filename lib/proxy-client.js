const log = require('./logging.js');
const Encryptor = require('./encryptor.js');
const _ = require('lodash');
const eventToPromise = require('event-to-promise');
const uuid = require('uuid');
const http2 = require('http2');
const { getJitteredDelay } = require('./utils.js');
const { Promise } = require('q');
const pThrottle = require('p-throttle');

const {
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_METHOD,
    HTTP2_HEADER_AUTHORIZATION,
    HTTP2_HEADER_STATUS
} = http2.constants;

const HEADER_ROUTING_KEY = 'x-eio-routing-key';
const AMQP_HEADER_META_PREFIX = 'x-eio-meta-';
const OBJECT_ID_HEADER = 'x-ipaas-object-storage-id';
const PROXY_FORWARD_HEADER_PREFIX = 'x-sailor-proxy-forward-';
const MESSAGE_PROCESSING_STATUS = {
    SUCCESS: 'success',
    ERROR: 'error'
};

class ProxyClient {
    constructor(settings) {
        this.settings = settings;
        this._encryptor = new Encryptor(this.settings.MESSAGE_CRYPTO_PASSWORD, this.settings.MESSAGE_CRYPTO_IV);
        this.closed = true;
        this.clientSession = null;
        this.reconnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;

        const username = settings.API_USERNAME;
        const password = settings.API_KEY;
        if (!username || !password) {
            throw new Error('API_USERNAME and API_KEY must be set to connect to Sailor Proxy');
        }
        this.authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

        this.throttles = {
            // 100 Messages per Second
            data: pThrottle(() => Promise.resolve(true),
                settings.DATA_RATE_LIMIT,
                settings.RATE_INTERVAL),
            error: pThrottle(() => Promise.resolve(true),
                settings.ERROR_RATE_LIMIT,
                settings.RATE_INTERVAL),
            snapshot: pThrottle(() => Promise.resolve(true),
                settings.SNAPSHOT_RATE_LIMIT,
                settings.RATE_INTERVAL)
        };
    }

    // Health check method for K8s
    // Returns true during reconnection attempts to prevent pod restarts during transient issues
    // Only returns false if:
    // - Connection was intentionally closed (this.closed = true)
    // - Max reconnection attempts exhausted (reconnecting = false, closed = true)
    isConnected() {
        // For K8s health checks: consider the client "connected" if we're actively trying to reconnect
        // This prevents pod restarts during transient network issues
        if (this.reconnecting && !this.closed) {
            return true;
        }
        return !this.closed && this.clientSession && !this.clientSession.destroyed;
    }

    async connect() {
        try {
            log.trace('connecting to http2 server');
            this.clientSession = http2.connect(this.settings.SAILOR_PROXY_URI);
            this.closed = false;
            this.reconnectAttempts = 0;

            // Set up event listeners for connection management
            this._setupConnectionListeners();

            await eventToPromise(this.clientSession, 'connect');
            log.info('Successfully connected to Sailor Proxy');
        } catch (err) {
            log.error({ err }, 'Failed to connect to Sailor Proxy');
            throw err;
        }
    }

    _setupConnectionListeners() {
        if (!this.clientSession) return;

        // Handle connection errors
        this.clientSession.on('error', (err) => {
            log.error({ err, closed: this.closed }, 'HTTP2 session error');
            if (!this.closed) {
                this._handleDisconnection('error', err);
            }
        });

        // Handle connection close
        this.clientSession.on('close', () => {
            log.warn({ closed: this.closed, reconnecting: this.reconnecting }, 'HTTP2 session closed');
            if (!this.closed && !this.reconnecting) {
                this._handleDisconnection('close');
            }
        });

        // Handle GOAWAY frames (server-initiated shutdown)
        this.clientSession.on('goaway', (errorCode, lastStreamID, opaqueData) => {
            log.warn({ errorCode, lastStreamID, closed: this.closed }, 'Received GOAWAY from server');
            if (!this.closed) {
                this._handleDisconnection('goaway', { errorCode, lastStreamID });
            }
        });

        // Handle timeout
        this.clientSession.on('timeout', () => {
            log.warn({ closed: this.closed }, 'HTTP2 session timeout');
            if (!this.closed) {
                this._handleDisconnection('timeout');
            }
        });
    }

    _handleDisconnection(reason, details) {
        if (this.reconnecting || this.closed) {
            return;
        }

        log.warn({ reason, details }, 'Connection lost, initiating reconnection');
        this.reconnecting = true;

        // Clean up the current session
        if (this.clientSession && !this.clientSession.destroyed) {
            this.clientSession.destroy();
        }
        this.clientSession = null;

        this._scheduleReconnect();
    }

    _scheduleReconnect() {
        if (this.closed) {
            log.info('Connection closed intentionally, skipping reconnection');
            this.reconnecting = false;
            return;
        }

        if (this.reconnectAttempts >= this.settings.PROXY_RECONNECT_MAX_RETRIES) {
            log.error({ attempts: this.reconnectAttempts }, 'Max reconnection attempts reached, giving up');
            this.reconnecting = false;
            this.closed = true; // Mark as closed so K8s health check will fail and restart the pod
            // Optionally emit an event or call a callback here
            return;
        }

        this.reconnectAttempts++;
        const baseDelay = Math.min(
            this.settings.PROXY_RECONNECT_INITIAL_DELAY *
                Math.pow(this.settings.PROXY_RECONNECT_BACKOFF_MULTIPLIER, this.reconnectAttempts - 1),
            this.settings.PROXY_RECONNECT_MAX_DELAY
        );
        // Apply jitter to avoid thundering herd problem
        const delay = getJitteredDelay(baseDelay, this.settings.PROXY_RECONNECT_JITTER_FACTOR);

        log.info({ attempt: this.reconnectAttempts, baseDelayMs: baseDelay, jitteredDelayMs: delay }, 'Scheduling reconnection attempt');

        this.reconnectTimer = setTimeout(async () => {
            try {
                log.info({ attempt: this.reconnectAttempts }, 'Attempting to reconnect');
                await this._reconnect();
                log.info('Successfully reconnected to Sailor Proxy');
                this.reconnecting = false;
            } catch (err) {
                log.error({ attempt: this.reconnectAttempts, error: err }, 'Reconnection attempt failed');
                this._scheduleReconnect();
            }
        }, delay);
    }

    async _reconnect() {
        this.clientSession = http2.connect(this.settings.SAILOR_PROXY_URI);
        this._setupConnectionListeners();
        await eventToPromise(this.clientSession, 'connect');
        this.reconnectAttempts = 0;
    }

    async disconnect() {
        this.closed = true;
        this.reconnecting = false;

        // Clear any pending reconnection timers
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        return new Promise((resolve) => {
            if (!this.clientSession || this.clientSession.destroyed) {
                log.debug('Session already destroyed');
                return resolve();
            }

            this.clientSession.close(() => {
                log.debug('Successfully closed HTTP2 connection');
                resolve();
            });
        });
    }

    async _ensureConnection() {
        if (this.isConnected()) {
            return;
        }

        if (this.reconnecting) {
            // Wait for reconnection to complete
            log.info('Waiting for reconnection to complete');
            const maxWait = 30000; // 30 seconds
            const startTime = Date.now();
            while (this.reconnecting && (Date.now() - startTime) < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            if (!this.isConnected()) {
                throw new Error('Failed to reconnect within timeout period');
            }
            return;
        }

        if (this.closed) {
            throw new Error('Connection is closed. Call connect() first.');
        }

        // If we get here, connection was lost but reconnection hasn't started
        throw new Error('Connection lost and no reconnection in progress');
    }

    async fetchMessageBody(message, logger) {
        await this._ensureConnection();

        const { body, headers } = message;

        logger.info('Checking if incoming messages is lightweight...');

        if (!headers) {
            logger.info('Empty headers so not lightweight.');
            return body;
        }

        const { [OBJECT_ID_HEADER]: objectId } = headers;

        if (!objectId) {
            logger.trace('No object id header so not lightweight.');
            return body;
        }

        logger.info('Object id header found, message is lightweight.', { objectId });

        let object;

        logger.info('Going to fetch message body.', { objectId });

        const maxRetries = this.settings.PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS;
        const retryDelay = this.settings.PROXY_OBJECT_REQUEST_RETRY_DELAY;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                object = await new Promise((resolve, reject) => {
                    const getObjectStream = this.clientSession.request({
                        [HTTP2_HEADER_PATH]: `/object/${objectId}`,
                        [HTTP2_HEADER_METHOD]: 'GET',
                        [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
                    }).pipe(this._encryptor.createDecipher());

                    const chunks = [];
                    getObjectStream.on('data', chunk => {
                        chunks.push(chunk);
                    });
                    getObjectStream.on('error', (err) => {
                        logger.error(err, 'Error during fetching message body');
                        reject(err);
                    });
                    getObjectStream.on('end', () => {
                        logger.info('Message stream ended by server');
                        const buffer = Buffer.concat(chunks);
                        logger.info({ messageSize: buffer.length }, 'Received complete message from server');
                        resolve({ data: JSON.parse(buffer.toString()) });
                    });
                });

                if (attempt > 0) {
                    log.info({ attempt, maxRetries }, 'Fetch message body succeeded after retry');
                }
                return objectId;
            } catch (error) {
                const isLastAttempt = attempt === maxRetries;
                const isRetryable = error.isNetworkError ||
                    (error.statusCode && error.statusCode >= 500) ||
                    error.code === 'ECONNRESET' ||
                    error.code === 'ETIMEDOUT';

                if (!isRetryable || isLastAttempt) {
                    log.error({
                        attempt,
                        maxRetries,
                        error: error.message,
                        isRetryable
                    }, 'Fetch message body failed, no more retries');
                    throw error;
                }

                const delay = Math.min(
                    retryDelay * Math.pow(2, attempt),
                    this.settings.PROXY_OBJECT_REQUEST_MAX_RETRY_DELAY
                );
                log.warn({
                    attempt,
                    maxRetries,
                    error: error.message,
                    nextRetryIn: delay
                }, 'Fetch message body failed, retrying...');

                await new Promise(resolve => setTimeout(resolve, delay));

                // Ensure connection is still valid before retry
                if (!this.isConnected()) {
                    log.info('Reconnecting before retry...');
                    await this.connect();
                }
            }
        }
        logger.info('Successfully obtained message body.', { objectId });
        logger.trace('Message body object received');

        return object.data;
    }

    async uploadMessageBody(bodyBuf) {
        await this._ensureConnection();

        const maxRetries = this.settings.PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS;
        const retryDelay = this.settings.PROXY_OBJECT_REQUEST_RETRY_DELAY;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const objectId = await new Promise((resolve, reject) => {
                    const postMessageStream = this.clientSession.request({
                        [HTTP2_HEADER_PATH]: '/object',
                        [HTTP2_HEADER_METHOD]: 'POST',
                        [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
                    });

                    let responseData = '';
                    let statusCode = null;

                    postMessageStream.on('response', (headers, flags) => {
                        statusCode = headers[http2.constants.HTTP2_HEADER_STATUS];
                        if (statusCode !== 200) {
                            const error = new Error(`Failed to upload message body, status code: ${statusCode}`);
                            error.statusCode = statusCode;
                            return reject(error);
                        }
                    });

                    postMessageStream.on('data', chunk => {
                        responseData += chunk;
                    });

                    postMessageStream.on('error', (err) => {
                        log.error(err, 'Error during upload message body');
                        err.isNetworkError = true;
                        reject(err);
                    });

                    postMessageStream.on('end', () => {
                        if (!responseData) {
                            return
                        }
                        try {
                            const responseJson = JSON.parse(responseData);
                            resolve(responseJson.objectId);
                        } catch (e) {
                            log.error(e, 'Failed to parse upload message body response');
                            reject(e);
                        }
                    });

                    const cipher = this._encryptor.createCipher();
                    cipher.pipe(postMessageStream);
                    cipher.write(bodyBuf);
                    cipher.end();
                });

                // Success - return the objectId
                if (attempt > 0) {
                    log.info({ attempt, maxRetries }, 'Upload message body succeeded after retry');
                }
                return objectId;

            } catch (error) {
                const isLastAttempt = attempt === maxRetries;
                const isRetryable = error.isNetworkError ||
                    (error.statusCode && error.statusCode >= 500) ||
                    error.code === 'ECONNRESET' ||
                    error.code === 'ETIMEDOUT';

                if (!isRetryable || isLastAttempt) {
                    log.error({
                        attempt,
                        maxRetries,
                        error: error.message,
                        isRetryable
                    }, 'Upload message body failed, no more retries');
                    throw error;
                }

                const delay = Math.min(
                    retryDelay * Math.pow(2, attempt),
                    this.settings.PROXY_OBJECT_REQUEST_MAX_RETRY_DELAY
                );
                log.warn({
                    attempt,
                    maxRetries,
                    error: error.message,
                    nextRetryIn: delay
                }, 'Upload message body failed, retrying...');

                await new Promise(resolve => setTimeout(resolve, delay));

                // Ensure connection is still valid before retry
                if (!this.isConnected()) {
                    log.info('Reconnecting before retry...');
                    await this.connect();
                }
            }
        }
    }

    async listenForMessages(messageHandler) {
        while (!this.closed) {
            try {
                await this._ensureConnection();

                const stepId = this.settings.STEP_ID;
                const prefetch = this.settings.PROXY_PREFETCH_SAILOR;
                await Promise.all(new Array(prefetch).fill().map(async () => {
                    const queryParams = new URLSearchParams({
                        stepId,
                        prefetch
                    }).toString();
                    log.info({ stepId, prefetch }, 'Requesting message from proxy');
                    const getMessageStream = this.clientSession.request({
                        [HTTP2_HEADER_PATH]: `/message?${queryParams}`,
                        [HTTP2_HEADER_METHOD]: 'GET',
                        [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
                    });

                    const { headers, body } = await new Promise((resolve, reject) => {
                        getMessageStream.on('response', (headers, flags) => {
                            log.info({ headers, flags }, 'Connected to message stream');
                            if (headers[HTTP2_HEADER_STATUS] !== 200) {
                                return reject(new Error(`Failed to get message, status code: ${headers[HTTP2_HEADER_STATUS]}`));
                            }
                            const messageId = headers['x-message-id'];
                            const chunks = [];
                            getMessageStream.on('data', chunk => {
                                chunks.push(chunk);
                            });
                            getMessageStream.on('end', () => {
                                log.info('Message stream ended by server');
                                const body = Buffer.concat(chunks);
                                log.info({
                                    messageId,
                                    messageSize: body.length
                                }, 'Received complete message from server');
                                log.trace({ body: body.toString() }, 'Message body as string');
                                resolve({ headers, body });
                            });
                        });

                        getMessageStream.on('close', () => {
                            log.warn('Message stream closed by server');
                            reject(new Error('Message stream closed by server'));
                        });
                        getMessageStream.on('error', (err) => {
                            log.error(err, 'Error on message stream');
                            reject(err);
                        });
                    });

                    const proxyHeaders = this._extractProxyHeaders(headers);
                    const message = this._decodeMessage(body, headers);
                    log.debug({ proxyHeaders, message }, 'Processing received message');
                    await messageHandler(proxyHeaders, message);
                }));
            } catch (err) {
                if (this.closed) {
                    log.info('Connection closed, stopping message listener');
                    break;
                }

                if (!this.reconnecting) {
                    log.error(err, 'Error in listenForMessages, waiting for reconnection');
                } else {
                    log.debug('Currently reconnecting, will retry listening for messages after reconnection');
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    async sendMessage({
        incomingMessageId,
        type,
        data,
        headers
    }) {
        await this._ensureConnection();

        const throttledSend = this.throttles[type];
        if (throttledSend) {
            log.debug({ incomingMessageId, type, headers }, 'Applying rate limiting for message send');
            await throttledSend();
        }

        log.debug({ incomingMessageId, type, headers }, 'Sending message to proxy');
        log.trace({ data }, 'Message data to send to proxy');
        const proxyHeaders = this._createProxyHeaders(headers);
        const encryptedData = this.encryptMessageContent(data, headers.protocolVersion);
        if (encryptedData.length > this.settings.OUTGOING_MESSAGE_SIZE_LIMIT) {
            const error = new Error(`Outgoing message size ${encryptedData.length}`
                + ` exceeds limit of ${this.settings.OUTGOING_MESSAGE_SIZE_LIMIT}.`);
            log.error(error);
            throw error;
        }

        const messageHeaders = _.mapKeys(data.headers || {}, (value, key) => key.toLowerCase());
        const customRoutingKey = messageHeaders[HEADER_ROUTING_KEY];
        const queryParams = new URLSearchParams({
            incomingMessageId,
            stepId: this.settings.STEP_ID,
            type,
            ...(customRoutingKey ? { customRoutingKey } : {})
        }).toString();
        // TODO: Add retries
        const postMessageStream = this.clientSession.request({
            ...proxyHeaders,
            [HTTP2_HEADER_PATH]: `/message?${queryParams}`,
            [HTTP2_HEADER_METHOD]: 'POST',
            [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
        });
        postMessageStream.write(encryptedData);
        postMessageStream.end();

        return new Promise((resolve, reject) => {
            postMessageStream.on('response', (headers) => {
                log.debug({ status: headers[HTTP2_HEADER_STATUS] }, 'Send message response');
                if (headers[HTTP2_HEADER_STATUS] !== 200) {
                    log.error({ headers }, 'Failed to send message');
                    return reject(new Error(`Failed to send message, status code: ${headers[HTTP2_HEADER_STATUS]}`));
                }
            });
            postMessageStream.on('error', (err) => {
                log.error(err, 'Error during sending message');
                reject(err);
            });
            postMessageStream.on('end', () => {
                log.debug('Send message end event');
                resolve();
            });
        });
    }

    _decodeMessage(originalMessage, headers) {
        log.trace('Message received');
        let message;
        if (this.settings.INPUT_FORMAT === 'error') {
            message = this._decodeErrorMessage(originalMessage, headers);
        } else {
            message = this._decodeDefaultMessage(originalMessage, headers);
        }
        message.headers = message.headers || {};
        if (headers.replyTo) {
            message.headers.reply_to = headers.replyTo;
        }
        return message;
    }

    _decodeDefaultMessage(originalMessage, headers) {
        const protocolVersion = Number(headers.protocolVersion || 1);
        return this._encryptor.decryptMessageContent(
            originalMessage,
            protocolVersion < 2 ? 'base64' : undefined
        );
    }

    _decodeErrorMessage(originalMessage, headers) {
        const errorBody = JSON.parse(originalMessage.toString());
        if (errorBody.error) {
            errorBody.error = this._encryptor.decryptMessageContent(Buffer.from(errorBody.error), 'base64');
        }
        if (errorBody.errorInput) {
            errorBody.errorInput = this._encryptor.decryptMessageContent(errorBody.errorInput, 'base64');
        }
        return {
            body: errorBody,
            headers
        };
    }

    async finishProcessing(incomingHeaders, status) {
        await this._ensureConnection();

        if (Object.values(MESSAGE_PROCESSING_STATUS).indexOf(status) === -1) {
            throw new Error(`Invalid message processing status: ${status}`);
        }
        const incomingMessageId = incomingHeaders.messageId;
        log.debug({ incomingMessageId, status }, 'Finishing processing of message');
        const queryParams = new URLSearchParams({
            incomingMessageId,
            status
        }).toString();
        // TODO: Add retries
        const postMessageStream = this.clientSession.request({
            [HTTP2_HEADER_PATH]: `/finish-processing?${queryParams}`,
            [HTTP2_HEADER_METHOD]: 'POST',
            [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
        });
        postMessageStream.end();

        return new Promise((resolve, reject) => {
            postMessageStream.on('response', (headers) => {
                log.debug({ status: headers[HTTP2_HEADER_STATUS] }, 'Finish processing response event');
                if (headers[HTTP2_HEADER_STATUS] !== 200) {
                    log.error({ headers }, 'Failed to finish processing message');
                    return reject(new Error(`Failed to finish processing message, status code: ${headers[HTTP2_HEADER_STATUS]}`));
                }
            });

            postMessageStream.on('end', () => {
                log.debug('Finish processing end event');
                resolve();
            });

            postMessageStream.on('error', reject);
        });
    }

    encryptMessageContent(body, protocolVersion = 1) {
        return this._encryptor.encryptMessageContent(
            body,
            protocolVersion < 2
                ? 'base64'
                : undefined
        );
    }

    async sendError(err, headers, originalMessage, incomingHeaders) {
        await this._ensureConnection();

        const settings = this.settings;

        const encryptedError = this._encryptor.encryptMessageContent({
            name: err.name,
            message: err.message,
            stack: err.stack
        }, 'base64').toString();

        const payload = {
            error: encryptedError
        };
        if (originalMessage) {
            const protocolVersion = Number(incomingHeaders.protocolVersion || 1);
            if (protocolVersion >= 2) {
                payload.errorInput = this._encryptor.encryptMessageContent(
                    originalMessage,
                    'base64'
                ).toString();
            } else {
                payload.errorInput = originalMessage;
            }
        }
        const errorPayload = JSON.stringify(payload);

        let result = await this.sendMessage({
            incomingMessageId: incomingHeaders ? incomingHeaders.messageId : undefined,
            type: 'error',
            data: errorPayload,
            headers
        });

        return result;
    }

    async sendRebound(reboundError, incomingHeaders, outgoingHeaders) {
        await this._ensureConnection();

        outgoingHeaders.end = new Date().getTime();
        outgoingHeaders.reboundReason = reboundError.message;
        return this.sendMessage({
            type: 'rebound',
            headers: outgoingHeaders,
            incomingMessageId: incomingHeaders ? incomingHeaders.messageId : undefined,
            data: reboundError
        });
    }

    async sendSnapshot(data, headers) {
        await this._ensureConnection();

        const payload = JSON.stringify(data);
        const properties = this._createProxyHeaders(headers);
        return this.sendMessage({
            type: 'snapshot',
            data: payload,
            headers: properties
        });
    }

    _createProxyHeaders(headers) {
        headers.messageId = headers.messageId || uuid.v4();
        return Object.entries(headers || {}).reduce((acc, [key, value]) => {
            acc[`${PROXY_FORWARD_HEADER_PREFIX}${_.kebabCase(key)}`] = value;
            return acc;
        }, {});
    }

    _extractProxyHeaders(proxyHeaders) {
        log.trace({ proxyHeaders }, 'Extracting proxy headers');
        const headers = Object.entries(proxyHeaders || {}).reduce((acc, [key, value]) => {
            if (key.startsWith(PROXY_FORWARD_HEADER_PREFIX)) {
                const originalKey = key.substring(PROXY_FORWARD_HEADER_PREFIX.length);
                acc[_.camelCase(originalKey)] = value;
            }
            return acc;
        }, {});

        const metaHeaderNames = Object.keys(headers)
            .filter(key => key.toLowerCase().startsWith(AMQP_HEADER_META_PREFIX));

        const metaHeaders = _.pick(headers, metaHeaderNames);
        const metaHeadersLowerCased = _.mapKeys(metaHeaders, (value, key) => key.toLowerCase());

        const result = {
            stepId: headers.stepId,
            ...metaHeadersLowerCased,
            threadId: headers.threadId || metaHeadersLowerCased['x-eio-meta-trace-id'],
            messageId: headers.messageId,
            parentMessageId: headers.parentMessageId
        };
        if (!result.threadId) {
            const threadId = uuid.v4();
            log.debug({ threadId }, 'Initiate new thread as it is not started ATM');
            result.threadId = threadId;
        }
        if (headers.replyTo) {
            result.replyTo = headers.replyTo;
        }
        log.debug({ result }, 'Extracted proxy headers');
        return result;
    }
}

exports.ProxyClient = ProxyClient;
exports.MESSAGE_PROCESSING_STATUS = MESSAGE_PROCESSING_STATUS;
