const assert = require('assert');
const _ = require('lodash');
const eventToPromise = require('event-to-promise');
const pThrottle = require('p-throttle');

const encryptor = require('./encryptor.js');

const HEADER_ROUTING_KEY = 'x-eio-routing-key';
const HEADER_ERROR_RESPONSE = 'x-eio-error-response';
function copyAmqpHeadersToMessage(amqpMsg, msg) {
    const source = amqpMsg.properties.headers;

    if (!msg.headers) {
        msg.headers = {};
    }

    if (source.reply_to) {
        msg.headers.reply_to = source.reply_to;
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
// FIXME transform to tree of files => base/children
/**
 * Interface that abstracts communucation layer
 * Potentially will be used for to start sailor locally over non-amqp transport
 */
class BaseCommunicationLayer {
    listen() {
        throw new Error('implement me');
    }

    ack() {
        throw new Error('implement me');
    }
    reject() {
        throw new Error('implement me');
    }
    sendData() {
        throw new Error('implement me');
    }
    sendHttpReply() {
        throw new Error('implement me');
    }
    sendError() {
        throw new Error('implement me');
    }
    sendRebound() {
        throw new Error('implement me');
    }
    sendSnapshot() {
        throw new Error('implement me');
    }

    getEncryptionId() {
        throw new Error('implement me');
    }
}

/**
 *
 * MESSAGE_CRYPTO_PASSWORD
 * MESSAGE_CRYPTO_IV
 *
 * DATA_RATE_LIMIT
 * RATA_RATE_INTERVAL
 *
 * LISTEN_MESSAGES_ON
 * PUBLISH_MESSAGES_TO
 * DATA_ROUTING_KEY
 * ERROR_ROUTING_KEY
 * REBOUND_ROUTING_KEY
 * SNAPSHOT_ROUTING_KEY
 *
 * REBOUND_INITIAL_EXPIRATION
 * REBOUND_LIMIT
 * PRPCESS_AMQP_DRAIN
 * AMQP_PUBLISH_RETRY_DELAY
 * AMQP_PUBLISH_RETRY_ATTEMPTS
 * RABBITMQ_PREFETCH_SAILOR
 */
class AmqpCommunicationLayer extends BaseCommunicationLayer {
    constructor(amqpConn, settings, logger) {
        super();
        this._conn = amqpConn;
        this._logger = logger;
        //this._conn.getSubscribeChannel() = amqpConn.getSubscribeChannel();
        //this._conn.getPublishChannel() = amqpConn.getPublishChannel();
        this.settings = settings;
        this._cryptoSettings = {
            password: settings.MESSAGE_CRYPTO_PASSWORD,
            cryptoIV: settings.MESSAGE_CRYPTO_IV
        };

        // FIXME  tests for throttling
        this._throttles = {
            // 100 Messages per Second
            data: pThrottle(
                () => Promise.resolve(true),
                Number(settings.DATA_RATE_LIMIT), // FIXME numerization into config module
                Number(settings.RATE_INTERVAL)
            ),
            error: pThrottle(
                () => Promise.resolve(true),
                Number(settings.ERROR_RATE_LIMIT),
                Number(settings.RATE_INTERVAL),
            ),
            snapshot: pThrottle(
                () => Promise.resolve(true),
                Number(settings.SNAPSHOT_RATE_LIMIT),
                Number(settings.RATE_INTERVAL)
            )
        };
    }

    async listenQueue(callback) {
        assert(!this._consumerTag, 'Can not listen more then once');
        // FIXME numerization in cofnig
        this._conn.getSubscribeChannel().prefetch(Number(this.settings.RABBITMQ_PREFETCH_SAILOR));
        this._logger.debug('Start listening for messages on %s', this.settings.LISTEN_MESSAGES_ON);
        this._consumerTag = await this._conn.getSubscribeChannel()
            .consume(this.settings.LISTEN_MESSAGES_ON, async (message) => {
                this._logger.trace('Message received: %j', message);

                if (message === null) {
                    this._logger.warn('NULL message received');
                    return;
                }

                let decryptedContent;
                try {
                    decryptedContent = encryptor.decryptMessageContent(this._cryptoSettings, message.content);
                } catch (err) {
                    this._logger.error(err,
                        'Error occurred while parsing message #%j payload',
                        message.fields.deliveryTag,
                    );
                    return this.reject(message);
                }

                copyAmqpHeadersToMessage(message, decryptedContent);

                // FIXME that's not communication layer responsibility to handle errors
                try {
                    // pass to callback both decrypted content & original message
                    await callback(decryptedContent, message);
                } catch (err) {
                    this._logger.error(err, 'Failed to process message #%j, reject', message.fields.deliveryTag);
                    return this.reject(message);
                }
            });
    }
    // FIXME TESTS
    async unlistenQueue() {
        if (this._consumerTag) {
            await this._conn.getSubscribeChannel().cancel(this._consumerTag.consumerTag);
            this._consumerTag = null;
        }
    }

    ack(message) {
        this._logger.debug('Message #%j ack', message.fields.deliveryTag);
        this._conn.getSubscribeChannel().ack(message);
    }

    reject(message) {
        this._logger.debug('Message #%j reject', message.fields.deliveryTag);
        return this._conn.getSubscribeChannel().reject(message, false);
    }

    async sendData(data, properties) {
        const throttle = this._throttles.data;
        const settings = this.settings;

        const msgHeaders = data.headers || {};

        const routingKey = getRoutingKeyFromHeaders(msgHeaders) || settings.DATA_ROUTING_KEY;

        return this._prepareMessageAndSendToExchange(data, properties, routingKey, throttle);
    }

    async sendHttpReply(data, properties) {
        const routingKey = properties.headers.reply_to;

        if (!routingKey) {
            throw new Error(`Component emitted 'httpReply' event but 'reply_to' was not found in AMQP headers`);
        }
        return this._prepareMessageAndSendToExchange(data, properties, routingKey);
    }

    async sendError(err, properties, originalMessageContent) {
        const throttle = this._throttles.error;
        const settings = this.settings;
        const headers = properties.headers;

        const encryptedError = encryptor.encryptMessageContent(this._cryptoSettings, {
            name: err.name,
            message: err.message,
            stack: err.stack
        });

        const payload = {
            error: encryptedError
        };

        if (originalMessageContent && originalMessageContent !== '') {
            payload.errorInput = originalMessageContent.toString();
        }
        const errorPayload = JSON.stringify(payload);

        let result = await this._sendToExchange(settings.PUBLISH_MESSAGES_TO, settings.ERROR_ROUTING_KEY,
            errorPayload, properties, throttle);

        if (headers.reply_to) {
            this._logger.debug('Sending error to %s', headers.reply_to);
            const replyToOptions = _.cloneDeep(properties);
            replyToOptions.headers[HEADER_ERROR_RESPONSE] = true;
            result = await this._sendToExchange(settings.PUBLISH_MESSAGES_TO,
                headers.reply_to, encryptedError, replyToOptions);
        }

        return result;
    }

    async sendRebound(reboundError, originalMessage, properties) {
        const settings = this.settings;
        function getReboundIteration(previousIteration) {
            if (previousIteration && typeof previousIteration === 'number') {
                return previousIteration + 1;
            }
            return 1;
        }

        // retry in 15 sec, 30 sec, 1 min, 2 min, 4 min, 8 min, etc.
        function getExpiration(iteration) {
            return Math.pow(2, iteration - 1) * settings.REBOUND_INITIAL_EXPIRATION;
        }

        this._logger.trace('Rebound message: %j', originalMessage);
        const reboundIteration = getReboundIteration(originalMessage.properties.headers.reboundIteration);

        if (reboundIteration > settings.REBOUND_LIMIT) {
            return this.sendError(
                new Error('Rebound limit exceeded'),
                properties,
                originalMessage.content
            );
        } else {
            properties.expiration = getExpiration(reboundIteration);
            properties.headers.reboundIteration = reboundIteration;
            return this._sendToExchange(
                settings.PUBLISH_MESSAGES_TO,
                settings.REBOUND_ROUTING_KEY,
                originalMessage.content,
                properties
            );
        }

    }

    async sendSnapshot(data, properties) {
        const throttle = this._throttles.snapshot;
        const settings = this.settings;
        const exchange = settings.PUBLISH_MESSAGES_TO;
        const routingKey = settings.SNAPSHOT_ROUTING_KEY;
        let payload;
        payload = JSON.stringify(data);
        return this._sendToExchange(exchange, routingKey, payload, properties, throttle);
    }

    async _sendToExchange(exchangeName, routingKey, payload, options, throttle) {
        if (throttle) {
            await throttle();
        }
        this._logger.trace('Pushing to exchange=%s, routingKey=%s, data=%j, '
            + 'options=%j', exchangeName, routingKey, payload, options);
        this._logger.debug('Current memory usage: %s Mb', process.memoryUsage().heapUsed / 1048576);

        const result = await this._publishMessage(exchangeName, routingKey, Buffer.from(payload), options, 0);
        if (this.settings.PROCESS_AMQP_DRAIN) {
            if (result) {
                return result;
            } else {
                this._logger.debug('Amqp buffer is full: waiting for drain event..');
                return eventToPromise(this._conn.getPublishChannel(), 'drain').then(() => true);
            }
        } else {
            return result;
        }
    }

    getEncryptionId() {
        return encryptor.getEncryptionId();
    }

    async _publishMessage(exchangeName, routingKey, payloadBuffer, options, iteration) {
        const settings = this.settings;
        const result = this._conn.getPublishChannel().publish(exchangeName, routingKey, payloadBuffer, options);
        if (!result) {
            this._logger.warn('Buffer full when publishing a message to '
                + 'exchange=%s with routingKey=%s', exchangeName, routingKey);
        }

        try {
            await this._conn.getPublishChannel().waitForConfirms();
        } catch (error) {
            this._logger.error('Failed on publishing message to queue');
            await new Promise(resolve => { setTimeout(resolve, settings.AMQP_PUBLISH_RETRY_DELAY); });
            iteration += 1;
            if (iteration < settings.AMQP_PUBLISH_RETRY_ATTEMPTS) {
                return await this._publishMessage(exchangeName, routingKey, payloadBuffer, options, iteration);
            } else {
                throw new Error(`failed on publishing ${options.headers.messageId} message to MQ: ` + error);
            }
        }

        return result;
    }

    async _prepareMessageAndSendToExchange(data, properties, routingKey, throttle) {
        const settings = this.settings;
        data.headers = filterMessageHeaders(data.headers);
        const encryptedData = encryptor.encryptMessageContent(this._cryptoSettings, data);

        return this._sendToExchange(settings.PUBLISH_MESSAGES_TO, routingKey, encryptedData, properties, throttle);
    }
}

module.exports.AmqpCommunicationLayer = AmqpCommunicationLayer;
