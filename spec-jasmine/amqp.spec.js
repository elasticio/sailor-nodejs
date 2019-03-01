describe('AMQP', () => {
    process.env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD = 'testCryptoPassword';
    process.env.ELASTICIO_MESSAGE_CRYPTO_IV = 'iv=any16_symbols';

    const envVars = {};
    envVars.ELASTICIO_AMQP_URI = 'amqp://test2/test2';
    envVars.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
    envVars.ELASTICIO_STEP_ID = 'step_1';
    envVars.ELASTICIO_EXEC_ID = 'some-exec-id';

    envVars.ELASTICIO_USER_ID = '5559edd38968ec0736000002';
    envVars.ELASTICIO_COMP_ID = '5559edd38968ec0736000456';
    envVars.ELASTICIO_FUNCTION = 'list';

    envVars.ELASTICIO_LISTEN_MESSAGES_ON = '5559edd38968ec0736000003:step_1:1432205514864:messages';
    envVars.ELASTICIO_PUBLISH_MESSAGES_TO = 'userexchange:5527f0ea43238e5d5f000001';
    envVars.ELASTICIO_DATA_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:message';
    envVars.ELASTICIO_ERROR_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:error';
    envVars.ELASTICIO_REBOUND_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:rebound';
    envVars.ELASTICIO_SNAPSHOT_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:snapshot';

    envVars.ELASTICIO_API_URI = 'http://apihost.com';
    envVars.ELASTICIO_API_USERNAME = 'test@test.com';
    envVars.ELASTICIO_API_KEY = '5559edd';

    const Amqp = require('../src/amqp.js').Amqp;
    const settings = require('../src/settings.js').readFrom(envVars);
    const encryptor = require('../src/encryptor.js');
    const _ = require('lodash');

    const message = {
        fields: {
            consumerTag: 'abcde',
            deliveryTag: 12345,
            exchange: 'test',
            routingKey: 'test.hello'
        },
        properties: {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            headers: {
                taskId: 'task1234567890',
                execId: 'exec1234567890',
                reply_to: 'replyTo1234567890'
            },
            deliveryMode: undefined,
            priority: undefined,
            correlationId: undefined,
            replyTo: undefined,
            expiration: undefined,
            messageId: undefined,
            timestamp: undefined,
            type: undefined,
            userId: undefined,
            appId: undefined,
            mandatory: true,
            clusterId: ''
        },
        content: encryptor.encryptMessageContent({ content: 'Message content' })
    };

    beforeEach(() => {
        spyOn(encryptor, 'decryptMessageContent').and.callThrough();
    });

    it('Should send message to outgoing channel when process data', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456'
            }
        };

        await amqp.sendData({
            headers: {
                'some-other-header': 'headerValue'
            },
            body: 'Message content'
        }, props);

        expect(amqp.publishChannel.publish).toHaveBeenCalled();
        expect(amqp.publishChannel.publish).toHaveBeenCalledTimes(1);

        const publishParameters = amqp.publishChannel.publish.calls.argsFor(0);
        expect(publishParameters).toEqual([
            settings.PUBLISH_MESSAGES_TO,
            settings.DATA_ROUTING_KEY,
            jasmine.any(Object),
            props
        ]);

        const payload = encryptor.decryptMessageContent(publishParameters[2].toString());
        expect(payload).toEqual({
            headers: {
                'some-other-header': 'headerValue'
            },
            body: 'Message content'
        });
    });

    it('Should sendHttpReply to outgoing channel using routing key from headers when process data', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const msg = {
            statusCode: 200,
            headers: {
                'content-type': 'text/plain'
            },
            body: 'OK'
        };

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456',
                reply_to: 'my-special-routing-key'
            }
        };
        await amqp.sendHttpReply(msg, props);

        expect(amqp.publishChannel.publish).toHaveBeenCalled();
        expect(amqp.publishChannel.publish).toHaveBeenCalledTimes(1);

        const publishParameters = amqp.publishChannel.publish.calls.argsFor(0);
        expect(publishParameters[0]).toEqual(settings.PUBLISH_MESSAGES_TO);
        expect(publishParameters[1]).toEqual('my-special-routing-key');
        expect(publishParameters[2].toString()).toEqual(encryptor.encryptMessageContent(msg));
        expect(publishParameters[3]).toEqual(props);

        const payload = encryptor.decryptMessageContent(publishParameters[2].toString());
        expect(payload).toEqual(msg);
    });

    it('Should throw error in sendHttpReply if reply_to header not found', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const msg = {
            statusCode: 200,
            headers: {
                'content-type': 'text/plain'
            },
            body: 'OK'
        };

        try {
            await amqp.sendHttpReply(msg, {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456'
                }
            });
        } catch (e) {
            expect(e.message).toEqual('Component emitted \'httpReply\' event but \'reply_to\' was not found in AMQP headers');
        }

        expect(amqp.publishChannel.publish).not.toHaveBeenCalled();
    });

    it('Should send message to outgoing channel using routing key from headers when process data', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const msg = {
            headers: {
                'X-EIO-Routing-Key': 'my-special-routing-key'
            },
            body: {
                content: 'Message content'
            }
        };

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456'
            }
        };

        await amqp.sendData(msg, props);

        expect(amqp.publishChannel.publish).toHaveBeenCalled();
        expect(amqp.publishChannel.publish).toHaveBeenCalledTimes(1);

        const publishParameters = amqp.publishChannel.publish.calls.argsFor(0);
        expect(publishParameters).toEqual([
            settings.PUBLISH_MESSAGES_TO,
            'my-special-routing-key',
            jasmine.any(Object),
            props
        ]);

        const payload = encryptor.decryptMessageContent(publishParameters[2].toString());
        expect(payload).toEqual({
            headers: {},
            body: {
                content: 'Message content'
            }
        });
    });

    it('Should send message to errors when process error', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456'
            }
        };

        await amqp.sendError(new Error('Test error'), props, message.content);

        expect(amqp.publishChannel.publish).toHaveBeenCalled();
        expect(amqp.publishChannel.publish).toHaveBeenCalledTimes(1);

        const publishParameters = amqp.publishChannel.publish.calls.argsFor(0);
        expect(publishParameters).toEqual([
            settings.PUBLISH_MESSAGES_TO,
            settings.ERROR_ROUTING_KEY,
            jasmine.any(Object),
            props
        ]);

        const payload = JSON.parse(publishParameters[2].toString());
        payload.error = encryptor.decryptMessageContent(payload.error);
        payload.errorInput = encryptor.decryptMessageContent(payload.errorInput);

        expect(payload).toEqual({
            error: {
                name: 'Error',
                message: 'Test error',
                stack: jasmine.any(String)
            },
            errorInput: {
                content: 'Message content'
            }
        });
    });

    it('Should send message to errors using routing key from headers when process error', async () => {
        const expectedErrorPayload = {
            error: {
                name: 'Error',
                message: 'Test error',
                stack: jasmine.any(String)
            },
            errorInput: {
                content: 'Message content'
            }
        };

        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456',
                reply_to: 'my-special-routing-key'
            }
        };

        await amqp.sendError(new Error('Test error'), props, message.content);

        expect(amqp.publishChannel.publish).toHaveBeenCalled();
        expect(amqp.publishChannel.publish).toHaveBeenCalledTimes(2);

        let publishParameters = amqp.publishChannel.publish.calls.argsFor(0);
        expect(publishParameters.length).toEqual(4);
        expect(publishParameters[0]).toEqual(settings.PUBLISH_MESSAGES_TO);
        expect(publishParameters[1]).toEqual('5559edd38968ec0736000003:step_1:1432205514864:error');
        expect(publishParameters[3]).toEqual(props);

        let payload = JSON.parse(publishParameters[2].toString());
        payload.error = encryptor.decryptMessageContent(payload.error);
        payload.errorInput = encryptor.decryptMessageContent(payload.errorInput);

        expect(payload).toEqual(expectedErrorPayload);

        publishParameters = amqp.publishChannel.publish.calls.argsFor(1);
        expect(publishParameters.length).toEqual(4);
        expect(publishParameters[0]).toEqual(settings.PUBLISH_MESSAGES_TO);
        expect(publishParameters[1]).toEqual('my-special-routing-key');
        expect(publishParameters[3]).toEqual({
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                'taskId': 'task1234567890',
                'stepId': 'step_456',
                'reply_to': 'my-special-routing-key',
                'x-eio-error-response': true
            }
        });

        payload = encryptor.decryptMessageContent(publishParameters[2].toString());

        expect(payload).toEqual(expectedErrorPayload.error);
    });

    it('Should not provide errorInput if errorInput was empty', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456'
            }
        };

        await amqp.sendError(new Error('Test error'), props, '');

        expect(amqp.publishChannel.publish).toHaveBeenCalled();
        expect(amqp.publishChannel.publish).toHaveBeenCalledTimes(1);

        const publishParameters = amqp.publishChannel.publish.calls.argsFor(0);
        expect(publishParameters[0]).toEqual(settings.PUBLISH_MESSAGES_TO);
        expect(publishParameters[1]).toEqual('5559edd38968ec0736000003:step_1:1432205514864:error');

        const payload = JSON.parse(publishParameters[2].toString());
        payload.error = encryptor.decryptMessageContent(payload.error);

        expect(payload).toEqual({
            error: {
                name: 'Error',
                message: 'Test error',
                stack: jasmine.any(String)
            }
            // no errorInput should be here
        });

        expect(publishParameters[3]).toEqual(props);
    });

    it('Should not provide errorInput if errorInput was null', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456'
            }
        };

        await amqp.sendError(new Error('Test error'), props, null);

        expect(amqp.publishChannel.publish).toHaveBeenCalled();
        expect(amqp.publishChannel.publish).toHaveBeenCalledTimes(1);

        const publishParameters = amqp.publishChannel.publish.calls.argsFor(0);

        expect(publishParameters[0]).toEqual(settings.PUBLISH_MESSAGES_TO);
        expect(publishParameters[1]).toEqual('5559edd38968ec0736000003:step_1:1432205514864:error');

        const payload = JSON.parse(publishParameters[2].toString());
        payload.error = encryptor.decryptMessageContent(payload.error);

        expect(payload).toEqual({
            error: {
                name: 'Error',
                message: 'Test error',
                stack: jasmine.any(String)
            }
            // no errorInput should be here
        });

        expect(publishParameters[3]).toEqual(props);
    });

    it('Should send message to rebounds when rebound happened', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                execId: 'exec1234567890',
                taskId: 'task1234567890',
                stepId: 'step_1',
                compId: 'comp1',
                function: 'list',
                start: '1432815685034'
            }
        };

        await amqp.sendRebound(new Error('Rebound error'), message, props);

        expect(amqp.publishChannel.publish).toHaveBeenCalled();
        expect(amqp.publishChannel.publish).toHaveBeenCalledTimes(1);

        const publishParameters = amqp.publishChannel.publish.calls.argsFor(0);
        expect(publishParameters).toEqual([
            settings.PUBLISH_MESSAGES_TO,
            settings.REBOUND_ROUTING_KEY,
            jasmine.any(Object),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                expiration: 15000,
                headers: {
                    execId: 'exec1234567890',
                    taskId: 'task1234567890',
                    stepId: 'step_1',
                    compId: 'comp1',
                    function: 'list',
                    start: '1432815685034',
                    reboundIteration: 1
                }
            }
        ]);

        const payload = encryptor.decryptMessageContent(publishParameters[2].toString());
        expect(payload).toEqual({ content: 'Message content' });
    });

    it('Should send message to rebounds with reboundIteration=3', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                execId: 'exec1234567890',
                taskId: 'task1234567890',
                stepId: 'step_1',
                compId: 'comp1',
                function: 'list',
                start: '1432815685034'
            }
        };

        const clonedMessage = _.cloneDeep(message);
        clonedMessage.properties.headers.reboundIteration = 2;

        await amqp.sendRebound(new Error('Rebound error'), clonedMessage, props);

        expect(amqp.publishChannel.publish).toHaveBeenCalled();
        expect(amqp.publishChannel.publish).toHaveBeenCalledTimes(1);

        const publishParameters = amqp.publishChannel.publish.calls.argsFor(0);
        expect(publishParameters).toEqual([
            settings.PUBLISH_MESSAGES_TO,
            settings.REBOUND_ROUTING_KEY,
            jasmine.any(Object),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                expiration: 60000,
                headers: {
                    execId: 'exec1234567890',
                    taskId: 'task1234567890',
                    stepId: 'step_1',
                    compId: 'comp1',
                    function: 'list',
                    start: '1432815685034',
                    reboundIteration: 3
                }
            }
        ]);

        const payload = encryptor.decryptMessageContent(publishParameters[2].toString());
        expect(payload).toEqual({ content: 'Message content' });
    });

    it('Should send message to errors when rebound limit exceeded', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = jasmine.createSpyObj('publishChannel', ['publish']);

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                execId: 'exec1234567890',
                taskId: 'task1234567890',
                stepId: 'step_1',
                compId: 'comp1',
                function: 'list',
                start: '1432815685034'
            }
        };

        const clonedMessage = _.cloneDeep(message);
        clonedMessage.properties.headers.reboundIteration = 100;

        await amqp.sendRebound(new Error('Rebound error'), clonedMessage, props);

        expect(amqp.publishChannel.publish).toHaveBeenCalled();
        expect(amqp.publishChannel.publish).toHaveBeenCalledTimes(1);

        const publishParameters = amqp.publishChannel.publish.calls.argsFor(0);
        expect(publishParameters).toEqual([
            settings.PUBLISH_MESSAGES_TO,
            settings.ERROR_ROUTING_KEY,
            jasmine.any(Object),
            props
        ]);

        const payload = JSON.parse(publishParameters[2].toString());
        payload.error = encryptor.decryptMessageContent(payload.error);
        payload.errorInput = encryptor.decryptMessageContent(payload.errorInput);

        expect(payload.error.message).toEqual('Rebound limit exceeded');
        expect(payload.errorInput).toEqual({ content: 'Message content' });
    });

    it('Should ack message when confirmed', () => {
        const amqp = new Amqp();
        amqp.subscribeChannel = jasmine.createSpyObj('subscribeChannel', ['ack']);

        amqp.ack(message);

        expect(amqp.subscribeChannel.ack).toHaveBeenCalled();
        expect(amqp.subscribeChannel.ack).toHaveBeenCalledTimes(1);
        expect(amqp.subscribeChannel.ack.calls.argsFor(0)[0]).toEqual(message);
    });

    it('Should reject message when ack is called with false', () => {
        const amqp = new Amqp(settings);
        amqp.subscribeChannel = jasmine.createSpyObj('subscribeChannel', ['reject']);
        amqp.reject(message);

        expect(amqp.subscribeChannel.reject).toHaveBeenCalled();
        expect(amqp.subscribeChannel.reject).toHaveBeenCalledTimes(1);
        expect(amqp.subscribeChannel.reject.calls.argsFor(0)[0]).toEqual(message);
        expect(amqp.subscribeChannel.reject.calls.argsFor(0)[1]).toEqual(false);
    });

    it('Should listen queue and pass decrypted message to client function', async () => {
        const amqp = new Amqp(settings);
        const clientFunction = jasmine.createSpy('clientFunction');
        amqp.subscribeChannel = jasmine.createSpyObj('subscribeChannel', ['consume', 'prefetch']);
        await amqp.subscribeChannel.consume.and.callFake((queueName, callback) => {
            callback(message);
        });

        await amqp.listenQueue('testQueue', clientFunction);

        expect(amqp.subscribeChannel.prefetch).toHaveBeenCalledWith(1);
        expect(clientFunction).toHaveBeenCalledTimes(1);
        expect(clientFunction.calls.argsFor(0)[0]).toEqual(
            {
                headers: {
                    reply_to: 'replyTo1234567890'
                },
                content: 'Message content'
            }
        );
        expect(clientFunction.calls.argsFor(0)[1]).toEqual(message);
        expect(clientFunction.calls.argsFor(0)[1].content).toEqual(encryptor.encryptMessageContent({ content: 'Message content' }));
        expect(encryptor.decryptMessageContent).toHaveBeenCalledWith(message.content, message.properties.headers);
    });

    it('Should disconnect from all channels and connection', async () => {
        const amqp = new Amqp(settings);
        amqp.subscribeChannel = jasmine.createSpyObj('subscribeChannel', ['close']);
        amqp.publishChannel = jasmine.createSpyObj('subscribeChannel', ['close']);
        amqp.amqp = jasmine.createSpyObj('amqp', ['close']);

        await amqp.disconnect();

        expect(amqp.subscribeChannel.close).toHaveBeenCalledTimes(1);
        expect(amqp.publishChannel.close).toHaveBeenCalledTimes(1);
        expect(amqp.amqp.close).toHaveBeenCalledTimes(1);
    });
});
