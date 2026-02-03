const chai = require('chai');
const sinon = require('sinon');
const { expect } = chai;
chai.use(require('sinon-chai'));

const uuid = require('uuid');
const _ = require('lodash');
const pThrottle = require('p-throttle');

const Settings = require('../../lib/settings');
const Encryptor = require('../../lib/encryptor.js');
const Amqp = require('../../lib/amqp.js').Amqp;

describe('AMQP', () => {
    let envVars;
    let sandbox;
    let encryptor;
    let message;
    let settings;
    beforeEach(() => {
        envVars = {};
        envVars.ELASTICIO_AMQP_URI = 'amqp://test2/test2';
        envVars.ELASTICIO_AMQP_PUBLISH_RETRY_ATTEMPTS = 10;
        envVars.ELASTICIO_AMQP_PUBLISH_MAX_RETRY_DELAY = 60 * 1000;

        envVars.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
        envVars.ELASTICIO_STEP_ID = 'step_1';
        envVars.ELASTICIO_EXEC_ID = 'some-exec-id';
        envVars.ELASTICIO_WORKSPACE_ID = '5559edd38968ec073600683';
        envVars.ELASTICIO_CONTAINER_ID = 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948';

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
        envVars.ELASTICIO_MESSAGE_CRYPTO_PASSWORD = 'testCryptoPassword';
        envVars.ELASTICIO_MESSAGE_CRYPTO_IV = 'iv=any16_symbols';

        settings = Settings.readFrom(envVars);
        encryptor = new Encryptor(settings.MESSAGE_CRYPTO_PASSWORD, settings.MESSAGE_CRYPTO_IV);

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
                    reply_to: 'replyTo1234567890',
                    protocolVersion: 2
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
                persistent: false,
                clusterId: ''
            },
            content: encryptor.encryptMessageContent({ content: 'Message content' })
        };
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('Should send message to outgoing channel when process data', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };

        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            protocolVersion: 2,
            messageId
        };

        await amqp.sendData({
            headers: {
                'some-other-header': 'headerValue',
                messageId
            },
            body: 'Message content'
        }, headers);

        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            settings.DATA_ROUTING_KEY,
            sinon.match(buf => {
                const payload = encryptor.decryptMessageContent(buf, 'base64');
                expect(payload).to.deep.equal({
                    headers: {
                        'some-other-header': 'headerValue',
                        messageId
                    },
                    body: 'Message content'
                });
                return true;
            }),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: false,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456',
                    protocolVersion: 1,
                    messageId
                }
            },
            sinon.match.func
        );
    });

    it('Should publish with persistence', async () => {
        const persistentSetting = { ...settings, AMQP_PERSISTENT_MESSAGES: true };
        const amqp = new Amqp(persistentSetting);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            messageId
        };

        await amqp.sendData({
            headers: {
                'some-other-header': 'headerValue'
            },
            body: 'Message content'
        }, headers);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            settings.DATA_ROUTING_KEY,
            sinon.match(buf => {
                const payload = encryptor.decryptMessageContent(buf, 'base64');
                return sinon.match({
                    headers: {
                        'some-other-header': 'headerValue'
                    },
                    body: 'Message content'
                }).test(payload);
            }),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: true,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456',
                    protocolVersion: 1,
                    messageId
                }
            },
            sinon.match.func
        );
    });
    it('Should publish without persistence by default', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            messageId
        };

        await amqp.sendData({
            headers: {
                'some-other-header': 'headerValue'
            },
            body: 'Message content'
        }, headers);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            settings.DATA_ROUTING_KEY,
            sinon.match(buf => {
                const payload = encryptor.decryptMessageContent(buf, 'base64');
                return sinon.match({
                    headers: {
                        'some-other-header': 'headerValue'
                    },
                    body: 'Message content'
                }).test(payload);
            }),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: false,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456',
                    protocolVersion: 1,
                    messageId
                }
            },
            sinon.match.func
        );
    });

    it('Should send message to outgoing channel when process data for protocol version 1', async () => {
        const amqp = new Amqp(settings);
        delete amqp.settings.ELASTICIO_PROTOCOL_VERSION;
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            messageId
        };

        await amqp.sendData({
            headers: {
                'some-other-header': 'headerValue'
            },
            body: 'Message content'
        }, headers);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            settings.DATA_ROUTING_KEY,
            sinon.match(buf => {
                const payload = encryptor.decryptMessageContent(buf, 'base64');
                return sinon.match({
                    headers: {
                        'some-other-header': 'headerValue'
                    },
                    body: 'Message content'
                }).test(payload);
            }),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: false,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456',
                    protocolVersion: 1,
                    messageId
                }
            },
            sinon.match.func
        );
    });

    it('Should send message channel when process data after `drain` event', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub().callsFake((event, cb) => event === 'drain' && cb()),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return false;
            })
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            protocolVersion: 2,
            messageId
        };

        const result = await amqp.sendData({
            headers: {
                'some-other-header': 'headerValue',
                'protocolVersion': 2
            },
            body: 'Message content'
        }, headers);
        expect(result).to.deep.equal(true);

        expect(amqp.publishChannel.on).to.have.been.called.and.calledWith('drain', sinon.match.func);

        expect(amqp.publishChannel.publish).to.have.been.calledOnce
            .and.calledWith(
                settings.PUBLISH_MESSAGES_TO,
                settings.DATA_ROUTING_KEY,
                sinon.match(arg => {
                    const payload = encryptor.decryptMessageContent(arg, 'base64');
                    return sinon.match({
                        headers: {
                            'some-other-header': 'headerValue',
                            'protocolVersion': 2
                        },
                        body: 'Message content'
                    }).test(payload);
                }),
                {
                    contentType: 'application/json',
                    contentEncoding: 'utf8',
                    mandatory: true,
                    persistent: false,
                    headers: {
                        taskId: 'task1234567890',
                        stepId: 'step_456',
                        protocolVersion: 1,
                        messageId
                    }
                },
                sinon.match.func
            );
    });

    it('Should send message async to outgoing channel when process data', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };

        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            messageId
        };
        // One request every 500 ms
        const throttle = pThrottle(() => Promise.resolve(), 1, 500);
        const start = Date.now();

        for (let i = 0; i < 3; i++) {
            await amqp.sendData(
                {
                    headers: {
                        'some-other-header': 'headerValue'
                    },
                    body: 'Message content'
                },
                headers,
                throttle
            );
        }
        const duration = Math.round((Date.now() - start) / 1000);
        // Total duration should be around 1 seconds, because
        // first goes through
        // second throttled for 500ms
        // third throttled for another 500 ms
        expect(duration).to.equal(1);
        expect(amqp.publishChannel.publish).to.have.been.callCount(3);
        expect(amqp.publishChannel.publish).to.have.been.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            settings.DATA_ROUTING_KEY,
            sinon.match(arg => {
                const payload = encryptor.decryptMessageContent(arg, 'base64');
                return sinon.match({
                    headers: {
                        'some-other-header': 'headerValue'
                    },
                    body: 'Message content'
                }).test(payload);
            }),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: false,
                headers: { ...headers, protocolVersion: settings.PROTOCOL_VERSION }
            },
            sinon.match.func
        );
    });

    it('Should throw error when message size exceeds limit', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub()
        };
        const body = 'a'.repeat(settings.OUTGOING_MESSAGE_SIZE_LIMIT + 1);
        const headers = {};
        let caughtError;
        try {
            await amqp.sendData({ body }, headers);
        } catch (e) {
            caughtError = e;
        }
        expect(caughtError).to.be.instanceof(Error);
        expect(caughtError.message).to.equal('Outgoing message size 13981056 exceeds limit of 10485760.');
        expect(amqp.publishChannel.publish).not.to.have.been.called;
    });

    it('Should send message to outgoing channel after ${settings.AMQP_PUBLISH_RETRY_ATTEMPTS} attempts', async () => {
        const retryCount = settings.AMQP_PUBLISH_RETRY_ATTEMPTS;
        const amqp = new Amqp(settings);
        let iteration = 0;
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                iteration < retryCount - 1 ? cb('Some error') : cb(null, 'Success');
                iteration++;
                return true;
            })
        };
        sandbox.stub(amqp, '_sleep').resolves();
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            messageId
        };

        await amqp.sendData({
            headers: {
                'some-other-header': 'headerValue'
            },
            body: 'Message content'
        }, headers);
        expect(amqp.publishChannel.publish).to.have.been.callCount(retryCount);
        expect(amqp.publishChannel.publish).to.have.been.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            settings.DATA_ROUTING_KEY,
            sinon.match(arg => {
                const payload = encryptor.decryptMessageContent(arg, 'base64');
                return sinon.match({
                    headers: {
                        'some-other-header': 'headerValue'
                    },
                    body: 'Message content'
                }).test(payload);
            }),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: false,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456',
                    protocolVersion: settings.PROTOCOL_VERSION,
                    messageId,
                    retry: retryCount - 1
                }
            },
            sinon.match.func
        );
    });

    it('Should throw error after ${settings.AMQP_PUBLISH_RETRY_ATTEMPTS} attempts to publish message',
        async function test() {
            this.timeout(20000); // eslint-disable-line
            const retryCount = settings.AMQP_PUBLISH_RETRY_ATTEMPTS;
            const amqp = new Amqp(settings);
            amqp.publishChannel = {
                on: sandbox.stub(),
                publish: sandbox.stub()
                    .callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => cb('Some error'))
            };
            sandbox.spy(amqp, '_getDelay');
            sandbox.stub(amqp, '_sleep').resolves();
            const messageId = uuid.v4();
            const headers = {
                taskId: 'task1234567890',
                stepId: 'step_456',
                messageId
            };
            let caughtError;
            try {
                await amqp.sendData({
                    headers: {
                        'some-other-header': 'headerValue'
                    },
                    body: 'Message content'
                }, headers);
            } catch (e) {
                caughtError = e;
            }
            expect(caughtError).to.be.instanceof(Error);
            expect(amqp._getDelay).to.have.been.callCount(retryCount);
            expect(amqp._sleep).to.have.been.callCount(10);
            expect(amqp.publishChannel.publish).to.have.been.callCount(retryCount).and.calledWith(
                settings.PUBLISH_MESSAGES_TO,
                settings.DATA_ROUTING_KEY,
                sinon.match(arg => {
                    const payload = encryptor.decryptMessageContent(arg, 'base64');
                    return sinon.match({
                        headers: {
                            'some-other-header': 'headerValue'
                        },
                        body: 'Message content'
                    }).test(payload);
                }),
                {
                    contentType: 'application/json',
                    contentEncoding: 'utf8',
                    mandatory: true,
                    persistent: false,
                    headers: {
                        taskId: 'task1234567890',
                        stepId: 'step_456',
                        protocolVersion: settings.PROTOCOL_VERSION,
                        messageId,
                        retry: retryCount - 1
                    }
                },
                sinon.match.func
            );
        }
    );

    it('Should sendHttpReply to outgoing channel using routing key from headers when process data', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };

        const msg = {
            statusCode: 200,
            headers: {
                'content-type': 'text/plain'
            },
            body: 'OK'
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            reply_to: 'my-special-routing-key',
            messageId
        };
        await amqp.sendHttpReply(msg, headers);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            'my-special-routing-key',
            sinon.match(arg =>
                arg.toString('hex') === encryptor.encryptMessageContent(msg, 'base64').toString('hex')
            ),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: false,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456',
                    reply_to: 'my-special-routing-key',
                    protocolVersion: 1,
                    messageId
                }
            }
        );
    });

    it('Should throw error in sendHttpReply if reply_to header not found', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };

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
                persistent: false,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456'
                }
            });
        } catch (e) {
            caughtError = e;
        }
        expect(caughtError).to.be.instanceof(Error);
        expect(amqp.publishChannel.publish).not.to.have.been.called;
    });

    it('Should send message to outgoing channel using routing key from headers when process data', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };

        const msg = {
            headers: {
                'X-EIO-Routing-Key': 'my-special-routing-key'
            },
            body: {
                content: 'Message content'
            }
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            messageId
        };

        await amqp.sendData(msg, headers);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            'my-special-routing-key',
            sinon.match(arg => {
                const payload = encryptor.decryptMessageContent(arg, 'base64');
                return sinon.match({
                    headers: {},
                    body: {
                        content: 'Message content'
                    }
                }).test(payload);
            }),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: false,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456',
                    protocolVersion: settings.PROTOCOL_VERSION,
                    messageId
                }
            },
            sinon.match.func
        );
    });

    it('Should send message to errors when process error', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            protocolVersion: 1,
            messageId
        };

        await amqp.sendError(new Error('Test error'), headers, message);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            settings.ERROR_ROUTING_KEY,
            sinon.match(arg => {
                const payload = JSON.parse(arg.toString());
                payload.error = encryptor.decryptMessageContent(payload.error, 'base64');
                payload.errorInput = encryptor.decryptMessageContent(payload.errorInput, 'base64');
                return sinon.match({
                    error: {
                        name: 'Error',
                        message: 'Test error',
                        stack: sinon.match.string
                    },
                    errorInput: {
                        content: 'Message content'
                    }
                }).test(payload);
            }),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: false,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456',
                    protocolVersion: 1,
                    messageId
                }
            },
            sinon.match.func
        );
    });

    it('Should send message to errors using routing key from headers when process error', async () => {
        const expectedErrorPayload = {
            error: {
                name: 'Error',
                message: 'Test error',
                stack: sinon.match.string
            },
            errorInput: {
                content: 'Message content'
            }
        };

        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            reply_to: 'my-special-routing-key',
            protocolVersion: 1,
            messageId
        };

        await amqp.sendError(new Error('Test error'), headers, message);
        expect(amqp.publishChannel.publish).to.have.been.calledTwice
            .and.calledWith(
                settings.PUBLISH_MESSAGES_TO,
                '5559edd38968ec0736000003:step_1:1432205514864:error',
                sinon.match(arg => {
                    const payload = JSON.parse(arg.toString());
                    payload.error = encryptor.decryptMessageContent(payload.error, 'base64');
                    payload.errorInput = encryptor.decryptMessageContent(payload.errorInput, 'base64');

                    return sinon.match(expectedErrorPayload).test(payload);
                }),
                {
                    contentType: 'application/json',
                    contentEncoding: 'utf8',
                    mandatory: true,
                    persistent: false,
                    headers: {
                        messageId,
                        taskId: 'task1234567890',
                        stepId: 'step_456',
                        reply_to: 'my-special-routing-key',
                        protocolVersion: 1
                    }
                }
            )
            .and.calledWith(
                settings.PUBLISH_MESSAGES_TO,
                'my-special-routing-key',
                sinon.match(arg => {
                    const payload = encryptor.decryptMessageContent(arg.toString(), 'base64');
                    return sinon.match(expectedErrorPayload.error).test(payload);
                }),
                {
                    contentType: 'application/json',
                    contentEncoding: 'utf8',
                    mandatory: true,
                    persistent: false,
                    headers: {
                        messageId,
                        'taskId': 'task1234567890',
                        'stepId': 'step_456',
                        'reply_to': 'my-special-routing-key',
                        'x-eio-error-response': true,
                        'protocolVersion': 1
                    }
                }
            );
    });
    it('Should not send message to reply_to queue if NO_ERROR_REPLIES is set to true', async () => {
        settings.NO_ERROR_REPLIES = true;
        const expectedErrorPayload = {
            error: {
                name: 'Error',
                message: 'Test error',
                stack: sinon.match.string
            },
            errorInput: {
                content: 'Message content'
            }
        };

        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            reply_to: 'my-special-routing-key',
            protocolVersion: 1,
            messageId
        };

        await amqp.sendError(new Error('Test error'), headers, message);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce
            .and.calledWith(
                settings.PUBLISH_MESSAGES_TO,
                '5559edd38968ec0736000003:step_1:1432205514864:error',
                sinon.match(arg => {
                    const payload = JSON.parse(arg.toString());
                    payload.error = encryptor.decryptMessageContent(payload.error, 'base64');
                    payload.errorInput = encryptor.decryptMessageContent(payload.errorInput, 'base64');

                    return sinon.match(expectedErrorPayload).test(payload);
                }),
                {
                    contentType: 'application/json',
                    contentEncoding: 'utf8',
                    mandatory: true,
                    persistent: false,
                    headers: {
                        messageId,
                        taskId: 'task1234567890',
                        stepId: 'step_456',
                        reply_to: 'my-special-routing-key',
                        protocolVersion: 1
                    }
                }
            );
    });


    it('Should not provide errorInput if errorInput was empty', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            protocolVersion: 2,
            messageId
        };

        await amqp.sendError(new Error('Test error'), headers, {});
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            '5559edd38968ec0736000003:step_1:1432205514864:error',
            sinon.match(arg => {
                const payload = JSON.parse(arg.toString());
                payload.error = encryptor.decryptMessageContent(payload.error, 'base64');

                return sinon.match({
                    error: {
                        name: 'Error',
                        message: 'Test error',
                        stack: sinon.match.string
                    }
                    // no errorInput should be here
                }).test(payload);
            }),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: false,
                headers: {
                    taskId: 'task1234567890',
                    stepId: 'step_456',
                    protocolVersion: 2,
                    messageId
                }
            }
        );
    });

    it('Should not provide errorInput if errorInput was null', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };
        const messageId = uuid.v4();
        const headers = {
            taskId: 'task1234567890',
            stepId: 'step_456',
            protocolVersion: 2,
            messageId
        };

        await amqp.sendError(new Error('Test error'), headers, null);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            '5559edd38968ec0736000003:step_1:1432205514864:error',
            sinon.match(arg => {
                const payload = JSON.parse(arg.toString());
                payload.error = encryptor.decryptMessageContent(payload.error, 'base64');
                return sinon.match({
                    error: {
                        name: 'Error',
                        message: 'Test error',
                        stack: sinon.match.string
                    }
                    // no errorInput should be here
                }).test(payload);
            }),
            {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                persistent: false,
                headers: {
                    messageId,
                    taskId: 'task1234567890',
                    stepId: 'step_456',
                    protocolVersion: 2
                }
            },
            sinon.match.func
        );
    });

    it('Should send message to rebounds when rebound happened', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };

        const reboundError = new Error('Rebound error');
        await amqp.sendRebound(reboundError, message);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            settings.REBOUND_ROUTING_KEY,
            sinon.match(arg => {
                const payload = encryptor.decryptMessageContent(arg);
                expect(payload).to.deep.equal({ content: 'Message content' });
                return true;
            }),
            {
                ...message.properties,
                expiration: settings.REBOUND_INITIAL_EXPIRATION,
                headers: {
                    ...message.properties.headers,
                    end: sinon.match.number,
                    reboundReason: reboundError.message,
                    reboundIteration: 1
                }
            },
            sinon.match.func
        );
    });

    it('Should send message to rebounds with reboundIteration=3', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };

        const clonedMessage = _.cloneDeep(message);
        clonedMessage.properties.headers.reboundIteration = 2;

        const reboundError = new Error('Rebound error');
        await amqp.sendRebound(reboundError, clonedMessage);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            settings.REBOUND_ROUTING_KEY,
            sinon.match(arg => {
                const payload = encryptor.decryptMessageContent(arg);
                expect(payload).to.deep.equal({ content: 'Message content' });
                return true;
            }),
            {
                ...message.properties,
                expiration: 60000,
                headers: {
                    ...message.properties.headers,
                    end: sinon.match.number,
                    reboundReason: reboundError.message,
                    reboundIteration: 3
                }
            },
            sinon.match.func
        );
    });

    it('Should send message to errors when rebound limit exceeded', async () => {
        const amqp = new Amqp(settings);
        amqp.publishChannel = {
            on: sandbox.stub(),
            publish: sandbox.stub().callsFake((exchangeName, routingKey, payloadBuffer, options, cb) => {
                cb(null, 'Success');
                return true;
            })
        };
        const messageId = uuid.v4();

        const clonedMessage = _.cloneDeep(message);
        clonedMessage.properties.headers.reboundIteration = 100;
        delete clonedMessage.properties.headers.reply_to;
        clonedMessage.properties.headers.messageId = messageId;

        const reboundError = new Error('Rebound error');
        await amqp.sendRebound(reboundError, clonedMessage, clonedMessage.properties.headers);
        expect(amqp.publishChannel.publish).to.have.been.calledOnce.and.calledWith(
            settings.PUBLISH_MESSAGES_TO,
            settings.ERROR_ROUTING_KEY,
            sinon.match(arg => {
                const payload = JSON.parse(arg.toString());
                payload.error = encryptor.decryptMessageContent(payload.error, 'base64');
                payload.errorInput = encryptor.decryptMessageContent(payload.errorInput, 'base64');

                expect(payload.error.message).to.deep.equal('Rebound limit exceeded');
                expect(payload.errorInput).to.deep.equal({ content: 'Message content' });
                return true;
            }),
            {

                contentEncoding: 'utf8',
                contentType: 'application/json',
                mandatory: true,
                persistent: false,
                headers: {
                    execId: 'exec1234567890',
                    messageId,
                    protocolVersion: 2,
                    reboundIteration: 100,
                    taskId: 'task1234567890'
                }
            },
            sinon.match.func
        );
    });

    it('Should ack message when confirmed', () => {
        const amqp = new Amqp(settings);
        amqp.consumerChannel = {
            ack: sandbox.stub()
        };

        amqp.ack(message);

        expect(amqp.consumerChannel.ack).to.have.been.calledOnce.and.calledWith(message);
    });

    it('Should reject message when ack is called with false', () => {
        const amqp = new Amqp(settings);
        amqp.consumerChannel = {
            reject: sandbox.stub()
        };
        amqp.reject(message);

        expect(amqp.consumerChannel.reject).to.have.been.calledOnce.and.calledWith(message, false);
    });

    it('Should listen queue and pass decrypted message to client function with protocol version 1', async () => {
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
                persistent: false,
                clusterId: ''
            },
            content: encryptor.encryptMessageContent(
                { content: 'Message content' },
                'base64'
            )
        };

        let rejectedMessage;
        const amqp = new Amqp(settings);
        const consumerChannel = {
            consume: sandbox.stub().callsFake((queueName, callback) => {
                callback(message);
                return {
                    consumerTag: message.fields.consumerTag
                };
            }),
            reject: sandbox.stub().callsFake(message => {
                rejectedMessage = message;
            }),
            cancel: sandbox.stub(),
            removeAllListeners: sandbox.stub()
        };
        sandbox.stub(amqp, '_ensurePublishChannel').resolves();
        sandbox.stub(amqp, '_ensureConsumerChannel').resolves();
        amqp.consumerChannel = consumerChannel;
        const clientFunction = sandbox.stub();

        await amqp.connect();

        await Promise.all([
            amqp.listenQueue('testQueue', clientFunction),
            (async () => {
                await new Promise(resolve => setImmediate(resolve));
                await amqp.disconnect();
            })()
        ]);
        expect(rejectedMessage).to.be.undefined;
        expect(consumerChannel.cancel).to.have.been.calledOnce.and.calledWith(message.fields.consumerTag);
        expect(clientFunction).to.have.been.calledOnce.and.calledWith(
            {
                headers: {
                    reply_to: 'replyTo1234567890'
                },
                content: 'Message content'
            },
            message
        );
    });
    it('Should listen queue and pass decrypted message to client function with protocol version 2', async () => {
        let rejectedMessage;
        const amqp = new Amqp(settings);
        const consumerChannel = {
            consume: sandbox.stub().callsFake((queueName, callback) => {
                callback(message);
                return {
                    consumerTag: message.fields.consumerTag
                };
            }),
            prefetch: sandbox.stub(),
            reject: sandbox.stub().callsFake(message => {
                rejectedMessage = message;
            }),
            cancel: sandbox.stub(),
            removeAllListeners: sandbox.stub()
        };
        sandbox.stub(amqp, '_ensurePublishChannel').resolves();
        sandbox.stub(amqp, '_ensureConsumerChannel').resolves();
        amqp.consumerChannel = consumerChannel;
        const clientFunction = sandbox.stub();

        await amqp.connect();

        amqp.listenQueue('testQueue', clientFunction);
        await new Promise(resolve => setImmediate(resolve));
        amqp.stopConsume();
        expect(rejectedMessage).to.be.undefined;
        expect(consumerChannel.cancel).to.have.been.calledOnce.and.calledWith(message.fields.consumerTag);
        expect(clientFunction).to.have.been.calledOnce.and.calledWith(
            {
                headers: {
                    reply_to: 'replyTo1234567890'
                },
                content: 'Message content'
            },
            message
        );
    });

    describe('_decodeDefaultMessage', () => {
        let amqp;
        beforeEach(() => {
            settings = Settings.readFrom(envVars);
            amqp = new Amqp(settings);
        });
        it('should decode message with missing protocol version as base64-encoded', () => {
            const messageBody = {
                headers: {
                    'x-does-not-matter': 'value'
                },
                body: {
                    key: 'value'
                }
            };
            const message = {
                properties: {
                    headers: {
                        flowId: 'XXX',
                        stepId: 'step_1'
                    }
                },
                fields: {
                    deliveryTag: 'XXXXX'
                },
                content: encryptor.encryptMessageContent(messageBody, 'base64')
            };
            expect(amqp._decodeDefaultMessage(message)).to.deep.equal(messageBody);
        });
        it('should decode message with configured procotol version 2 as raw buffer', () => {
            const messageBody = {
                headers: {
                    'x-does-not-matter': 'value'
                },
                body: {
                    key: 'value'
                }
            };
            const message = {
                properties: {
                    headers: {
                        flowId: 'XXX',
                        stepId: 'step_1',
                        protocolVersion: 2
                    }
                },
                fields: {
                    deliveryTag: 'XXXXX'
                },
                content: encryptor.encryptMessageContent(messageBody)
            };
            expect(amqp._decodeDefaultMessage(message)).to.deep.equal(messageBody);
        });
    });
    describe('_decodeErrorMessage', () => {
        let amqp;
        beforeEach(() => {
            settings = Settings.readFrom(envVars);
            amqp = new Amqp(settings);
        });
        it('should decode message without protol version as base64', () => {
            const error = new Error('smth bad happens');
            const originalMessage = {
                body: {
                    does: 'not matter'
                },
                headers: {
                    'x-ipaas-some-header': 'and it\'s value'
                }
            };
            const message = {
                error: encryptor.encryptMessageContent(
                    _.pick(error, ['name', 'message', 'stack']),
                    'base64'
                ).toString(),
                errorInput: encryptor.encryptMessageContent(
                    originalMessage,
                    'base64'
                ).toString()
            };

            const amqpMessage = {
                properties: {
                    headers: {}
                },
                content: Buffer.from(JSON.stringify(message))
            };
            expect(amqp._decodeErrorMessage(amqpMessage)).to.deep.equal({
                headers: {},
                body: {
                    error: _.pick(error, ['name', 'message', 'stack']),
                    errorInput: originalMessage
                }
            });
        });
        it('should decode message with protocol version =2 as base64', () => {
            const error = new Error('smth bad happens');
            const originalMessage = {
                body: {
                    does: 'not matter'
                },
                headers: {
                    'x-ipaas-some-header': 'and it\'s value'
                }
            };
            const message = {
                error: encryptor.encryptMessageContent(
                    _.pick(error, ['name', 'message', 'stack']),
                    'base64'
                ).toString(),
                errorInput: encryptor.encryptMessageContent(
                    originalMessage,
                    'base64'
                ).toString()
            };

            const amqpMessage = {
                properties: {
                    headers: {
                        protocolVersion: 2
                    }
                },
                content: Buffer.from(JSON.stringify(message))
            };
            expect(amqp._decodeErrorMessage(amqpMessage)).to.deep.equal({
                headers: {
                    protocolVersion: 2
                },
                body: {
                    error: _.pick(error, ['name', 'message', 'stack']),
                    errorInput: originalMessage
                }
            });
        });
        it('should not fail if errorInput missing', () => {
            const error = new Error('smth bad happens');
            const message = {
                error: encryptor.encryptMessageContent(
                    _.pick(error, ['name', 'message', 'stack']),
                    'base64'
                ).toString()
            };

            const amqpMessage = {
                properties: {
                    headers: {
                        protocolVersion: 2
                    }
                },
                content: Buffer.from(JSON.stringify(message))
            };
            expect(amqp._decodeErrorMessage(amqpMessage)).to.deep.equal({
                headers: {
                    protocolVersion: 2
                },
                body: {
                    error: _.pick(error, ['name', 'message', 'stack'])
                }
            });
        });
    });

    describe('_decodeMessage', () => {
        describe('INPUT_FORMAT === error', () => {
            let amqp;
            beforeEach(() => {
                envVars.ELASTICIO_INPUT_FORMAT = 'error';
                settings = Settings.readFrom(envVars);
                amqp = new Amqp(settings);
            });
            it('should process message as error message', () => {
                const error = new Error('smth bad happens');
                const originalMessage = {
                    body: {
                        does: 'not matter'
                    },
                    headers: {
                        'x-ipaas-some-header': 'and it\'s value'
                    }
                };
                const message = {
                    error: encryptor.encryptMessageContent(
                        _.pick(error, ['name', 'message', 'stack']),
                        'base64'
                    ).toString(),
                    errorInput: encryptor.encryptMessageContent(
                        originalMessage,
                        'base64'
                    ).toString()
                };

                const amqpMessage = {
                    properties: {
                        headers: {
                            protocolVersion: 2
                        }
                    },
                    content: Buffer.from(JSON.stringify(message))
                };
                expect(amqp._decodeMessage(amqpMessage)).to.deep.equal({
                    headers: {
                        protocolVersion: 2
                    },
                    body: {
                        error: _.pick(error, ['name', 'message', 'stack']),
                        errorInput: originalMessage
                    }
                });
            });
            it('should fail if message is not in error format', () => {
                const message = {
                    body: {
                        does: 'not matter'
                    },
                    headers: {
                        'x-ipaas-some-header': 'and it\'s value'
                    }
                };

                const amqpMessage = {
                    properties: {
                        headers: {
                            protocolVersion: 2
                        }
                    },
                    content: encryptor.encryptMessageContent(message)
                };
                expect(() => amqp._decodeMessage(amqpMessage)).to.throw();
            });
            it('should add reply_to header', () => {
                const error = new Error('smth bad happens');
                const originalMessage = {
                    body: {
                        does: 'not matter'
                    },
                    headers: {
                        'x-ipaas-some-header': 'and it\'s value'
                    }
                };
                const message = {
                    error: encryptor.encryptMessageContent(
                        _.pick(error, ['name', 'message', 'stack']),
                        'base64'
                    ).toString(),
                    errorInput: encryptor.encryptMessageContent(
                        originalMessage,
                        'base64'
                    ).toString()
                };

                const amqpMessage = {
                    properties: {
                        headers: {
                            protocolVersion: 2,
                            reply_to: 'reply_to_queue_name',
                            flowId: 'flow-id'
                        }
                    },
                    content: Buffer.from(JSON.stringify(message))
                };
                expect(amqp._decodeMessage(amqpMessage)).to.deep.equal({
                    headers: {
                        reply_to: amqpMessage.properties.headers.reply_to,
                        protocolVersion: 2,
                        flowId: 'flow-id'
                    },
                    body: {
                        error: _.pick(error, ['name', 'message', 'stack']),
                        errorInput: originalMessage
                    }
                });
            });
        });
        describe('INPUT_FORMAT is default or missing', () => {
            let amqp;
            beforeEach(() => {
                envVars.ELASTICIO_INPUT_FORMAT = 'default';
                settings = Settings.readFrom(envVars);
                amqp = new Amqp(settings);
            });

            it('should process message as normal message', () => {
                const message = {
                    body: {
                        does: 'not matter'
                    },
                    headers: {
                        'x-ipaas-some-header': 'and it\'s value'
                    }
                };

                const amqpMessage = {
                    properties: {
                        headers: {
                            protocolVersion: 2
                        }
                    },
                    content: encryptor.encryptMessageContent(message)
                };
                expect(amqp._decodeMessage(amqpMessage)).to.deep.equal(message);
            });
            it('should fail if message is not in normal message format', () => {
                const error = new Error('smth bad happens');
                const originalMessage = {
                    body: {
                        does: 'not matter'
                    },
                    headers: {
                        'x-ipaas-some-header': 'and it\'s value'
                    }
                };
                const message = {
                    error: encryptor.encryptMessageContent(
                        _.pick(error, ['name', 'message', 'stack']),
                        'base64'
                    ).toString(),
                    errorInput: encryptor.encryptMessageContent(
                        originalMessage,
                        'base64'
                    ).toString()
                };

                const amqpMessage = {
                    properties: {
                        headers: {
                            protocolVersion: 2
                        }
                    },
                    content: Buffer.from(JSON.stringify(message))
                };
                expect(() => amqp._decodeMessage(amqpMessage)).to.throw();
            });
            it('should add reply_to header', () => {
                const message = {
                    body: {
                        does: 'not matter'
                    },
                    headers: {
                        'x-ipaas-some-header': 'and it\'s value'
                    }
                };

                const amqpMessage = {
                    properties: {
                        headers: {
                            protocolVersion: 2,
                            reply_to: 'reply_to_queue'
                        }
                    },
                    content: encryptor.encryptMessageContent(message)
                };
                expect(amqp._decodeMessage(amqpMessage)).to.deep.equal({
                    headers: { ...message.headers, reply_to: amqpMessage.properties.headers.reply_to },
                    body: message.body
                });
            });
        });
    });

    it('Should disconnect from all channels and connection', async () => {
        const amqp = new Amqp(settings);
        amqp.consumerChannel = {
            close: sandbox.stub(),
            removeAllListeners: sandbox.stub()
        };
        amqp.publishChannel = {
            close: sandbox.stub(),
            removeAllListeners: sandbox.stub()
        };
        amqp._readConnection = {
            close: sandbox.stub(),
            removeAllListeners: sandbox.stub()
        };
        amqp._writeConnection = {
            close: sandbox.stub(),
            removeAllListeners: sandbox.stub()
        };

        await amqp.disconnect();
        expect(amqp.consumerChannel.close).to.have.been.calledOnce;
        expect(amqp.publishChannel.close).to.have.been.calledOnce;
        expect(amqp.consumerChannel.removeAllListeners).to.have.been.calledOnce.and.calledWith('close');
        expect(amqp.publishChannel.removeAllListeners).to.have.been.calledOnce.and.calledWith('close');
        expect(amqp._readConnection.close).to.have.been.calledOnce;
        expect(amqp._readConnection.removeAllListeners).to.have.been.calledOnce.and.calledWith('close');
        expect(amqp._writeConnection.close).to.have.been.calledOnce;
        expect(amqp._writeConnection.removeAllListeners).to.have.been.calledOnce.and.calledWith('close');
    });
    describe('_getDelay', () => {
        let amqp;
        beforeEach(() => {
            amqp = new Amqp(settings);
        });
        it('should return defaultDelay * 2^^iteration as delay', () => {
            expect(amqp._getDelay(100, 300 * 1000, 0)).to.equal(100);
            expect(amqp._getDelay(100, 300 * 1000, 1)).to.equal(200);
            expect(amqp._getDelay(100, 300 * 1000, 2)).to.equal(400);
            expect(amqp._getDelay(100, 300 * 1000, 4)).to.equal(1600);
        });
        it('should return default delay for first iteration', () => {
            expect(amqp._getDelay(100, 300 * 1000, 0)).to.equal(100);
        });
        it('should reutrn maxDelay if calculated delay is greater then maxDelay', () => {
            expect(amqp._getDelay(100, 300 * 1000, 12)).to.equal(300 * 1000);
            expect(amqp._getDelay(100, 300 * 1000, 15)).to.equal(300 * 1000);
        });
        it('should reutrn maxDelay if calculated delay is infinity then maxDelay', () => {
            expect(amqp._getDelay(100, 300 * 1000, 1e6)).to.equal(300 * 1000);
        });
    });
});
