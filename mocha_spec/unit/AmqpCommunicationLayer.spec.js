const chai = require('chai');
const sinon = require('sinon');
chai.use(require('sinon-chai'));
const { expect } = chai;

const AmqpCommunicationLayer = require('../..//lib/amqp.js').AmqpCommunicationLayer;
const AmqpConnWrapper = require('../../lib/AmqpConnWrapper.js');
const encryptor = require('../../lib/encryptor.js');
const _ = require('lodash');

async function waitsFor(cb, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (cb()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('timeout waiting condition');
}


describe('AMQP', () => {
    let config;
    let cryptoSettings;
    let message;
    let sandbox;
    let amqpConn;
    let publishChannel;
    let subscribeChannel;
    let logger;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        config = {
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

            RABBITMQ_PREFETCH_SAILOR: 1
        };
        cryptoSettings = {
            password: config.MESSAGE_CRYPTO_PASSWORD,
            cryptoIV: config.MESSAGE_CRYPTO_IV
        };
        message = {
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
            content: encryptor.encryptMessageContent(cryptoSettings, { content: 'Message content' })
        };
        sandbox.spy(encryptor, 'decryptMessageContent');
        amqpConn = new AmqpConnWrapper(),
        publishChannel = {
            publish: sandbox.stub().returns(true),
            waitForConfirms: sandbox.stub().resolves([null]),
            on: sandbox.stub()
        };
        subscribeChannel = {
            ack: sandbox.stub(),
            reject: sandbox.stub(),
            consume: sandbox.stub().returns('tag'),
            prefetch: sandbox.stub()
        };
        sandbox.stub(amqpConn, 'getPublishChannel').returns(publishChannel);
        sandbox.stub(amqpConn, 'getSubscribeChannel').returns(subscribeChannel);
        logger = {
            error: sandbox.stub(),
            info: sandbox.stub(),
            debug: sandbox.stub(),
            trace: sandbox.stub()
        };
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('Should send message to outgoing channel when process data', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

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

        expect(publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            config.PUBLISH_MESSAGES_TO,
            config.DATA_ROUTING_KEY,
            sinon.match(arg => {
                const payload = encryptor.decryptMessageContent(cryptoSettings, arg.toString());
                expect(payload).to.deep.equal({
                    headers: {
                        'some-other-header': 'headerValue'
                    },
                    body: 'Message content'
                });
                return true;
            }),
            props
        );
    });

    it('Should send message async to outgoing channel when process data', async () => {
        config.DATA_RATE_LIMIT = 1;
        config.RATE_INTERVAL = 500;

        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);
        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456'
            }
        };
        const start = Date.now();
        for (let i = 0; i < 3; i++) {
            await amqp.sendData({
                headers: {
                    'some-other-header': 'headerValue'
                },
                body: 'Message content'
            }, props);
        }
        const duration = Math.round((Date.now() - start) / 1000);
        // Total duration should be around 1 seconds, because
        // first goes through
        // second throttled for 500ms
        // third throttled for another 500 ms
        expect(duration).to.equal(1);
        new Array(3).fill(null).reduce(
            expector => expector.and.calledWith(
                config.PUBLISH_MESSAGES_TO,
                config.DATA_ROUTING_KEY,
                sinon.match(arg => {
                    const payload = encryptor.decryptMessageContent(cryptoSettings, arg.toString());
                    expect(payload).to.deep.equal({
                        headers: {
                            'some-other-header': 'headerValue'
                        },
                        body: 'Message content'
                    });
                    return true;
                }),
                props
            ),
            expect(publishChannel.publish).to.have.been.calledThrice
        );
    });

    it('Should sendHttpReply to outgoing channel using routing key from headers when process data', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

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
        expect(publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            config.PUBLISH_MESSAGES_TO,
            'my-special-routing-key',
            sinon.match(arg =>
                expect(arg.toString()).to.equal(encryptor.encryptMessageContent(cryptoSettings, msg)) || true),
            props
        );
    });

    it('Should throw error in sendHttpReply if reply_to header not found', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

        const msg = {
            statusCode: 200,
            headers: {
                'content-type': 'text/plain'
            },
            body: 'OK'
        };
        let caughtError;
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
            caughtError = e;
        }
        expect(publishChannel.publish).not.to.have.been.called;
        expect(caughtError).instanceof(Error);
    });

    it('Should send message to outgoing channel using routing key from headers when process data', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

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

        expect(publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            config.PUBLISH_MESSAGES_TO,
            'my-special-routing-key',
            sinon.match(arg => {
                const payload = encryptor.decryptMessageContent(cryptoSettings, arg.toString());
                expect(payload).to.deep.equal({
                    headers: {},
                    body: {
                        content: 'Message content'
                    }
                });
                return true;
            }),
            props
        );
    });

    it('Should send message to errors when process error', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);
        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456'
            }
        };
        const error = new Error('Test error');
        await amqp.sendError(error, props, message.content);
        expect(publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            config.PUBLISH_MESSAGES_TO,
            config.ERROR_ROUTING_KEY,
            sinon.match(arg => {
                arg = JSON.parse(arg);
                const payload = {
                    error: encryptor.decryptMessageContent(cryptoSettings, arg.error),
                    errorInput: encryptor.decryptMessageContent(cryptoSettings, arg.errorInput)
                };
                expect(payload).to.deep.equal({
                    error: {
                        name: 'Error',
                        message: 'Test error',
                        stack: error.stack
                    },
                    errorInput: {
                        content: 'Message content'
                    }
                });
                return true;
            }),
            props
        );
    });

    it('Should send message to errors using routing key from headers when process error', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

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

        const error = new Error('Test error');
        const expectedErrorPayload = {
            error: {
                name: 'Error',
                message: 'Test error',
                stack: error.stack
            },
            errorInput: {
                content: 'Message content'
            }
        };

        await amqp.sendError(error, props, message.content);
        expect(publishChannel.publish).to.have.been.calledTwice
            .and.calledWith(
                config.PUBLISH_MESSAGES_TO,
                config.ERROR_ROUTING_KEY,
                sinon.match(arg => {
                    const parsed = JSON.parse(arg.toString());
                    expect({
                        error: encryptor.decryptMessageContent(cryptoSettings, parsed.error),
                        errorInput: encryptor.decryptMessageContent(cryptoSettings, parsed.errorInput)
                    }).to.deep.equal(expectedErrorPayload);
                    return true;
                }),
                props
            )
            .and.calledWith(
                config.PUBLISH_MESSAGES_TO,
                'my-special-routing-key',
                sinon.match(arg => {
                    expect(encryptor.decryptMessageContent(cryptoSettings, arg.toString())).to.deep.equal({
                        name: error.name,
                        message: error.message,
                        stack: error.stack
                    });
                    return true;
                }),
                {
                    contentType: 'application/json',
                    contentEncoding: 'utf8',
                    mandatory: true,
                    headers: {
                        'taskId': 'task1234567890',
                        'stepId': 'step_456',
                        'reply_to': 'my-special-routing-key',
                        'x-eio-error-response': true
                    }
                }
            );
    });

    it('Should not provide errorInput if errorInput was empty', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456'
            }
        };
        const error = new Error('Test error');

        amqp.sendError(error, props, '');
        await amqp.sendError(error, props, message.content);
        expect(publishChannel.publish).to.have.been.calledTwice
            .and.calledWith(
                config.PUBLISH_MESSAGES_TO,
                config.ERROR_ROUTING_KEY,
                sinon.match(arg => {
                    arg = JSON.parse(arg.toString());
                    const payload = {
                        error: encryptor.decryptMessageContent(cryptoSettings, arg.error)
                    };
                    expect(payload).to.deep.equal({
                        error: {
                            name: 'Error',
                            message: 'Test error',
                            stack: error.stack
                        }
                    });
                    return true;
                }),
                props
            );
    });

    it('Should not provide errorInput if errorInput was null', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

        const props = {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            mandatory: true,
            headers: {
                taskId: 'task1234567890',
                stepId: 'step_456'
            }
        };

        const error = new Error('Test error');
        await amqp.sendError(error, props, '');
        expect(publishChannel.publish).to.have.been.calledOnce
            .and.calledWith(
                config.PUBLISH_MESSAGES_TO,
                config.ERROR_ROUTING_KEY,
                sinon.match(arg => {
                    arg = JSON.parse(arg.toString());
                    const payload = {
                        error: encryptor.decryptMessageContent(cryptoSettings, arg.error)
                    };
                    expect(payload).to.deep.equal({
                        error: {
                            name: 'Error',
                            message: 'Test error',
                            stack: error.stack
                        }
                    });
                    return true;
                }),
                props
            );
    });

    it('Should send message to rebounds when rebound happened', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

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

        const error = new Error('Rebound error');
        await amqp.sendRebound(error, message, props);
        expect(publishChannel.publish).to.have.been.calledOnce
            .and.calledWith(
                config.PUBLISH_MESSAGES_TO,
                config.REBOUND_ROUTING_KEY,
                sinon.match(arg => {
                    expect(encryptor.decryptMessageContent(cryptoSettings, arg.toString())).to.deep.equal({
                        content: 'Message content'
                    });
                    return true;
                }),
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
            );
    });

    it('Should send message to rebounds with reboundIteration=3', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

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

        const error = new Error('Rebound error');
        await amqp.sendRebound(error, clonedMessage, props);
        expect(publishChannel.publish).to.have.been.calledOnce
            .and.calledWith(
                config.PUBLISH_MESSAGES_TO,
                config.REBOUND_ROUTING_KEY,
                sinon.match(arg => {
                    expect(encryptor.decryptMessageContent(cryptoSettings, arg.toString())).to.deep.equal({
                        content: 'Message content'
                    });
                    return true;
                }),
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
            );
    });

    it('Should send message to errors when rebound limit exceeded', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

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
        const error = new Error('Rebound error');
        await amqp.sendRebound(error, clonedMessage, props);
        expect(publishChannel.publish).to.have.been.calledOnce
            .and.calledWith(
                config.PUBLISH_MESSAGES_TO,
                config.ERROR_ROUTING_KEY,
                sinon.match(arg => {
                    const payload = JSON.parse(arg.toString());
                    expect(encryptor.decryptMessageContent(cryptoSettings, payload.error)).to.contain({
                        message: 'Rebound limit exceeded',
                        name: 'Error'
                    });
                    expect(encryptor.decryptMessageContent(cryptoSettings, payload.errorInput)).to.deep.equal({
                        content: 'Message content'
                    });
                    return true;
                }),
                props
            );
    });


    it('Should ack message when confirmed', () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);

        amqp.ack(message);
        expect(subscribeChannel.ack).to.have.been.calledOnce.and.calledWith(message);
    });

    it('Should reject message when ack is called with false', () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);
        amqp.reject(message);

        expect(subscribeChannel.reject).to.have.been.calledOnce.and.calledWith(message, false);
    });

    it('Should listen queue and pass decrypted message to client function', async () => {
        const amqp = new AmqpCommunicationLayer(amqpConn, config, logger);
        const clientFunction = sandbox.stub();
        subscribeChannel.consume.callsFake((queueName, callback) => {
            callback(message);
        });

        const promise = waitsFor(() => clientFunction.callCount > 0, 1000);
        await amqp.listenQueue(clientFunction);
        await promise;

        expect(subscribeChannel.prefetch).to.have.been.calledOnce.and.calledWith(config.RABBITMQ_PREFETCH_SAILOR);
        expect(clientFunction).to.have.been.calledOnce.and.calledWith(
            {
                headers: {
                    reply_to: 'replyTo1234567890'
                },
                content: 'Message content'
            },
            message
        );
        expect(encryptor.decryptMessageContent).to.have.been.calledOnce
            .and.calledWith(cryptoSettings, message.content);
    });
});
