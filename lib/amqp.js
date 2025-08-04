const log = require('./logging.js');
const amqplib = require('amqplib');
const { IllegalOperationError } = require('amqplib/lib/error');
const Encryptor = require('./encryptor.js');
const _ = require('lodash');
const eventToPromise = require('event-to-promise');
const uuid = require('uuid');
const os = require('os');
const messagesDB = require('./messagesDB.js');
const assert = require('assert');

const HEADER_ROUTING_KEY = 'x-eio-routing-key';
const HEADER_ERROR_RESPONSE = 'x-eio-error-response';

class Amqp {
    constructor(settings) {
        this.settings = settings;
        this._encryptor = new Encryptor(this.settings.MESSAGE_CRYPTO_PASSWORD, this.settings.MESSAGE_CRYPTO_IV);
        this.closed = true;
        this.consume = undefined;
    }

    async connect() {
        await Promise.all([this._ensurePublishChannel(), this._ensureConsumerChannel()]);
        this.closed = false;
    }

    async disconnect() {
        await this.stopConsume();
        this.closed = true;
        log.trace('Close AMQP connections');
        if (this._readConnection) {
            this._readConnection.removeAllListeners('close');
        }
        if (this._writeConnection) {
            this._writeConnection.removeAllListeners('close');
        }
        if (this.consumerChannel) {
            this.consumerChannel.removeAllListeners('close');
        }
        if (this.publishChannel) {
            this.publishChannel.removeAllListeners('close');
        }
        try {
            await this.consumerChannel.close();
        } catch (alreadyClosed) {
            log.debug('Subscribe channel is closed already');
        }
        try {
            await this.publishChannel.close();
        } catch (alreadyClosed) {
            log.debug('Publish channel is closed already');
        }
        try {
            await this._readConnection.close();
        } catch (alreadyClosed) {
            log.debug('AMQP read connection is closed already');
        }
        try {
            await this._writeConnection.close();
        } catch (alreadyClosed) {
            log.debug('AMQP write connection is closed already');
        }
        log.debug('Successfully closed AMQP connections');
    }

    async _ensureReadConnection() {
        if (this._readConnection) {
            return this._readConnection;
        }
        if (this._creatingReadConnection) {
            do {
                await new Promise(resolve => setImmediate(resolve));
            } while (!this._readConnection);
            return this._readConnection;
        }
        log.debug('Creating new read connection');
        this._creatingReadConnection = true;
        this._readConnection = await this._createConnection('read');
        this._creatingReadConnection = false;
        log.debug('Read connection created');
        this._readConnection.on('error', err => log.error({ err }, 'AMQP read Connection error'));
        this._readConnection.once('close', err => {
            log.error({ err }, 'Unexpected connection close.');
            delete this._readConnection;
        });
        return this._readConnection;
    }

    async _ensureWriteConnection() {
        if (this._writeConnection) {
            return this._writeConnection;
        }
        if (this._creatingWriteConnection) {
            do {
                await new Promise(resolve => setImmediate(resolve));
            } while (!this._writeConnection);
            return this._writeConnection;
        }
        log.debug('Creating new write connection');
        this._creatingWriteConnection = true;
        this._writeConnection = await this._createConnection('write');
        this._creatingWriteConnection = false;
        log.debug('Write connection created');
        this._writeConnection.on('error', err => log.error({ err }, 'AMQP write Connection error'));
        this._writeConnection.once('close', err => {
            log.error({ err }, 'Unexpected connection close.');
            delete this._writeConnection;
        });
        return this._writeConnection;
    }

    async _ensureConsumerChannel() {
        if (this.consumerChannel) {
            return this.consumerChannel;
        }
        if (this._creatingConsumerChannel) {
            do {
                await new Promise(resolve => setImmediate(resolve));
            } while (!this.consumerChannel);
            return this.consumerChannel;
        }
        log.debug({ prefetch: this.settings.RABBITMQ_PREFETCH_SAILOR }, 'Creating new consume channel');
        this._creatingConsumerChannel = true;
        const amqp = await this._ensureReadConnection();
        this.consumerChannel = await amqp.createChannel();
        log.debug('Consume channel created');
        this._creatingConsumerChannel = false;
        this.consumerChannel.prefetch(this.settings.RABBITMQ_PREFETCH_SAILOR);
        this.consumerChannel.on('error', err => log.error({ err }, 'Consumer channel error'));
        this.consumerChannel.once('close', () => {
            delete this.consumerChannel;
            if (this.consume) {
                log.warn('Channel unexpectedly closed, but we were listening. Reconnecting and re-listening queue');
                this.consume.consumerTag = undefined;
                // when RabbitMQ closes connection, amqplib will first emit 'close' for channel and then for connection
                // we use setImmediate to wait for connection 'close' event which will unset connection property
                // otherwise listenQueue will try to create channel on closing connection and fail hard
                setImmediate(() => this.listenQueue(this.consume.queue, this.consume.messageHandler));
            }
        });
        return this.consumerChannel;
    }

    async _ensurePublishChannel() {
        if (this.publishChannel) {
            return this.publishChannel;
        }
        if (this._creatingPublishChannel) {
            do {
                await new Promise(resolve => setImmediate(resolve));
            } while (!this.publishChannel);
            return this.publishChannel;
        }
        log.debug('Creating new publish connection and channel');
        this._creatingPublishChannel = true;
        const amqp = await this._ensureWriteConnection();
        this.publishChannel = await amqp.createConfirmChannel();
        log.debug('Publish connection and channel created');
        this._creatingPublishChannel = false;
        this.publishChannel.on('error', err => log.error({ err }, 'Publish channel error'));
        this.publishChannel.once('close', () => {
            delete this.publishChannel;
        });
        return this.publishChannel;
    }

    async _createConnection(name) {
        const uri = this.settings.AMQP_URI;
        const allowedAttempts = parseInt(this.settings.AMQP_RECONNECT_ATTEMPTS);
        let lastErr;
        let attempts = 0;
        while (attempts <= allowedAttempts) {
            if (attempts > 0) {
                await new Promise(resolve => setTimeout(resolve, parseInt(this.settings.AMQP_RECONNECT_TIMEOUT)));
                log.debug(
                    {
                        reconnectAttempt: attempts,
                        AMQP_RECONNECT_ATTEMPTS: this.settings.AMQP_RECONNECT_ATTEMPTS
                    },
                    'AMQP Reconnecting'
                );
            }
            try {
                return await amqplib.connect(uri,
                    { clientProperties: { connection_name: `${os.hostname()}-${name}` } });
            } catch (err) {
                lastErr = err;
                log.error(err, 'AMQP Connection error');
                attempts++;
            }
        }
        throw lastErr;
    }

    async stopConsume() {
        if (!this.consume) {
            return;
        }
        const consume = this.consume;
        this.consume = undefined;
        await this.consumerChannel.cancel(consume.consumerTag);
        log.debug({ queue: consume.queue }, 'Stopped listening for messages');
    }

    async listenQueue(queue, messageHandler) {
        await this._ensureConsumerChannel();

        const { consumerTag } = await this.consumerChannel.consume(queue, async (amqpMessage) => {
            if (!amqpMessage) {
                log.warn('Consumer cancelled by rabbitmq');
                return;
            }
            let message;
            try {
                message = this._decodeMessage(amqpMessage);
            } catch (err) {
                log.error({ err, deliveryTag: amqpMessage.fields.deliveryTag },
                    'Error occurred while parsing message payload');
                this.rejectOriginal(amqpMessage);
                return;
            }
            try {
                await messageHandler(message, amqpMessage);
            } catch (err) {
                log.error({ err, deliveryTag: amqpMessage.fields.deliveryTag }, 'Failed to process message, reject');
                this.rejectOriginal(amqpMessage);
            }
        });
        log.debug({ queue }, 'Started listening for messages');
        this.consume = { queue, messageHandler, consumerTag };
    }

    _decodeMessage(amqpMessage) {
        log.trace('Message received');
        let message;
        if (this.settings.INPUT_FORMAT === 'error') {
            message = this._decodeErrorMessage(amqpMessage);
        } else {
            message = this._decodeDefaultMessage(amqpMessage);
        }
        message.headers = message.headers || {};
        if (amqpMessage.properties.headers.reply_to) {
            message.headers.reply_to = amqpMessage.properties.headers.reply_to;
        }
        return message;
    }

    _decodeDefaultMessage(amqpMessage) {
        const protocolVersion = Number(amqpMessage.properties.headers.protocolVersion || 1);
        return this._encryptor.decryptMessageContent(
            amqpMessage.content,
            protocolVersion < 2 ? 'base64' : undefined
        );
    }

    _decodeErrorMessage(amqpMessage) {
        const errorBody = JSON.parse(amqpMessage.content.toString());
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
            headers: amqpMessage.properties.headers
        };
    }

    decryptMessage(callback, message) {
        log.trace('Message received');

        if (message === null) {
            log.warn('NULL message received');
            return;
        }

        const protocolVersion = Number(message.properties.headers.protocolVersion || 1);
        let decryptedContent;
        try {
            decryptedContent = this._encryptor.decryptMessageContent(
                message.content,
                protocolVersion < 2 ? 'base64' : undefined
            );
        } catch (err) {
            log.error(err,
                'Error occurred while parsing message #%j payload',
                message.fields.deliveryTag
            );
            // I didn't find a quick way to use reject that waits for new message when
            // connection is re-established, so simply try to reject original message
            // This will be fixed when we implement to Sailor Proxy
            return this.rejectOriginal(message);
        }
        decryptedContent.headers = decryptedContent.headers || {};
        if (message.properties.headers.reply_to) {
            decryptedContent.headers.reply_to = message.properties.headers.reply_to;
        }

        try {
            // pass to callback both decrypted content & original message
            callback(decryptedContent, message);
        } catch (err) {
            log.error(err, 'Failed to process message #%j, reject', message.fields.deliveryTag);
            // I didn't find a quick way to use reject that waits for new message when
            // connection is re-established, so simply try to reject original message
            // This will be fixed when we implement to Sailor Proxy
            return this.rejectOriginal(message);
        }
    }

    async getMostRecentMessage(messageId) {
        let message = messagesDB.getMessageById(messageId);
        assert(message, `Message with ID ${messageId} not found in messagesDB`);
        // If we stopped listening fo the new messages or the message was received
        // from the same channel we can return it immediately
        if (!this.consume || message.fields.consumerTag === this.consume.consumerTag) {
            return message;
        }
        log.debug({ messageId }, 'Waiting for message from new channel');
        message = await new Promise((resolve) => {
            const onMessageUpdated = (updatedMessageId, updatedMessage) => {
                if (updatedMessageId === messageId
                    && updatedMessage.fields.consumerTag === this.consume.consumerTag) {
                    messagesDB.off('messageUpdated', onMessageUpdated);
                    resolve(updatedMessage);
                }
            };
            messagesDB.on('messageUpdated', onMessageUpdated);
        });
        log.debug({ messageId }, 'Message received from new channel');
        return message;
    }

    async ack(messageId) {
        const message = await this.getMostRecentMessage(messageId);
        log.debug(message.fields, 'Message ack');
        this.consumerChannel.ack(message);
        messagesDB.deleteMessage(messageId);
    }

    async reject(messageId) {
        const message = await this.getMostRecentMessage(messageId);
        log.debug(message.fields, 'Message reject');
        this.consumerChannel.reject(message, false);
        messagesDB.deleteMessage(messageId);
    }

    rejectOriginal(message) {
        log.debug('Message #%j reject', message.fields.deliveryTag);
        return this.consumerChannel.reject(message, false);
    }

    async sendToExchange(exchangeName, routingKey, payload, options, throttle) {
        if (throttle) {
            log.debug('Throttling outgoing message');
            await throttle();
        }
        const buffer = Buffer.from(payload);

        return this.publishMessage(exchangeName, routingKey, buffer, options, 0);
    }

    async publishMessage(exchangeName, routingKey, payloadBuffer, options, iteration) {
        const settings = this.settings;
        if (iteration) {
            options.headers.retry = iteration;
        }
        // AMQP_PERSISTENT_MESSAGES is false by default if not specified by env var
        options.persistent = this.settings.AMQP_PERSISTENT_MESSAGES;

        log.debug('Current memory usage: %s Mb', process.memoryUsage().heapUsed / 1048576);
        log.trace('Pushing to exchange=%s, routingKey=%s, messageSize=%d, options=%j, iteration=%d',
            exchangeName, routingKey, payloadBuffer.length, options, iteration);
        try {
            const result = await this._promisifiedPublish(exchangeName, routingKey, payloadBuffer, options);
            if (!result) {
                log.warn('Buffer full when publishing a message to '
                    + 'exchange=%s with routingKey=%s', exchangeName, routingKey);
            }
            return result;
        } catch (error) {
            if (error instanceof IllegalOperationError) {
                log.error(error, `Failed on publishing ${options.headers.messageId} message to MQ`);
                throw new Error(`Failed on publishing ${options.headers.messageId} message to MQ: ` + error);
            }
            log.error(error, 'Failed on publishing message to queue');
            const delay = this._getDelay(
                settings.AMQP_PUBLISH_RETRY_DELAY,
                settings.AMQP_PUBLISH_MAX_RETRY_DELAY,
                iteration
            );
            await this._sleep(delay);
            iteration += 1;
            if (iteration < settings.AMQP_PUBLISH_RETRY_ATTEMPTS) {
                return this.publishMessage(exchangeName, routingKey, payloadBuffer, options, iteration);
            } else {
                throw new Error(`Failed on publishing ${options.headers.messageId} message to MQ: ` + error);
            }
        }
    }

    _getDelay(defaultDelay, maxDelay, iteration) {
        log.debug({ defaultDelay }, 'Current delay');
        log.debug({ maxDelay }, 'Current delay');
        const delay = Math.min(defaultDelay * Math.pow(2, iteration), maxDelay);
        log.debug({ delay }, 'Calculated delay');
        return delay;
    }

    async _sleep(time) {
        await new Promise(resolve => setTimeout(resolve, time));
    }

    async _promisifiedPublish(exchangeName, routingKey, payloadBuffer, options) {
        await this._ensurePublishChannel();
        try {
            let result;
            const publishChannel = this.publishChannel;
            const publishPromise = new Promise((resolve, reject) => {
                result = publishChannel.publish(exchangeName, routingKey, payloadBuffer, options, (err, ok) => {
                    err ? reject(err) : resolve(ok);
                });
            });
            await Promise.all([
                (async () => {
                    if (this.settings.PROCESS_AMQP_DRAIN && !result) {
                        log.debug('Amqp buffer is full: waiting for drain event..');
                        await eventToPromise(this.publishChannel, 'drain');
                        log.debug('Amqp buffer drained!');
                        result = true;
                    }
                })(),
                publishPromise
            ]);
            return result;
        } catch (error) {
            throw error;
        }
    }

    encryptMessageContent(body, protocolVersion = 1) {
        return this._encryptor.encryptMessageContent(
            body,
            protocolVersion < 2
                ? 'base64'
                : undefined
        );
    }

    async prepareMessageAndSendToExchange(data, properties, routingKey, throttle) {
        const settings = this.settings;

        data.headers = filterMessageHeaders(data.headers);
        const protocolVersion = Number(properties.headers.protocolVersion || 1);
        const encryptedData = this.encryptMessageContent(data, protocolVersion);

        if (encryptedData.length > settings.OUTGOING_MESSAGE_SIZE_LIMIT) {
            const error = new Error(`Outgoing message size ${encryptedData.length}`
                + ` exceeds limit of ${settings.OUTGOING_MESSAGE_SIZE_LIMIT}.`);
            log.error(error);
            throw error;
        }

        return this.sendToExchange(settings.PUBLISH_MESSAGES_TO, routingKey, encryptedData, properties, throttle);
    }

    async sendData(data, headers, throttle) {
        const properties = this._createPropsFromHeaders(headers);
        const settings = this.settings;
        const routingKey = getRoutingKeyFromHeaders(data.headers) || settings.DATA_ROUTING_KEY;
        properties.headers.protocolVersion = settings.PROTOCOL_VERSION;
        return this.prepareMessageAndSendToExchange(data, properties, routingKey, throttle);
    }

    async sendHttpReply(data, headers) {
        const properties = this._createPropsFromHeaders(headers);
        const routingKey = headers.reply_to;
        properties.headers.protocolVersion = 1;

        if (!routingKey) {
            throw new Error(`Component emitted 'httpReply' event but 'reply_to' was not found in AMQP headers`);
        }
        return this.prepareMessageAndSendToExchange(data, properties, routingKey);
    }

    async sendError(err, headers, originalMessage, throttle) {
        // NOTICE both error and errorInput are transferred as base64 encoded.
        // this does not depend on protocolVersion header of message (see _decodeDefaultMessage or sendData methods)
        // this should be fixed in future, but it's OK at this moment
        const properties = this._createPropsFromHeaders(headers);
        const settings = this.settings;

        const encryptedError = this._encryptor.encryptMessageContent({
            name: err.name,
            message: err.message,
            stack: err.stack
        }, 'base64').toString();

        const payload = {
            error: encryptedError
        };
        if (originalMessage && originalMessage.content) {
            const protocolVersion = Number(originalMessage.properties.headers.protocolVersion || 1);
            if (protocolVersion >= 2) {
                payload.errorInput = this._encryptor.encryptMessageContent(
                    this._encryptor.decryptMessageContent(originalMessage.content),
                    'base64'
                ).toString();
            } else {
                payload.errorInput = originalMessage.content.toString();
            }
        }
        const errorPayload = JSON.stringify(payload);

        let result = this.sendToExchange(
            settings.PUBLISH_MESSAGES_TO,
            settings.ERROR_ROUTING_KEY,
            errorPayload, properties,
            throttle
        );

        if (!settings.NO_ERROR_REPLIES && headers.reply_to) {
            log.debug('Sending error to %s', headers.reply_to);
            const replyToOptions = _.cloneDeep(properties);
            replyToOptions.headers[HEADER_ERROR_RESPONSE] = true;
            result = this.sendToExchange(settings.PUBLISH_MESSAGES_TO,
                headers.reply_to, encryptedError, replyToOptions);
        }

        return result;
    }

    async sendRebound(reboundError, originalMessage, outgoingHeaders) {
        const { settings } = this;
        let { properties: { headers } } = originalMessage;
        headers = {
            ...headers,
            end: new Date().getTime(),
            reboundReason: reboundError.message
        };
        log.trace('Rebound message');
        let reboundIteration = 1;

        if (headers.reboundIteration && typeof headers.reboundIteration === 'number') {
            reboundIteration = headers.reboundIteration + 1;
        }

        if (reboundIteration > settings.REBOUND_LIMIT) {
            return this.sendError(
                new Error('Rebound limit exceeded'),
                outgoingHeaders,
                originalMessage
            );
        } else {
            const properties = {
                ...originalMessage.properties,
                // retry in 15 sec, 30 sec, 1 min, 2 min, 4 min, 8 min, etc.
                expiration: Math.pow(2, reboundIteration - 1) * settings.REBOUND_INITIAL_EXPIRATION,
                headers: {
                    ...headers,
                    reboundIteration
                }
            };

            return this.sendToExchange(
                settings.PUBLISH_MESSAGES_TO,
                settings.REBOUND_ROUTING_KEY,
                originalMessage.content,
                properties
            );
        }
    }

    async sendSnapshot(data, headers, throttle) {
        const settings = this.settings;
        const exchange = settings.PUBLISH_MESSAGES_TO;
        const routingKey = settings.SNAPSHOT_ROUTING_KEY;
        const payload = JSON.stringify(data);
        const properties = this._createPropsFromHeaders(headers);
        return this.sendToExchange(exchange, routingKey, payload, properties, throttle);
    }

    _createPropsFromHeaders(headers) {
        return {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                ...headers,
                messageId: headers.messageId || uuid.v4()
            }
        };
    }
}

function getRoutingKeyFromHeaders(headers) {
    if (!headers) {
        return null;
    }

    function headerNamesToLowerCase(result, value, key) {
        result[key.toLowerCase()] = value;
    }

    const lowerCaseHeaders = _.transform(headers, headerNamesToLowerCase, {});

    return lowerCaseHeaders[HEADER_ROUTING_KEY];
}

function filterMessageHeaders(headers = {}) {
    return _.transform(headers, (result, value, key) => {
        if ([HEADER_ROUTING_KEY].includes(key.toLowerCase())) {
            return;
        }
        result[key] = value;
    }, {});
}

exports.Amqp = Amqp;
