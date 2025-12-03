const log = require('./logging.js');
const Encryptor = require('./encryptor.js');
const _ = require('lodash');
const eventToPromise = require('event-to-promise');
const uuid = require('uuid');
const http2 = require('http2');

const {
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_METHOD,
    HTTP2_HEADER_AUTHORIZATION,
    HTTP2_HEADER_STATUS
} = http2.constants;

// TODO: ?
const HEADER_ROUTING_KEY = 'x-eio-routing-key';
const HEADER_ERROR_RESPONSE = 'x-eio-error-response';
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
        this.cipher = this._encryptor.createCipher();
        this.decipher = this._encryptor.createDecipher();
        this.closed = true;
        this.clientSession = null;
        const username = settings.API_USERNAME;
        const password = settings.API_KEY;
        if (!username || !password) {
            throw new Error('API_USERNAME and API_KEY must be set to connect to Sailor Proxy');
        }
        this.authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }

    isConnected() {
        return !this.closed && this.clientSession && !this.clientSession.destroyed;
    }

    async connect() {
        // TODO: add error handling & retries
        this.clientSession = http2.connect(this.settings.SAILOR_PROXY_URI);
        this.closed = false;
    }

    async disconnect() {
        this.closed = true;
        return new Promise((resolve) => {
            // TODO: what if disconnect is called  when we are receiving a messages
            // - how to send outgoing message in that case?
            this.clientSession.close(() => {
                log.debug('Successfully closed AMQP connections');
                resolve();
            });
        });
    }

    async fetchMessageBody(message, logger) {
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

        try {
            // TODO: proxy fix - auth
            const getObjectStream = this.clientSession.request({
                [HTTP2_HEADER_PATH]: `/objects/${objectId}`,
                [HTTP2_HEADER_METHOD]: 'GET',
                [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
            }).pipe(this.decipher);
            object = await new Promise((resolve, reject) => {
                const chunks = [];
                getObjectStream.on('data', chunk => {
                    chunks.push(chunk);
                });
                getObjectStream.on('end', () => {
                    logger.info('Message stream ended by server');
                    const buffer = Buffer.concat(chunks);
                    logger.info({ messageSize: buffer.length }, 'Received complete message from server');
                    resolve({ data: JSON.parse(buffer.toString()) });
                });
                // TODO: proxy fix - error handling
            });
        } catch (e) {
            log.error(e);
            throw new Error(`Failed to get message body with id=${objectId}`);
        }

        logger.info('Successfully obtained message body.', { objectId });
        logger.trace('Message body object received');

        return object.data;
    }

    uploadMessageBody(bodyBuf) {
        return new Promise((resolve, reject) => {
            const postMessageStream = this.clientSession.request({
                [HTTP2_HEADER_PATH]: '/objects',
                [HTTP2_HEADER_METHOD]: 'POST',
                [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
            }).pipe(this.cipher);

            postMessageStream.on('response', (headers, flags) => {
                const status = headers[http2.constants.HTTP2_HEADER_STATUS];
                if (status !== 200) {
                    return reject(new Error(`Failed to upload message body, status code: ${status}`));
                }
            });
            let responseData = '';
            postMessageStream.on('data', chunk => {
                responseData += chunk;
            });
            postMessageStream.on('end', () => {
                try {
                    const responseJson = JSON.parse(responseData);
                    resolve(responseJson.objectId);
                } catch (e) {
                    reject(new Error('Failed to parse upload response JSON'));
                }
            });

            postMessageStream.write(bodyBuf);
            postMessageStream.end();

        });
    }

    async listenForMessages(messageHandler) {
        //await this._ensureConsumerChannel();

        while (!this.closed) {
            const prefetch = 1;
            for (let i = 0; i < prefetch; i += 1) {
                const queryParams = new URLSearchParams({
                    stepId: this.settings.STEP_ID,
                    prefetch
                }).toString();
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
                });

                const { headers: msgHeaders, message } = this._decodeMessage(body, this._extractProxyHeaders(headers));
                const msgJson = JSON.parse(message);
                await messageHandler(msgHeaders, msgJson);
            }
        }
    }

    async sendMessage({
        incomingMessageId,
        type,
        data,
        headers
    }) {
        const proxyHeaders = this._createProxyHeaders(headers);
        const queryParams = new URLSearchParams({
            incomingMessageId,
            stepId: this.settings.STEP_ID,
            type
        }).toString();
        const postMessageStream = this.clientSession.request({
            ...proxyHeaders,
            [HTTP2_HEADER_PATH]: `/message?${queryParams}`,
            [HTTP2_HEADER_METHOD]: 'POST',
            [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
        });
        postMessageStream.write(data);
        postMessageStream.end();
        // TODO add retry logic
        return new Promise((resolve, reject) => {
            postMessageStream.on('response', (headers) => {
                log.debug({ status: headers[HTTP2_HEADER_STATUS] }, 'Send message response');
            });

            postMessageStream.on('end', () => {
                log.debug('Server finished processing');
                resolve();
            });

            postMessageStream.on('error', reject);
        });
    }

    // TODO add JSDOC everywhere related to proxy
    _decodeMessage(originalMessage, headers) {
        log.trace('Message received');
        let message;
        if (this.settings.INPUT_FORMAT === 'error') {
            message = this._decodeErrorMessage(originalMessage, headers);
        } else {
            message = this._decodeDefaultMessage(originalMessage, headers);
        }
        message.headers = message.headers || {};
        if (headers.reply_to) {
            message.headers.reply_to = headers.reply_to;
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
        // NOTICE both error and errorInput are transferred as base64 encoded.
        // this does not depend on protocolVersion header of message (see _decodeDefault message)
        // this should be fixed in future, but it's OK at this moment
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

    finishProcessing(incomingHeaders, status) {
        if (Object.values(MESSAGE_PROCESSING_STATUS).indexOf(status) === -1) {
            throw new Error(`Invalid message processing status: ${status}`);
        }
        const incomingMessageId = incomingHeaders.messageId;
        log.debug({ incomingMessageId, status }, 'Finishing processing of message');
        const queryParams = new URLSearchParams({
            incomingMessageId,
            status
        }).toString();
        const postMessageStream = this.clientSession.request({
            [HTTP2_HEADER_PATH]: `/finish-processing?${queryParams}`,
            [HTTP2_HEADER_METHOD]: 'POST',
            [HTTP2_HEADER_AUTHORIZATION]: this.authHeader
        });
        postMessageStream.end();
        // TODO add retry logic
        return new Promise((resolve, reject) => {
            postMessageStream.on('response', (headers) => {
                log.debug({ status: headers[HTTP2_HEADER_STATUS] }, 'Send message response');
            });

            postMessageStream.on('end', () => {
                log.debug('Server finished processing');
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
        // NOTICE both error and errorInput are transferred as base64 encoded.
        // this does not depend on protocolVersion header of message (see _decodeDefaultMessage or sendData methods)
        // this should be fixed in future, but it's OK at this moment
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
        outgoingHeaders.end = new Date().getTime();
        outgoingHeaders.reboundReason = reboundError.message;
        // TODO: retries
        return this.sendMessage({
            type: 'rebound',
            headers: outgoingHeaders,
            incomingMessageId: incomingHeaders ? incomingHeaders.messageId : undefined
        });
    }

    async sendSnapshot(data, headers) {
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
            acc[`${PROXY_FORWARD_HEADER_PREFIX}${key.toLowerCase()}`] = value;
            return acc;
        }, {});
    }

    _extractProxyHeaders(proxyHeaders) {
        const headers = Object.entries(proxyHeaders || {}).reduce((acc, [key, value]) => {
            if (key.toLowerCase().startsWith(PROXY_FORWARD_HEADER_PREFIX)) {
                const originalKey = key.substring(PROXY_FORWARD_HEADER_PREFIX.length);
                acc[originalKey] = value;
            }
            return acc;
        }, {});

        // TODO: move to proxy
        // Get meta headers
        const metaHeaderNames = Object.keys(headers)
            .filter(key => key.toLowerCase().startsWith(AMQP_HEADER_META_PREFIX));

        const metaHeaders = _.pick(headers, metaHeaderNames);
        const metaHeadersLowerCased = _.mapKeys(metaHeaders, (value, key) => key.toLowerCase());

        const result = {
            stepId: headers.stepId, // the only use is passthrough mechanism
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
        if (headers.reply_to) {
            result.reply_to = headers.reply_to;
        }
        return result;
    }
}

exports.ProxyClient = ProxyClient;
exports.MESSAGE_PROCESSING_STATUS = MESSAGE_PROCESSING_STATUS;
