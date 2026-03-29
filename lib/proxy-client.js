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
    HTTP2_HEADER_STATUS,
    NGHTTP2_NO_ERROR
} = http2.constants;

const MESSAGE_METADATA_QUERY_PARAM = 'message-metadata';
const HEADER_ROUTING_KEY = 'x-eio-routing-key';
const AMQP_HEADER_META_PREFIX = 'x-eio-meta-';
const OBJECT_ID_HEADER = 'x-ipaas-object-storage-id';
const MESSAGE_PROCESSING_STATUS = {
    SUCCESS: 'success',
    ERROR: 'error'
};

class ProxyClient {
    constructor(settings) {
        this.settings = settings;
        this._encryptor = new Encryptor(this.settings.MESSAGE_CRYPTO_PASSWORD, this.settings.MESSAGE_CRYPTO_IV);
        this.closed = true;
        this.listeningForMessages = true;
        this.clientSession = null;
        this.reconnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.getMessageStreams = new Set();

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
        if (!this.clientSession) {
            return;
        }

        // Handle connection errors
        this.clientSession.on('error', (err) => {
            log.error({ err, closed: this.closed }, 'HTTP2 session error');
            if (!this.closed) {
                this._handleDisconnection('error', err);
            }
        });

        // Handle connection close
        this.clientSession.on('close', () => {
            log.debug({ closed: this.closed, reconnecting: this.reconnecting }, 'HTTP2 session closed');
            if (!this.closed && !this.reconnecting) {
                log.warn('HTTP2 session closed unexpectedly, initiating reconnection');
                this._handleDisconnection('close');
            }
        });

        // Handle GOAWAY frames (server-initiated shutdown)
        this.clientSession.on('goaway', (errorCode, lastStreamID, opaqueData) => {
            log.debug({ errorCode, lastStreamID, closed: this.closed }, 'Received GOAWAY from server');
            if (!this.closed) {
                log.warn('Received GOAWAY frame from server, initiating reconnection');
                this._handleDisconnection('goaway', { errorCode, lastStreamID });
            }
        });

        // Handle timeout
        this.clientSession.on('timeout', () => {
            log.debug({ closed: this.closed }, 'HTTP2 session timeout');
            if (!this.closed) {
                log.warn('HTTP2 session timeout, initiating reconnection');
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
            log.debug('Clearing pending reconnection timer');
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        return new Promise((resolve) => {
            log.debug('Disconnecting from Sailor Proxy');
            if (!this.clientSession || this.clientSession.destroyed) {
                log.debug('Session already destroyed');
                return resolve();
            }

            // TODO: what if incoming message is received during graceful shutdown?
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

    async _proxyRequestWithRetries(operationName, requestFn) {
        const maxRetries = this.settings.PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS;
        const retryDelay = this.settings.PROXY_OBJECT_REQUEST_RETRY_DELAY;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await requestFn();
                if (attempt > 0) {
                    log.info({ attempt, maxRetries }, `${operationName} succeeded after retry`);
                }
                return result;
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
                    }, `${operationName} failed, no more retries`);
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
                }, `${operationName} failed, retrying...`);

                await new Promise(resolve => setTimeout(resolve, delay));

                if (!this.isConnected()) {
                    log.info('Reconnecting before retry...');
                    await this.connect();
                }
            }
        }
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

        logger.info('Object id header found, message is lightweight. Going to fetch message body.', { objectId });

        await this._proxyRequestWithRetries('Fetch message body', () => new Promise((resolve, reject) => {
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
        }));

        logger.info('Successfully obtained message body.', { objectId });
        logger.trace('Message body object received');

        return objectId;
    }

    async uploadMessageBody(bodyBuf) {
        await this._ensureConnection();

        return this._proxyRequestWithRetries('Upload message body', () => new Promise((resolve, reject) => {
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
                    return;
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
        }));
    }

    async listenForMessages(messageHandler) {
        while (this.listeningForMessages) {
            try {
                log.debug('Starting to listen for messages from proxy');
                await this._ensureConnection();

                const stepId = this.settings.STEP_ID;
                const prefetch = this.settings.PROXY_PREFETCH_SAILOR;
                // TODO: When prefetch > 1, what if one message takes a long time to process - do we want to wait for it before requesting the next one?
                await Promise.all(new Array(prefetch).fill().map(async () => {
                    const queryParams = new URLSearchParams({
                        stepId,
                        prefetch
                    }).toString();
                    log.info({ stepId, prefetch }, 'Requesting message from proxy');
                    // TODO: what timeout is here? e.g. when flow is realtime - we might need to wait a long time...
                    const getMessageStream = this.clientSession.request({
                        [HTTP2_HEADER_PATH]: `/message?${queryParams}`,
                        [HTTP2_HEADER_METHOD]: 'GET',
                        [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
                    });
                    this.getMessageStreams.add(getMessageStream);

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

                    const messageMetadata = this._extractMessageMetadata(headers);
                    const message = this._decodeMessage(body, messageMetadata);
                    log.debug({ messageMetadata, message }, 'Processing received message');
                    await messageHandler(messageMetadata, message);
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
            } finally {
                log.debug('Cleaning up message streams');
                this.getMessageStreams.clear();
            }
        }
    }

    async stopListeningForMessages() {
        log.info('Stopping listening for messages');
        await Promise.all(Array.from(this.getMessageStreams).map(stream => {
            if (stream.closed || stream.destroyed) {
                log.debug({ closed: stream.closed, destroyed: stream.destroyed }, 'Message stream is already closed or destroyed');
                return Promise.resolve();
            }
            return new Promise((resolve) => {
                stream.close(NGHTTP2_NO_ERROR, () => {
                    log.debug('Closed message stream');
                    resolve();
                });
            });
        }));
        this.listeningForMessages = false;
    }

    _prepareData(data, metadata, type, forceProtocolVersion) {
        let protocolVersion;
        if (forceProtocolVersion) {
            protocolVersion = forceProtocolVersion;
        } else if (type === 'data') {
            protocolVersion = this.settings.PROTOCOL_VERSION;
        } else if (type === 'http-reply') {
            protocolVersion = 1;
        }
        const preparedMetadata = {
            ...metadata,
            messageId: metadata.messageId || uuid.v4()
        };
        let preparedData = data;
        if (protocolVersion) {
            preparedData = this.encryptMessageContent(data, protocolVersion);
            preparedMetadata.protocolVersion = protocolVersion;
        }
        return {
            preparedMetadata: _.omitBy(
                preparedMetadata,
                (value, key) => key.toLowerCase() === HEADER_ROUTING_KEY
            ),
            preparedData
        };
    }

    async sendMessage({
        incomingMessageId,
        type,
        data,
        metadata,
        forceProtocolVersion
    }) {
        await this._ensureConnection();

        const throttledSend = this.throttles[type];
        if (throttledSend) {
            log.debug({ incomingMessageId, type, metadata }, 'Applying rate limiting for message send');
            await throttledSend();
        }

        const messageHeaders = _.mapKeys(data.headers || {}, (value, key) => key.toLowerCase());
        const customRoutingKey = messageHeaders[HEADER_ROUTING_KEY];

        log.debug({
            incomingMessageId,
            type,
            metadata,
            customRoutingKey,
            forceProtocolVersion
        }, 'Sending message to proxy');
        log.trace({ data }, 'Message data to send to proxy');
        const { preparedMetadata, preparedData } = this._prepareData(data, metadata, type, forceProtocolVersion);
        if (preparedData.length > this.settings.OUTGOING_MESSAGE_SIZE_LIMIT) {
            const error = new Error(`Outgoing message size ${preparedData.length}` +
                ` exceeds limit of ${this.settings.OUTGOING_MESSAGE_SIZE_LIMIT}.`);
            log.error(error);
            throw error;
        }
        log.debug({ preparedMetadata, preparedDataSize: preparedData.length }, 'Prepared message for sending to proxy');

        const queryParams = new URLSearchParams({
            incomingMessageId,
            stepId: this.settings.STEP_ID,
            type,
            ...(customRoutingKey ? { customRoutingKey } : {})
        }).toString();
        await this._proxyRequestWithRetries('Send message', () => new Promise((resolve, reject) => {
            const postMessageStream = this.clientSession.request({
                [HTTP2_HEADER_PATH]: `/message?${queryParams}`,
                [HTTP2_HEADER_METHOD]: 'POST',
                [HTTP2_HEADER_AUTHORIZATION]: this.authHeader,
                [MESSAGE_METADATA_QUERY_PARAM]: JSON.stringify(preparedMetadata)
            });
            postMessageStream.write(preparedData);
            postMessageStream.end();

            postMessageStream.on('response', (headers) => {
                log.debug({ status: headers[HTTP2_HEADER_STATUS] }, 'Send message response');
                if (headers[HTTP2_HEADER_STATUS] !== 200) {
                    log.error({ headers }, 'Failed to send message');
                    const error = new Error(`Failed to send message, status code: ${headers[HTTP2_HEADER_STATUS]}`);
                    error.statusCode = headers[HTTP2_HEADER_STATUS];
                    return reject(error);
                }
            });
            postMessageStream.on('error', (err) => {
                log.error(err, 'Error during sending message');
                err.isNetworkError = true;
                reject(err);
            });
            postMessageStream.on('end', () => {
                log.debug('Send message end event');
                resolve();
            });
        }));
    }

    _decodeMessage(originalMessage, metadata) {
        log.trace('Message received');
        let message;
        if (this.settings.INPUT_FORMAT === 'error') {
            message = this._decodeErrorMessage(originalMessage);
        } else {
            message = this._decodeDefaultMessage(originalMessage, metadata);
        }
        message.headers = message.headers || {};
        if (metadata.reply_to) {
            message.headers.reply_to = metadata.reply_to;
        }
        return message;
    }

    _decodeDefaultMessage(originalMessage, metadata) {
        log.debug({ metadata }, 'Decoding default message format');
        const protocolVersion = Number(metadata.protocolVersion || 1);
        log.debug({ protocolVersion }, 'Decoding message with protocol version');
        return this._encryptor.decryptMessageContent(
            originalMessage,
            protocolVersion < 2 ? 'base64' : undefined
        );
    }

    _decodeErrorMessage(originalMessage) {
        const errorBody = JSON.parse(originalMessage.toString());
        // NOTICE both error and errorInput are transferred as base64 encoded.
        // this does not depend on protocolVersion of message (see _decodeDefaultMessage)
        // this should be fixed in future, but it's OK at this moment
        if (errorBody.error) {
            errorBody.error = this._encryptor.decryptMessageContent(Buffer.from(errorBody.error), 'base64');
        }
        if (errorBody.errorInput) {
            errorBody.errorInput = this._encryptor.decryptMessageContent(errorBody.errorInput, 'base64');
        }
        return errorBody;
    }

    async finishProcessing(metadata, status) {
        await this._ensureConnection();

        if (Object.values(MESSAGE_PROCESSING_STATUS).indexOf(status) === -1) {
            throw new Error(`Invalid message processing status: ${status}`);
        }
        const incomingMessageId = metadata.messageId;
        log.debug({ incomingMessageId, status }, 'Finishing processing of message');
        const queryParams = new URLSearchParams({
            incomingMessageId,
            status
        }).toString();

        await this._proxyRequestWithRetries('Finish processing', () => new Promise((resolve, reject) => {
            const postMessageStream = this.clientSession.request({
                [HTTP2_HEADER_PATH]: `/finish-processing?${queryParams}`,
                [HTTP2_HEADER_METHOD]: 'POST',
                [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
            });
            postMessageStream.end();

            postMessageStream.on('response', (headers) => {
                log.debug({ status: headers[HTTP2_HEADER_STATUS] }, 'Finish processing response event');
                if (headers[HTTP2_HEADER_STATUS] !== 200) {
                    log.error({ headers }, 'Failed to finish processing message');
                    const error = new Error(`Failed to finish processing message, status code: ${headers[HTTP2_HEADER_STATUS]}`);
                    error.statusCode = headers[HTTP2_HEADER_STATUS];
                    return reject(error);
                }
            });
            postMessageStream.on('end', () => {
                log.debug('Finish processing end event');
                resolve();
            });
            postMessageStream.on('error', (err) => {
                err.isNetworkError = true;
                reject(err);
            });
        }));
    }

    encryptMessageContent(body, protocolVersion = 1) {
        log.debug({ protocolVersion }, 'Encrypting message content with protocol version');
        return this._encryptor.encryptMessageContent(
            body,
            protocolVersion < 2
                ? 'base64'
                : undefined
        );
    }

    async sendError(err, outgoingMetadata, originalMessage, metadata) {
        await this._ensureConnection();

        const encryptedError = this._encryptor.encryptMessageContent({
            name: err.name,
            message: err.message,
            stack: err.stack
        }, 'base64').toString();

        const payload = {
            error: encryptedError
        };
        if (originalMessage) {
            const protocolVersion = Number(metadata.protocolVersion || 1);
            if (protocolVersion >= 2) {
                payload.errorInput = this._encryptor.encryptMessageContent(
                    originalMessage,
                    'base64'
                ).toString();
            } else {
                // TODO: encrypt errorInput
                payload.errorInput = originalMessage;
            }
        }
        const errorPayload = JSON.stringify(payload);

        const result = await this.sendMessage({
            incomingMessageId: metadata ? metadata.messageId : undefined,
            type: 'error',
            data: errorPayload,
            metadata: outgoingMetadata
        });

        return result;
    }

    async sendRebound(reboundError, metadata, outgoingMetadata) {
        await this._ensureConnection();

        outgoingMetadata.end = new Date().getTime();
        outgoingMetadata.reboundReason = reboundError.message;
        return this.sendMessage({
            type: 'rebound',
            metadata: outgoingMetadata,
            incomingMessageId: metadata ? metadata.messageId : undefined,
            data: reboundError
        });
    }

    async sendSnapshot(data, metadata) {
        await this._ensureConnection();

        const payload = JSON.stringify(data);
        return this.sendMessage({
            type: 'snapshot',
            data: payload,
            metadata
        });
    }

    _extractMessageMetadata(headers) {
        log.trace({ headers }, 'Extracting message metadata');
        const messageMetadataQuery = headers[MESSAGE_METADATA_QUERY_PARAM];
        if (!messageMetadataQuery) {
            log.error({ headers }, 'Missing metadata in message stream response');
            throw new Error('Missing metadata in message stream response');
        }

        let parsedMessageMetadata;
        try {
            parsedMessageMetadata = JSON.parse(messageMetadataQuery);
        } catch (e) {
            log.error({ messageMetadataQuery }, 'Failed to parse metadata JSON');
            throw new Error('Failed to parse metadata JSON');
        }
        log.debug({ parsedMessageMetadata }, 'Parsed metadata from query parameter');

        // Get meta headers
        const metaHeaderNames = Object.keys(parsedMessageMetadata)
            .filter(key => key.toLowerCase().startsWith(AMQP_HEADER_META_PREFIX));

        const metaHeaders = _.pick(parsedMessageMetadata, metaHeaderNames);
        const metaHeadersLowerCased = _.mapKeys(metaHeaders, (value, key) => key.toLowerCase());

        const result = {
            stepId: parsedMessageMetadata.stepId,
            ...metaHeadersLowerCased,
            threadId: parsedMessageMetadata.threadId || metaHeaders['x-eio-meta-trace-id'],
            messageId: parsedMessageMetadata.messageId,
            parentMessageId: parsedMessageMetadata.parentMessageId,
            protocolVersion: parsedMessageMetadata.protocolVersion
        };
        if (!result.threadId) {
            const threadId = uuid.v4();
            log.debug({ threadId }, 'Initiate new thread as it is not started ATM');
            result.threadId = threadId;
        }
        if (parsedMessageMetadata.reply_to) {
            result.reply_to = parsedMessageMetadata.reply_to;
        }
        log.debug({ result }, 'Extracted message metadata');
        return result;
    }
}

exports.ProxyClient = ProxyClient;
exports.MESSAGE_PROCESSING_STATUS = MESSAGE_PROCESSING_STATUS;
