const { Connection } = require('amqplib-as-promised');
const { EventEmitter } = require('events');
const PREFIX = 'sailor_nodejs_integration_test';
const nock = require('nock');
const env = process.env;

class AmqpHelper extends EventEmitter {
    constructor () {
        super();

        this.httpReplyQueueName = PREFIX + 'request_reply_queue';
        this.httpReplyQueueRoutingKey = PREFIX + 'request_reply_routing_key';
        this.nextStepQueue = PREFIX + '_next_step_queue';
        this.nextStepErrorQueue = PREFIX + '_next_step_queue_errors';
    }

    prepareEnv () {
        env.ELASTICIO_LISTEN_MESSAGES_ON = PREFIX + ':messages';
        env.ELASTICIO_PUBLISH_MESSAGES_TO = PREFIX + ':exchange';
        env.ELASTICIO_DATA_ROUTING_KEY = PREFIX + ':routing_key:message';
        env.ELASTICIO_ERROR_ROUTING_KEY = PREFIX + ':routing_key:error';
        env.ELASTICIO_REBOUND_ROUTING_KEY = PREFIX + ':routing_key:rebound';
        env.ELASTICIO_SNAPSHOT_ROUTING_KEY = PREFIX + ':routing_key:snapshot';
        env.ELASTICIO_TIMEOUT = 3000;
    }

    publishMessage (message, { parentMessageId, traceId } = {}, headers = {}) {
        return this.subscriptionChannel.publish(
            env.ELASTICIO_LISTEN_MESSAGES_ON,
            env.ELASTICIO_DATA_ROUTING_KEY,
            Buffer.from(JSON.stringify(message)),
            {
                headers: Object.assign({
                    'execId': env.ELASTICIO_EXEC_ID,
                    'taskId': env.ELASTICIO_FLOW_ID,
                    'userId': env.ELASTICIO_USER_ID,
                    'x-eio-meta-trace-id': traceId,
                    'messageId': parentMessageId
                }, headers)
            });
    }

    async prepareQueues () {
        const connection = new Connection(env.ELASTICIO_AMQP_URI);
        await connection.init();

        const exchangeOptions = { durable: true, autoDelete: false };
        const subscriptionChannel = await connection.createChannel();
        const publishChannel = await connection.createChannel();
        await subscriptionChannel.assertQueue(env.ELASTICIO_LISTEN_MESSAGES_ON);
        await publishChannel.assertQueue(this.nextStepQueue);
        await publishChannel.assertQueue(this.nextStepErrorQueue);
        await subscriptionChannel.assertExchange(env.ELASTICIO_LISTEN_MESSAGES_ON, 'direct', exchangeOptions);
        await publishChannel.assertExchange(env.ELASTICIO_PUBLISH_MESSAGES_TO, 'direct', exchangeOptions);
        await subscriptionChannel.bindQueue(
            env.ELASTICIO_LISTEN_MESSAGES_ON,
            env.ELASTICIO_LISTEN_MESSAGES_ON,
            env.ELASTICIO_DATA_ROUTING_KEY
        );

        await publishChannel.bindQueue(
            this.nextStepQueue,
            env.ELASTICIO_PUBLISH_MESSAGES_TO,
            env.ELASTICIO_DATA_ROUTING_KEY
        );

        await publishChannel.bindQueue(
            this.nextStepErrorQueue,
            env.ELASTICIO_PUBLISH_MESSAGES_TO,
            env.ELASTICIO_ERROR_ROUTING_KEY
        );

        await publishChannel.assertQueue(this.httpReplyQueueName);
        await publishChannel.bindQueue(
            this.httpReplyQueueName,
            env.ELASTICIO_PUBLISH_MESSAGES_TO,
            this.httpReplyQueueRoutingKey
        );

        this.subscriptionChannel = subscriptionChannel;
        this.publishChannel = publishChannel;
    }

    cleanUp () {
        this.removeAllListeners();
        return Promise.all([
            this.publishChannel.cancel('sailor_nodejs_1'),
            this.publishChannel.cancel('sailor_nodejs_2'),
            this.publishChannel.cancel('sailor_nodejs_3')
        ]);
    }

    async prepare () {
        this.prepareEnv();
        await this.prepareQueues();

        await this.publishChannel.consume(
            this.nextStepQueue,
            this.consumer.bind(this, this.nextStepQueue),
            { consumerTag: 'sailor_nodejs_1' }
        );

        await this.publishChannel.consume(
            this.nextStepErrorQueue,
            this.consumer.bind(this, this.nextStepErrorQueue),
            { consumerTag: 'sailor_nodejs_2' }
        );

        await this.publishChannel.consume(
            this.httpReplyQueueName,
            this.consumer.bind(this, this.httpReplyQueueName),
            { consumerTag: 'sailor_nodejs_3' }
        );
    }

    consumer (queue, message) {
        this.publishChannel.ack(message);

        const emittedMessage = JSON.parse(message.content.toString());
        const data = { properties: message.properties, body: emittedMessage.body, emittedMessage };

        this.emit('data', data, queue);
    }
}

function prepareEnv () {
    env.ELASTICIO_AMQP_URI = 'amqp://guest:guest@localhost:5672';
    env.ELASTICIO_RABBITMQ_PREFETCH_SAILOR = '10';
    env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
    env.ELASTICIO_STEP_ID = 'step_1';
    env.ELASTICIO_EXEC_ID = 'some-exec-id';
    env.ELASTICIO_USER_ID = '5559edd38968ec0736000002';
    env.ELASTICIO_COMP_ID = '5559edd38968ec0736000456';
    env.ELASTICIO_COMPONENT_PATH = '/spec-mocha/integration_component';
    env.ELASTICIO_API_URI = 'https://apidotelasticidotio';
    env.ELASTICIO_API_USERNAME = 'test@test.com';
    env.ELASTICIO_API_KEY = '5559edd';
    env.ELASTICIO_FLOW_WEBHOOK_URI = 'https://in.elastic.io/hooks/' + env.ELASTICIO_FLOW_ID;
    env.DEBUG = 'sailor:debug';
}

function mockApiTaskStepResponse (response) {
    const defaultResponse = {
        config: {
            apiKey: 'secret'
        },
        snapshot: {
            lastModifiedDate: 123456789
        }
    };

    nock(env.ELASTICIO_API_URI)
        .get(`/v1/tasks/${env.ELASTICIO_FLOW_ID}/steps/${env.ELASTICIO_STEP_ID}`)
        .reply(200, Object.assign(defaultResponse, response));
}

exports.PREFIX = PREFIX;
exports.prepareEnv = prepareEnv;
exports.mockApiTaskStepResponse = mockApiTaskStepResponse;
exports.amqp = () => new AmqpHelper();
