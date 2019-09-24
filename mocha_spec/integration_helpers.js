const { EventEmitter } = require('events');

const _ = require('lodash');
const amqplib = require('amqplib');

const nock = require('nock');

const encryptor = require('../lib/encryptor.js');
const cipher = require('../lib/cipher.js');


const PREFIX = 'sailor_nodejs_integration_test';
//const env = process.env;

class AmqpHelper extends EventEmitter {
    constructor(config) {
        super();
        this._config = config;

        this._cryptoSettings = {
            password: config.ELASTICIO_MESSAGE_CRYPTO_PASSWORD,
            cryptoIV: config.ELASTICIO_MESSAGE_CRYPTO_IV
        };

        this.httpReplyQueueName = PREFIX + 'request_reply_queue';
        this.httpReplyQueueRoutingKey = PREFIX + 'request_reply_routing_key';
        this.nextStepQueue = PREFIX + '_next_step_queue';
        this.nextStepErrorQueue = PREFIX + '_next_step_queue_errors';

        this.dataMessages = [];
        this.errorMessages = [];
    }

    publishMessage(message, { parentMessageId, threadId } = {}, headers = {}) {
        return this.subscriptionChannel.publish(
            this._config.ELASTICIO_LISTEN_MESSAGES_ON,
            this._config.ELASTICIO_DATA_ROUTING_KEY,
            Buffer.from(encryptor.encryptMessageContent(this._cryptoSettings, message)),
            {
                headers: Object.assign(
                    {
                        execId: this._config.ELASTICIO_EXEC_ID,
                        taskId: this._config.ELASTICIO_FLOW_ID,
                        workspaceId: this._config.ELASTICIO_WORKSPACE_ID,
                        userId: this._config.ELASTICIO_USER_ID,
                        threadId,
                        messageId: parentMessageId
                    },
                    headers
                )
            }
        );
    }

    async _prepareQueues() {
        this._amqpConn = await amqplib.connect(this._config.ELASTICIO_AMQP_URI);
        const subscriptionChannel = await this._amqpConn.createChannel();
        const publishChannel = await this._amqpConn.createChannel();

        await subscriptionChannel.assertQueue(this._config.ELASTICIO_LISTEN_MESSAGES_ON);
        await publishChannel.assertQueue(this.nextStepQueue);
        await publishChannel.assertQueue(this.nextStepErrorQueue);

        const exchangeOptions = {
            durable: true,
            autoDelete: false
        };

        await subscriptionChannel.assertExchange(this._config.ELASTICIO_LISTEN_MESSAGES_ON, 'direct', exchangeOptions);
        await publishChannel.assertExchange(this._config.ELASTICIO_PUBLISH_MESSAGES_TO, 'direct', exchangeOptions);

        await subscriptionChannel.bindQueue(
            this._config.ELASTICIO_LISTEN_MESSAGES_ON,
            this._config.ELASTICIO_LISTEN_MESSAGES_ON,
            this._config.ELASTICIO_DATA_ROUTING_KEY);

        await publishChannel.bindQueue(
            this.nextStepQueue,
            this._config.ELASTICIO_PUBLISH_MESSAGES_TO,
            this._config.ELASTICIO_DATA_ROUTING_KEY);

        await publishChannel.bindQueue(
            this.nextStepErrorQueue,
            this._config.ELASTICIO_PUBLISH_MESSAGES_TO,
            this._config.ELASTICIO_ERROR_ROUTING_KEY);

        await publishChannel.assertQueue(this.httpReplyQueueName);
        await publishChannel.bindQueue(
            this.httpReplyQueueName,
            this._config.ELASTICIO_PUBLISH_MESSAGES_TO,
            this.httpReplyQueueRoutingKey);

        await publishChannel.purgeQueue(this.nextStepQueue);
        await publishChannel.purgeQueue(this.nextStepErrorQueue);
        await publishChannel.purgeQueue(this._config.ELASTICIO_LISTEN_MESSAGES_ON);

        this.subscriptionChannel = subscriptionChannel;
        this.publishChannel = publishChannel;
    }

    async cleanUp() {
        this.removeAllListeners();
        await Promise.all([
            this.publishChannel.cancel('sailor_nodejs_1'),
            this.publishChannel.cancel('sailor_nodejs_2'),
            this.publishChannel.cancel('sailor_nodejs_3')
        ]);
        if (this._amqpConn) {
            await this._amqpConn.close();
            this._amqpConn = null;
        }
    }

    async prepare() {
        await this._prepareQueues();

        await this.publishChannel.consume(
            this.nextStepQueue,
            this._consumer.bind(this, this.nextStepQueue),
            { consumerTag: 'sailor_nodejs_1' }
        );

        await this.publishChannel.consume(
            this.nextStepErrorQueue,
            this._consumer.bind(this, this.nextStepErrorQueue),
            { consumerTag: 'sailor_nodejs_2' }
        );

        await this.publishChannel.consume(
            this.httpReplyQueueName,
            this._consumer.bind(this, this.httpReplyQueueName),
            { consumerTag: 'sailor_nodejs_3' }
        );
    }

    _consumer(queue, message) {
        this.publishChannel.ack(message);
        let emittedMessage;
        if (queue === this.nextStepErrorQueue) {
            // Notice errors are encoded in slighlty other way then commond data messages
            emittedMessage = {
                error: cipher.decrypt(this._cryptoSettings, JSON.parse(message.content.toString()).error)
            };
        } else {
            emittedMessage = encryptor.decryptMessageContent(this._cryptoSettings, message.content.toString());
        }

        const data = {
            properties: message.properties,
            body: emittedMessage.body,
            emittedMessage
        };

        this.dataMessages.push(data);
        this.emit('data', data, queue);
    }
}

function prepareEnv() {
    // FIXME copy&pasted from mocha_spec/unit.sailor.js
    const config = {
        /************************ SAILOR ITSELF CONFIGURATION ***********************************/

        AMQP_URI: 'amqp://guest:guest@localhost:5672',
        API_URI: 'http://apihost.com',
        API_USERNAME: 'test@test.com',
        API_KEY: '5559edd',
        API_REQUEST_RETRY_DELAY: 100,
        API_REQUEST_RETRY_ATTEMPTS: 3,

        FLOW_ID: '5559edd38968ec0736000003',
        STEP_ID: 'step_1',
        EXEC_ID: 'some-exec-id',
        WORKSPACE_ID: '5559edd38968ec073600683',
        CONTAINER_ID: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',

        USER_ID: '5559edd38968ec0736000002',
        COMP_ID: '5559edd38968ec0736000456',
        FUNCTION: 'list',

        TIMEOUT: 3000,

        /************************ COMMUNICATION LAYER SETTINGS ***********************************/
        MESSAGE_CRYPTO_PASSWORD: 'testCryptoPassword',
        MESSAGE_CRYPTO_IV: 'iv=any16_symbols',

        LISTEN_MESSAGES_ON: '5559edd38968ec0736000003:step_1:1432205514864:messages',
        PUBLISH_MESSAGES_TO: 'userexchange:5527f0ea43238e5d5f000001',
        DATA_ROUTING_KEY: '5559edd38968ec0736000003:step_1:1432205514864:message',
        ERROR_ROUTING_KEY: '5559edd38968ec0736000003:step_1:1432205514864:error',
        REBOUND_ROUTING_KEY: '5559edd38968ec0736000003:step_1:1432205514864:rebound',
        SNAPSHOT_ROUTING_KEY: '5559edd38968ec0736000003:step_1:1432205514864:snapshot',

        DATA_RATE_LIMIT: 1000,
        ERROR_RATE_LIMIT: 1000,
        SNAPSHOT_RATE_LIMIT: 1000,
        RATE_INTERVAL: 1000,

        REBOUND_INITIAL_EXPIRATION: 15000,
        REBOUND_LIMIT: 5,

        RABBITMQ_PREFETCH_SAILOR: 1,

        /******************************* MINOR SHIT ********************************/
        COMP_NAME: 'does_NOT_MATTER',
        EXEC_TYPE: 'flow-step',
        FLOW_VERSION: '12345',
        TENANT_ID: 'tenant_id',
        CONTRACT_ID: 'contract_id',
        TASK_USER_EMAIL: 'fuck@you',// FIXME
        EXECUTION_RESULT_ID: '987654321',
        COMPONENT_PATH: '/mocha_spec/integration_component'
    };
    Object.assign(process.env, _.fromPairs(Object.entries(config).map(([k,v]) => ['ELASTICIO_' + k, v])));

    return process.env;
}

function mockApiTaskStepResponse(config, response) {
    const defaultResponse = {
        config: {
            apiKey: 'secret'
        },
        snapshot: {
            lastModifiedDate: 123456789
        }
    };

    nock(config.ELASTICIO_API_URI)
        .matchHeader('Connection', 'Keep-Alive')
        .get(`/v1/tasks/${config.ELASTICIO_FLOW_ID}/steps/${config.ELASTICIO_STEP_ID}`)
        .reply(200, Object.assign(defaultResponse, response));
}

exports.PREFIX = PREFIX;

exports.amqp = function amqp(config) {
    return new AmqpHelper(config);
};

exports.prepareEnv = prepareEnv;
exports.mockApiTaskStepResponse = mockApiTaskStepResponse;
