const chai = require('chai');
const sinon = require('sinon');
const { Readable } = require('stream');
const { expect } = chai;
chai.use(require('sinon-chai'));

const uuid = require('uuid');
const _ = require('lodash');

const { Sailor } = require('../../lib/sailor');
const Settings = require('../../lib/settings');
const amqp = require('../../lib/amqp.js');
const Encryptor = require('../../lib/encryptor.js');

describe('Sailor', () => {
    let settings;
    let sandbox;
    let envVars;
    let encryptor;
    beforeEach(() => {
        sandbox = sinon.createSandbox();
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

        envVars.ELASTICIO_COMPONENT_PATH = '/spec/component';
        envVars.ELASTICIO_DEBUG = 'sailor';

        envVars.ELASTICIO_API_URI = 'http://apihost.com';
        envVars.ELASTICIO_API_USERNAME = 'test@test.com';
        envVars.ELASTICIO_API_KEY = '5559edd';

        envVars.ELASTICIO_MESSAGE_CRYPTO_PASSWORD = 'testCryptoPassword';
        envVars.ELASTICIO_MESSAGE_CRYPTO_IV = 'iv=any16_symbols';

        envVars.ELASTICIO_OBJECT_STORAGE_URI = 'http://maester.service:3002';
        envVars.ELASTICIO_OBJECT_STORAGE_TOKEN = 'this is jwt token, believe me!';

        settings = Settings.readFrom(envVars);
        encryptor = new Encryptor(settings.MESSAGE_CRYPTO_PASSWORD, settings.MESSAGE_CRYPTO_IV);
    });
    afterEach(() => {
        sandbox.restore();
    });
    describe('readIncomingMessageHeaders', () => {
        let sailor;
        beforeEach(() => {
            sailor = new Sailor(settings);
        });
        it('should copy stepId header', () => {
            const stepId = 'step_1';
            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers: {
                        stepId
                    }
                }
            });

            expect(result).to.include({ stepId });
        });

        it('should copy messageId header', () => {
            const messageId = 'message_1234';
            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers: {
                        messageId
                    }
                }
            });

            expect(result).to.include({ messageId });
        });

        it('should copy parentMessageId', () => {
            const parentMessageId = 'parent_message_1234';

            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers: {
                        parentMessageId
                    }
                }
            });

            expect(result).to.include({ parentMessageId });
        });

        it('should reply_to', () => {
            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers: {
                        reply_to: 'my_reply_to_exchange'
                    }
                }
            });

            expect(result).to.include({
                reply_to: 'my_reply_to_exchange'
            });
        });

        it('it should copy and normalize names for x-eio headers', () => {
            const headers = {
                'x-eio-meta-lowercase': 'I am lowercase',
                'X-eio-meta-miXeDcAse': 'Eventually to become lowercase'
            };

            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers
                }
            });

            expect(result).to.include({
                'x-eio-meta-lowercase': 'I am lowercase',
                'x-eio-meta-mixedcase': 'Eventually to become lowercase'
            });
        });

        it('should copy threadId header', () => {
            const threadId = 'threadId';
            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers: {
                        threadId
                    }
                }
            });

            expect(result).to.include({
                threadId
            });
        });
        it('should fallback to x-eio-meta-trace-id', () => {
            const threadId = 'threadId';
            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers: {
                        'x-eio-meta-trace-id': threadId
                    }
                }
            });

            expect(result).to.include({
                threadId
            });
        });
    });
    describe('processMessage', () => {
        let fakeAMQPConnection;
        let message;
        let payload;

        beforeEach(() => {
            fakeAMQPConnection = {
                connect: sandbox.stub(),
                sendData: sandbox.stub(),
                sendError: sandbox.stub(),
                sendRebound: sandbox.stub(),
                ack: sandbox.stub(),
                reject: sandbox.stub(),
                sendSnapshot: sandbox.stub(),
                sendHttpReply: sandbox.stub()
            };
            sandbox.stub(amqp, 'Amqp').returns(fakeAMQPConnection);

            payload = { param1: 'Value1' };
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
                        taskId: '5559edd38968ec0736000003',
                        execId: 'some-exec-id',
                        userId: '5559edd38968ec0736000002',
                        workspaceId: '5559edd38968ec073600683',
                        threadId: uuid.v4(),
                        messageId: uuid.v4(),
                        parentMessageId: uuid.v4()
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
                content: Buffer.from(encryptor.encryptMessageContent(payload))
            };
        });

        it('should call sendData() and ack() if success', async () => {
            settings.FUNCTION = 'data_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');

                return Promise.resolve({});
            });

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
            expect(fakeAMQPConnection.sendData).to.have.been.calledOnce.and.calledWith(
                { headers: {}, body: { items: [1, 2, 3, 4, 5, 6] } },
                sinon.match({
                    compId: '5559edd38968ec0736000456',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    end: sinon.match.number,
                    execId: 'some-exec-id',
                    function: 'data_trigger',
                    messageId: sinon.match.string,
                    parentMessageId: message.properties.headers.messageId,
                    start: sinon.match.number,
                    stepId: 'step_1',
                    taskId: '5559edd38968ec0736000003',
                    threadId: message.properties.headers.threadId,
                    userId: '5559edd38968ec0736000002',
                    workspaceId: '5559edd38968ec073600683'
                })
            );

            expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should call sendData() with extended headers', async () => {

            const customVars = {
                ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS: 'ELASTICIO_FIRST, ELASTICIO_SECOND_ELASTICIO_ENV,'
                    + 'ELASTICIO_NOT_PRESENT',
                ELASTICIO_RANDOM: 'random',
                ELASTICIO_FIRST: 'first',
                ELASTICIO_SECOND_ELASTICIO_ENV: 'second',
                ELASTICIO_THIRD: 'third'
            };

            settings = Settings.readFrom(Object.assign({}, envVars, customVars));
            settings.FUNCTION = 'data_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
            expect(fakeAMQPConnection.sendData).to.have.been.calledOnce.and.calledWith(
                { headers: {}, body: { items: [1, 2, 3, 4, 5, 6] } },
                sinon.match({
                    first: 'first',
                    secondElasticioEnv: 'second',
                    notPresent: undefined,
                    execId: 'some-exec-id',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    workspaceId: '5559edd38968ec073600683',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'data_trigger',
                    start: sinon.match.number,
                    end: sinon.match.number,
                    messageId: sinon.match.string
                })
            );
        });

        it('should call sendData() and ack() only once', async () => {
            settings.FUNCTION = 'end_after_data_twice';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
            expect(fakeAMQPConnection.sendData).to.have.been.calledOnce;
            expect(fakeAMQPConnection.reject).not.to.have.been.called;
            expect(fakeAMQPConnection.ack).to.have.been.calledOnce;
        });

        it('should augment emitted message with passthrough data', async () => {
            settings.FUNCTION = 'passthrough';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({ is_passthrough: true });
            });

            const psPayload = {
                body: payload,
                passthrough: {
                    step_0: {
                        body: { key: 'value' }
                    }
                }
            };

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(psPayload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
            expect(fakeAMQPConnection.sendData).to.have.been.calledOnce.and.calledWith(
                {
                    headers: {},
                    body: {
                        param1: 'Value1'
                    },
                    passthrough: {
                        step_0: {
                            body: {
                                key: 'value'
                            }
                        },
                        step_1: {
                            headers: {},
                            body: { param1: 'Value1' }
                        }
                    }
                },
                sinon.match({
                    execId: 'some-exec-id',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    workspaceId: '5559edd38968ec073600683',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'passthrough',
                    start: sinon.match.number,
                    end: sinon.match.number,
                    messageId: sinon.match.string
                })
            );

            expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it(
            'should augment emitted message with passthrough with data from incoming message '
            + 'if NO_SELF_PASSTRHOUGH set', async () => {
                message.properties.headers.stepId = 'step_0';
                settings.FUNCTION = 'passthrough';
                settings.NO_SELF_PASSTRHOUGH = true;
                const sailor = new Sailor(settings);

                sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                    expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                    expect(stepId).to.deep.equal('step_1');
                    return Promise.resolve({ is_passthrough: true });
                });

                const psPayload = {
                    body: payload,
                    passthrough: {
                        step_oth: {
                            body: { key: 'value' }
                        }
                    }
                };

                await sailor.connect();
                await sailor.prepare();
                await sailor.processMessage(psPayload, message);
                expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
                expect(fakeAMQPConnection.sendData).to.have.been.calledOnce.and.calledWith(
                    {
                        headers: {},
                        body: {
                            param1: 'Value1'
                        },
                        passthrough: {
                            step_oth: {
                                body: {
                                    key: 'value'
                                }
                            },
                            step_0: {
                                body: { param1: 'Value1' }
                            }
                        }
                    },
                    sinon.match({
                        execId: 'some-exec-id',
                        taskId: '5559edd38968ec0736000003',
                        userId: '5559edd38968ec0736000002',
                        containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                        workspaceId: '5559edd38968ec073600683',
                        stepId: 'step_1',
                        compId: '5559edd38968ec0736000456',
                        function: 'passthrough',
                        start: sinon.match.number,
                        end: sinon.match.number,
                        messageId: sinon.match.string
                    })
                );

                expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
            }
        );

        it(
            'should not augment emitted message with passthrough with data from incoming message '
            + 'if NO_SELF_PASSTRHOUGH set without stepId header',
            async () => {
                settings.FUNCTION = 'passthrough';
                settings.NO_SELF_PASSTRHOUGH = true;
                const sailor = new Sailor(settings);

                sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                    expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                    expect(stepId).to.deep.equal('step_1');
                    return Promise.resolve({ is_passthrough: true });
                });

                const psPayload = {
                    body: payload,
                    passthrough: {
                        step_oth: {
                            body: { key: 'value' }
                        }
                    }
                };

                await sailor.connect();
                await sailor.prepare();
                await sailor.processMessage(psPayload, message);
                expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
                expect(fakeAMQPConnection.sendData).to.have.been.calledOnce.and.calledWith(
                    {
                        headers: {},
                        body: {
                            param1: 'Value1'
                        },
                        passthrough: {
                            step_oth: {
                                body: {
                                    key: 'value'
                                }
                            }
                        }
                    },
                    sinon.match({
                        execId: 'some-exec-id',
                        taskId: '5559edd38968ec0736000003',
                        userId: '5559edd38968ec0736000002',
                        containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                        workspaceId: '5559edd38968ec073600683',
                        stepId: 'step_1',
                        compId: '5559edd38968ec0736000456',
                        function: 'passthrough',
                        start: sinon.match.number,
                        end: sinon.match.number,
                        messageId: sinon.match.string
                    })
                );

                expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
            }
        );

        it('should provide access to flow vairables', async () => {
            settings.FUNCTION = 'use_flow_variables';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({
                    is_passthrough: true,
                    variables: {
                        var1: 'val1',
                        var2: 'val2'
                    }
                });
            });

            const psPayload = {
                body: payload
            };

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(psPayload, message);
            expect(fakeAMQPConnection.sendData).to.have.been.calledOnce.and.calledWith(sinon.match({
                body: {
                    var1: 'val1',
                    var2: 'val2'
                }
            }));
        });

        it('should send request to API server to update keys', async () => {
            settings.FUNCTION = 'keys_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({
                    config: {
                        _account: '1234567890'
                    }
                });
            });

            sandbox.stub(sailor.apiClient.accounts, 'update').callsFake((accountId, keys) => {
                expect(accountId).to.deep.equal('1234567890');
                expect(keys).to.deep.equal({ keys: { oauth: { access_token: 'newAccessToken' } } });
                return Promise.resolve();
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(sailor.apiClient.accounts.update).to.have.been.calledOnce;
            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
            expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should emit error if failed to update keys', async () => {
            settings.FUNCTION = 'keys_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({
                    config: {
                        _account: '1234567890'
                    }
                });
            });

            sandbox.stub(sailor.apiClient.accounts, 'update').callsFake((accountId, keys) => {
                expect(accountId).to.deep.equal('1234567890');
                expect(keys).to.deep.equal({ keys: { oauth: { access_token: 'newAccessToken' } } });
                return Promise.reject(new Error('Update keys error'));
            });
            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);
            // It will not throw an error because component
            // process method is not `async`
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(sailor.apiClient.accounts.update).to.have.been.calledOnce;

            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
            expect(fakeAMQPConnection.sendError).to.have.been.calledOnce.and.calledWith(sinon.match({
                message: 'Update keys error'
            }));
            expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should call sendRebound() and ack()', async () => {
            settings.FUNCTION = 'rebound_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(fakeAMQPConnection.sendRebound).to.have.been.calledOnce.and.calledWith(sinon.match({
                message: 'Rebound reason'
            }));
            expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should call sendSnapshot() and ack() after a `snapshot` event', async () => {
            settings.FUNCTION = 'update';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            const payload = {
                snapshot: { blabla: 'blablabla' }
            };
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            const expectedSnapshot = { blabla: 'blablabla' };
            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;

            expect(fakeAMQPConnection.sendSnapshot).to.have.been.calledOnce.and.calledWith(
                expectedSnapshot,
                sinon.match({
                    taskId: '5559edd38968ec0736000003',
                    execId: 'some-exec-id',
                    userId: '5559edd38968ec0736000002',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    workspaceId: '5559edd38968ec073600683',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'update',
                    start: sinon.match.number,
                    snapshotEvent: 'snapshot',
                    messageId: sinon.match.string
                })
            );
            expect(sailor.snapshot).to.deep.equal(expectedSnapshot);
            expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should call sendSnapshot() and ack() after an `updateSnapshot` event', async () => {
            settings.FUNCTION = 'update';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({
                    snapshot: {
                        someId: 'someData'
                    }
                });
            });

            await sailor.prepare();
            await sailor.connect();
            const payload = {
                updateSnapshot: { updated: 'value' }
            };
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            const expectedSnapshot = { someId: 'someData', updated: 'value' };
            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;

            expect(fakeAMQPConnection.sendSnapshot).to.have.been.calledOnce.and.calledWith(
                { updated: 'value' },
                sinon.match({
                    taskId: '5559edd38968ec0736000003',
                    execId: 'some-exec-id',
                    userId: '5559edd38968ec0736000002',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    workspaceId: '5559edd38968ec073600683',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'update',
                    start: sinon.match.number,
                    snapshotEvent: 'updateSnapshot',
                    messageId: sinon.match.string
                })
            );

            expect(sailor.snapshot).to.deep.equal(expectedSnapshot);
            expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should send error if error happened', async () => {
            settings.FUNCTION = 'error_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;

            expect(fakeAMQPConnection.sendError).to.have.been.calledOnce.and.calledWith(
                sinon.match({
                    message: 'Some component error',
                    stack: sinon.match.string
                }),
                sinon.match.object,
                message
            );

            expect(fakeAMQPConnection.reject).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should send error and reject only once()', async () => {
            settings.FUNCTION = 'end_after_error_twice';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;

            expect(fakeAMQPConnection.sendError).to.have.been.calledOnce;

            expect(fakeAMQPConnection.ack).not.to.have.been.called;
            expect(fakeAMQPConnection.reject).to.have.been.calledOnce;
        });

        it('should reject message if trigger is missing', async () => {
            settings.FUNCTION = 'missing_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;

            expect(fakeAMQPConnection.sendError).to.have.been.calledOnce.and.calledWith(
                sinon.match({
                    /* eslint-disable max-len */
                    message: sinon.match(/Failed to load file '.\/triggers\/missing_trigger.js': Cannot find module.+missing_trigger\.js/),
                    /* eslint-enable max-len */

                    stack: sinon.match.truthy
                }),
                sinon.match.object,
                message
            );

            expect(fakeAMQPConnection.reject).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should not process message if taskId in header is not equal to task._id', async () => {
            const message2 = _.cloneDeep(message);
            message2.properties.headers.taskId = 'othertaskid';

            settings.FUNCTION = 'error_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message2);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(fakeAMQPConnection.reject).to.have.been.calledOnce;
        });

        it('should catch all data calls and all error calls', async () => {
            settings.FUNCTION = 'datas_and_errors';

            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;

            // data
            expect(fakeAMQPConnection.sendData).to.have.been.callCount(3);

            // error
            expect(fakeAMQPConnection.sendError).to.have.been.callCount(2);

            // ack
            expect(fakeAMQPConnection.reject).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should handle errors in httpReply properly', async () => {
            settings.FUNCTION = 'http_reply';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').resolves({});

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep)
                .to.have.been.calledWith('5559edd38968ec0736000003', 'step_1');

            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
            expect(fakeAMQPConnection.sendHttpReply).to.have.been.calledOnce.and.calledWith(
                {
                    statusCode: 200,
                    body: 'Ok',
                    headers: {
                        'content-type': 'text/plain'
                    }
                },
                sinon.match({
                    execId: 'some-exec-id',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    workspaceId: '5559edd38968ec073600683',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'http_reply',
                    start: sinon.match.number,
                    messageId: sinon.match.string,
                    parentMessageId: message.properties.headers.messageId,
                    threadId: message.properties.headers.threadId
                })
            );

            expect(fakeAMQPConnection.sendData).to.have.been.calledOnce.and.calledWith(
                {
                    headers: {},
                    body: {}
                },
                sinon.match({
                    execId: 'some-exec-id',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    workspaceId: '5559edd38968ec073600683',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'http_reply',
                    start: sinon.match.number,
                    end: sinon.match.number,
                    messageId: sinon.match.string,
                    parentMessageId: message.properties.headers.messageId,
                    threadId: message.properties.headers.threadId
                })
            );
            expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should handle errors in httpReply properly', async () => {
            settings.FUNCTION = 'http_reply';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').resolves({});

            fakeAMQPConnection.sendHttpReply.callsFake(() => {
                throw new Error('Failed to send HTTP reply');
            });

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor.apiClient.tasks.retrieveStep)
                .to.have.been.calledWith('5559edd38968ec0736000003', 'step_1');

            expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
            expect(fakeAMQPConnection.sendHttpReply).to.have.been.calledOnce.and.calledWith(
                {
                    statusCode: 200,
                    body: 'Ok',
                    headers: {
                        'content-type': 'text/plain'
                    }
                },
                sinon.match({
                    execId: 'some-exec-id',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    workspaceId: '5559edd38968ec073600683',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'http_reply',
                    start: sinon.match.number,
                    messageId: sinon.match.string,
                    parentMessageId: message.properties.headers.messageId,
                    threadId: message.properties.headers.threadId
                })
            );

            expect(fakeAMQPConnection.sendData).not.to.have.been.called;
            expect(fakeAMQPConnection.ack).not.to.have.been.called;

            // error
            expect(fakeAMQPConnection.sendError).to.have.been.calledOnce.and.calledWith(sinon.match({
                message: 'Failed to send HTTP reply',
                stack: sinon.match.truthy
            }));

            // ack
            expect(fakeAMQPConnection.reject).to.have.been.calledOnce.and.calledWith(message);
        });

        describe('for incoming lightweight message', () => {
            let message;
            let payload;
            let bodyObjectId;
            let passthroughObjectId;
            let body;
            let passThroughBody;

            beforeEach(() => {
                bodyObjectId = 'body-object-id';
                passthroughObjectId = 'passthrough-object-id';
                body = {
                    some: 'body'
                };
                passThroughBody = {
                    passThrough: 'body'
                };
                payload = {
                    headers: {
                        [Sailor.OBJECT_ID_HEADER]: bodyObjectId
                    },
                    body: {},
                    passthrough: {
                        step_2: {
                            body: {
                                step_1: 'body'
                            }
                        },
                        step_3: {
                            headers: {},
                            body: {
                                step_2: 'body'
                            }
                        },
                        step_4: {
                            headers: {
                                [Sailor.OBJECT_ID_HEADER]: passthroughObjectId
                            },
                            body: {}
                        }
                    }
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
                            taskId: '5559edd38968ec0736000003',
                            execId: 'some-exec-id',
                            userId: '5559edd38968ec0736000002',
                            workspaceId: '5559edd38968ec073600683',
                            threadId: uuid.v4(),
                            messageId: uuid.v4(),
                            parentMessageId: uuid.v4()
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
                    content: Buffer.from(encryptor.encryptMessageContent(payload))
                };
            });

            describe('when autoResolveObjectReference enabled', () => {
                let sailor;
                beforeEach(async () => {
                    settings.FUNCTION = 'data_trigger';
                    sailor = new Sailor(settings);

                    sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                        expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                        expect(stepId).to.deep.equal('step_1');

                        return Promise.resolve({
                            is_passthrough: true
                        });
                    });

                    await sailor.connect();
                    await sailor.prepare();
                });

                describe('and all objects can be downloaded successfully', () => {
                    let bodyRequestStub;
                    let passthroughRequestStub;
                    let runExecSpy;
                    beforeEach(async () => {
                        const getObjectStub = sandbox.stub(sailor.objectStorage, 'getAsJSON');
                        bodyRequestStub = getObjectStub
                            .withArgs(bodyObjectId, settings.OBJECT_STORAGE_TOKEN)
                            .resolves(body);
                        passthroughRequestStub = bodyRequestStub
                            .withArgs(passthroughObjectId)
                            .resolves(passThroughBody);

                        runExecSpy = sandbox.spy(sailor, 'runExec');
                    });

                    it('should fetch message bodies and process', async () => {
                        await sailor.processMessage(payload, message);
                        // await new Promise(resolve => setTimeout(resolve, 50));
                        expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                        expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
                        sinon.assert.calledOnce(bodyRequestStub);
                        sinon.assert.calledOnce(passthroughRequestStub);
                        sinon.assert.calledOnce(runExecSpy);
                        sinon.assert.calledWith(
                            runExecSpy,
                            sinon.match.object,
                            sinon.match
                                .hasNested('body', body)
                                .and(sinon.match.hasNested('passthrough.step_4.body', passThroughBody)),
                            message,
                            sinon.match.object,
                            sinon.match.object,
                            sinon.match.number,
                            sinon.match.object
                        );
                        expect(fakeAMQPConnection.sendData).to.have.been.calledOnce.and.calledWith(
                            {
                                headers: {},
                                body: { items: [1, 2, 3, 4, 5, 6] },
                                passthrough: {
                                    step_1: {
                                        headers: {},
                                        body: { items: [1, 2, 3, 4, 5, 6] }
                                    },
                                    step_2: {
                                        body: { step_1: 'body' }
                                    },
                                    step_3: {
                                        body: { step_2: 'body' },
                                        headers: {}
                                    },
                                    step_4: {
                                        headers: {
                                            [Sailor.OBJECT_ID_HEADER]: passthroughObjectId
                                        },
                                        body: passThroughBody
                                    }
                                }
                            },
                            sinon.match({
                                compId: '5559edd38968ec0736000456',
                                containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                                end: sinon.match.number,
                                execId: 'some-exec-id',
                                function: 'data_trigger',
                                messageId: sinon.match.string,
                                parentMessageId: message.properties.headers.messageId,
                                start: sinon.match.number,
                                stepId: 'step_1',
                                taskId: '5559edd38968ec0736000003',
                                threadId: message.properties.headers.threadId,
                                userId: '5559edd38968ec0736000002',
                                workspaceId: '5559edd38968ec073600683'
                            })
                        );

                        expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
                    });
                });

                describe('and one object can not be downloaded successfully', () => {
                    let bodyRequestStub;
                    let passthroughRequestStub;
                    let runExecSpy;
                    beforeEach(async () => {
                        const getObjectStub = sandbox.stub(sailor.objectStorage, 'getAsJSON');
                        bodyRequestStub = getObjectStub
                            .withArgs(bodyObjectId, settings.OBJECT_STORAGE_TOKEN)
                            .resolves(body);
                        passthroughRequestStub = bodyRequestStub.withArgs(passthroughObjectId).rejects(new Error());

                        runExecSpy = sandbox.spy(sailor, 'runExec');
                    });

                    it('should fetch message bodies and reject', async () => {
                        await sailor.processMessage(payload, message);
                        expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                        expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
                        sinon.assert.calledOnce(bodyRequestStub);
                        sinon.assert.calledOnce(passthroughRequestStub);
                        sinon.assert.notCalled(runExecSpy);

                        expect(fakeAMQPConnection.sendError).to.have.been.calledOnce.and.calledWith(
                            sinon.match({
                                message: `Failed to get message body with id=${passthroughObjectId}`,
                                stack: sinon.match.string
                            }),
                            sinon.match.object,
                            message
                        );

                        expect(fakeAMQPConnection.reject).to.have.been.calledOnce.and.calledWith(message);
                    });
                });
            });

            describe('when autoResolveObjectReference disabled', () => {
                let sailor;
                let runExecSpy;
                let passthroughRequestStub;
                beforeEach(async () => {
                    settings.FUNCTION = 'data_trigger';
                    settings.COMPONENT_PATH = '/spec/component-auto-resolve-object-refs-false';
                    sailor = new Sailor(settings);

                    sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                        expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                        expect(stepId).to.deep.equal('step_1');

                        return Promise.resolve({
                            is_passthrough: true
                        });
                    });

                    runExecSpy = sandbox.spy(sailor, 'runExec');

                    passthroughRequestStub = sandbox
                        .stub(sailor.objectStorage, 'getAsJSON')
                        .withArgs(passthroughObjectId, settings.OBJECT_STORAGE_TOKEN)
                        .resolves(passThroughBody);

                    await sailor.connect();
                    await sailor.prepare();
                });

                it('should not fetch message bodies and process', async () => {
                    await sailor.processMessage(payload, message);
                    await new Promise(resolve => setTimeout(resolve, 50)); // wait for upload
                    expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                    expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
                    sinon.assert.calledOnce(passthroughRequestStub);
                    sinon.assert.calledOnce(runExecSpy);
                    sinon.assert.calledWith(
                        runExecSpy,
                        sinon.match.object,
                        payload,
                        message,
                        sinon.match.object,
                        sinon.match.object,
                        sinon.match.number,
                        sinon.match.object
                    );
                    expect(fakeAMQPConnection.sendData).to.have.been.calledOnce.and.calledWith(
                        {
                            headers: {},
                            body: { items: [1, 2, 3, 4, 5, 6] },
                            passthrough: {
                                step_1: {
                                    headers: {},
                                    body: { items: [1, 2, 3, 4, 5, 6] }
                                },
                                step_2: {
                                    body: { step_1: 'body' }
                                },
                                step_3: {
                                    body: { step_2: 'body' },
                                    headers: {}
                                },
                                step_4: {
                                    headers: {
                                        [Sailor.OBJECT_ID_HEADER]: passthroughObjectId
                                    },
                                    body: passThroughBody
                                }
                            }
                        },
                        sinon.match({
                            compId: '5559edd38968ec0736000456',
                            containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                            end: sinon.match.number,
                            execId: 'some-exec-id',
                            function: 'data_trigger',
                            messageId: sinon.match.string,
                            parentMessageId: message.properties.headers.messageId,
                            start: sinon.match.number,
                            stepId: 'step_1',
                            taskId: '5559edd38968ec0736000003',
                            threadId: message.properties.headers.threadId,
                            userId: '5559edd38968ec0736000002',
                            workspaceId: '5559edd38968ec073600683'
                        })
                    );

                    expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
                });
            });
        });

        describe('when outgoing lightweight is enabled', () => {
            let payload;
            let sailor;
            let passthroughObjectId;
            beforeEach(async () => {
                passthroughObjectId = 'passthrough-object-id';
                payload = {
                    headers: {},
                    body: {
                        some: 'body'
                    },
                    passthrough: {
                        step_2: {
                            headers: {
                                [Sailor.OBJECT_ID_HEADER]: passthroughObjectId
                            },
                            body: {}
                        },
                        step_3: {
                            headers: {},
                            body: {
                                pass: 'body'
                            }
                        }
                    }
                };
                settings.FUNCTION = 'data_trigger';
                settings.EMIT_LIGHTWEIGHT_MESSAGE = true;
            });

            describe('when message is above OBJECT_STORAGE_SIZE_THRESHOLD', () => {
                beforeEach(async () => {
                    settings.OBJECT_STORAGE_SIZE_THRESHOLD = 1;
                    sailor = new Sailor(settings);

                    sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                        expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                        expect(stepId).to.deep.equal('step_1');

                        return Promise.resolve({
                            is_passthrough: true
                        });
                    });

                    sandbox.stub(sailor.objectStorage, 'getAsJSON')
                        .withArgs(passthroughObjectId, settings.OBJECT_STORAGE_TOKEN)
                        .resolves({ passthrough: 'body' });

                    await sailor.connect();
                    await sailor.prepare();
                });

                describe('and all objects can be uploaded successfully', () => {
                    let addObjectStub;
                    let bodyObjectId;
                    beforeEach(async () => {
                        bodyObjectId = 'body-object-id';
                        addObjectStub = sandbox.stub(sailor.objectStorage, 'addAsStream').resolves(bodyObjectId);
                    });

                    it('should send lightweight', async () => {
                        await sailor.processMessage(payload, message);
                        await new Promise(resolve => setTimeout(resolve, 10)); //wait for upload
                        expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                        expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
                        sinon.assert.calledTwice(addObjectStub);
                        sinon.assert.notCalled(fakeAMQPConnection.sendError);
                        expect(fakeAMQPConnection.sendData).to.have.been.calledOnce.and.calledWith(
                            {
                                body: {},
                                headers: { [Sailor.OBJECT_ID_HEADER]: bodyObjectId },
                                passthrough: {
                                    ...payload.passthrough,
                                    step_2: {
                                        body: {},
                                        headers: {
                                            [Sailor.OBJECT_ID_HEADER]: passthroughObjectId
                                        }
                                    },
                                    step_1: {
                                        headers: {
                                            [Sailor.OBJECT_ID_HEADER]: bodyObjectId
                                        },
                                        body: {}
                                    },
                                    step_3: {
                                        headers: {
                                            [Sailor.OBJECT_ID_HEADER]: bodyObjectId
                                        },
                                        body: {}
                                    }
                                }
                            },
                            sinon.match({
                                compId: '5559edd38968ec0736000456',
                                containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                                end: sinon.match.number,
                                execId: 'some-exec-id',
                                function: 'data_trigger',
                                messageId: sinon.match.string,
                                parentMessageId: message.properties.headers.messageId,
                                start: sinon.match.number,
                                stepId: 'step_1',
                                taskId: '5559edd38968ec0736000003',
                                threadId: message.properties.headers.threadId,
                                userId: '5559edd38968ec0736000002',
                                workspaceId: '5559edd38968ec073600683'
                            })
                        );

                        expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
                    });
                });

                describe('and objects can not be uploaded successfully', () => {
                    let addObjectStub;
                    beforeEach(async () => {
                        addObjectStub = sandbox.stub(sailor.objectStorage, 'addAsStream').rejects(new Error());
                    });

                    it('should not upload lightweight', async () => {
                        await sailor.processMessage(payload, message);
                        await new Promise(resolve => setTimeout(resolve, 100)); //wait for upload
                        expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                        expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
                        sinon.assert.calledTwice(addObjectStub);
                        expect(fakeAMQPConnection.sendError).to.have.been.calledOnce.and.calledWith(
                            sinon.match({
                                message: 'Lightweight message/passthrough body upload error',
                                stack: sinon.match.string
                            }),
                        );
                        expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
                    });
                });
            });

            describe('when message is below OBJECT_STORAGE_SIZE_THRESHOLD', () => {
                beforeEach(async () => {
                    settings.OBJECT_STORAGE_SIZE_THRESHOLD = 61;
                    sailor = new Sailor(settings);

                    sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                        expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                        expect(stepId).to.deep.equal('step_1');

                        return Promise.resolve({
                            is_passthrough: true
                        });
                    });

                    sandbox.stub(sailor.objectStorage, 'getAsJSON')
                        .withArgs(passthroughObjectId, settings.OBJECT_STORAGE_TOKEN)
                        .resolves({ passthrough: 'body' });

                    await sailor.connect();
                    await sailor.prepare();
                });

                describe('and all objects can be uploaded successfully', () => {
                    let addObjectSpy;
                    beforeEach(async () => {
                        addObjectSpy = sandbox.spy(sailor.objectStorage, 'addAsStream');
                    });

                    it('should not send lightweight', async () => {
                        await sailor.processMessage(payload, message);
                        await new Promise(resolve => setTimeout(resolve, 10)); //wait for upload
                        expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                        expect(fakeAMQPConnection.connect).to.have.been.calledOnce;
                        sinon.assert.notCalled(addObjectSpy);
                        sinon.assert.notCalled(fakeAMQPConnection.sendError);
                        sinon.assert.calledOnce(fakeAMQPConnection.sendData);
                        sinon.assert.calledWith(
                            fakeAMQPConnection.sendData,
                            {
                                body: { items: [1, 2, 3, 4, 5, 6] },
                                headers: {},
                                passthrough: {
                                    ...payload.passthrough,
                                    step_1: {
                                        body: { items: [1, 2, 3, 4, 5, 6] },
                                        headers: {}
                                    }
                                }
                            },
                            sinon.match({
                                compId: '5559edd38968ec0736000456',
                                containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                                end: sinon.match.number,
                                execId: 'some-exec-id',
                                function: 'data_trigger',
                                messageId: sinon.match.string,
                                parentMessageId: message.properties.headers.messageId,
                                start: sinon.match.number,
                                stepId: 'step_1',
                                taskId: '5559edd38968ec0736000003',
                                threadId: message.properties.headers.threadId,
                                userId: '5559edd38968ec0736000002',
                                workspaceId: '5559edd38968ec073600683'
                            })
                        );

                        expect(fakeAMQPConnection.ack).to.have.been.calledOnce.and.calledWith(message);
                    });
                });
            });
        });
    });
});
