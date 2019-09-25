const chai = require('chai');
const sinon = require('sinon');
chai.use(require('sinon-chai'));
chai.use(require('chai-uuid'));
const { expect } = chai;
const uuid = require('uuid');
const _ = require('lodash');

const AmqpCommunicationLayer = require('../../lib/amqp.js').AmqpCommunicationLayer;
const AmqpConnWrapper = require('../../lib/AmqpConnWrapper.js');
const Sailor = require('../../lib/sailor.js');
const encryptor = require('../../lib/encryptor.js');

describe('Sailor', () => {

    let config;
    let amqpCommunicationLayer;
    let logger;
    let sandbox;
    let message;

    const payload = { param1: 'Value1' };

    beforeEach(() => {
        sandbox = sinon.createSandbox();

        config = {
            /************************ SAILOR ITSELF CONFIGURATION ***********************************/
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

            COMPONENT_PATH: '/spec/component',

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

            RABBITMQ_PREFETCH_SAILOR: 1
        };
        const cryptoSettings = {
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
                    taskId: '5559edd38968ec0736000003',
                    execId: 'some-exec-id',
                    userId: '5559edd38968ec0736000002',
                    workspaceId: '5559edd38968ec073600683',
                    threadId: uuid.v4()
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
            content: Buffer.from(encryptor.encryptMessageContent(cryptoSettings,payload))
        };

        const amqpConn = new AmqpConnWrapper();
        const publishChannel = {
            publish: sandbox.stub().returns(true),
            waitForConfirms: sandbox.stub().resolves([null]),
            on: sandbox.stub()
        };
        const subscribeChannel = {
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
            warn: sandbox.stub(),
            debug: sandbox.stub(),
            trace: sandbox.stub(),
            child: sandbox.stub().callsFake(() => logger)
        };

        amqpCommunicationLayer = new AmqpCommunicationLayer(amqpConn, config, logger);
    });
    afterEach(() => {
        sandbox.restore();
    });

    describe('init', () => {
        it('should init properly if developer returned a plain string in init', async () => {
            config.FUNCTION = 'init_trigger_returns_string';

            const sailor = new Sailor(amqpCommunicationLayer, config, logger);

            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {
                    config: {
                        _account: '1234567890'
                    }
                };
            });

            await sailor.prepare();
            const result = await sailor.init();
            expect(result).to.equal('this_is_a_string');
        });

        it('should init properly if developer returned a promise', async () => {
            config.FUNCTION = 'init_trigger';

            const sailor = new Sailor(amqpCommunicationLayer, config, logger);

            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {
                    config: {
                        _account: '1234567890'
                    }
                };
            });

            await sailor.prepare();
            const result = await sailor.init();
            expect(result).to.deep.equal({
                subscriptionId: '_subscription_123'
            });
        });
    });

    describe('prepare', () => {
        let sailor;

        beforeEach(() => {
            sailor = new Sailor(amqpCommunicationLayer, config, logger);
        });

        describe('when step data retrieved', () => {
            let stepData;

            beforeEach(() => {
                stepData = {
                    snapshot: {}
                };
            });

            describe(`when step data retreived`, () => {
                beforeEach(() => {
                    sandbox.stub(sailor.componentReader, 'init').resolves();
                    sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').resolves(stepData);
                });

                it('should init component', async () => {
                    await sailor.prepare();
                    expect(sailor.stepData).to.deep.equal(stepData);
                    expect(sailor.snapshot).to.deep.equal(stepData.snapshot);
                    expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce
                        .and.calledWith(config.FLOW_ID, config.STEP_ID);
                    expect(sailor.componentReader.init).to.have.been.calledOnce
                        .and.calledWith(config.COMPONENT_PATH);
                });
            });
        });

        describe('when step data is not retrieved', () => {
            let error;
            beforeEach(() => {
                error = new Error('failed');
                sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').rejects(error);
            });

            it('should fail', async () => {
                let caughtError;
                try {
                    await sailor.prepare();
                } catch (e) {
                    caughtError = e;
                }
                expect(caughtError).to.equal(error);
            });
        });
    });

    describe('processMessage', () => {
        it('should call sendData() and ack() if success', async () => {
            sandbox.useFakeTimers();
            config.FUNCTION = 'data_trigger';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);

            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });
            sandbox.stub(amqpCommunicationLayer, 'sendData');
            sandbox.stub(amqpCommunicationLayer, 'ack');
            await sailor.prepare();
            await sailor.processMessage(payload, message);

            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce
                .and.calledWith(config.FLOW_ID, config.STEP_ID);

            expect(amqpCommunicationLayer.sendData).to.have.been.calledOnce.and.calledWith(
                { items: [1,2,3,4,5,6] },
                sinon.match((arg) => {
                    expect(arg.headers.messageId).to.be.a.uuid('v4');
                    delete arg.headers.messageId;
                    expect(arg).to.deep.equal({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        mandatory: true,
                        headers: {
                            execId: 'some-exec-id',
                            taskId: '5559edd38968ec0736000003',
                            userId: '5559edd38968ec0736000002',
                            workspaceId: '5559edd38968ec073600683',
                            containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                            stepId: 'step_1',
                            compId: '5559edd38968ec0736000456',
                            threadId: message.properties.headers.threadId,
                            function: 'data_trigger',
                            start: 0,
                            cid: 1,
                            end: 0
                        }
                    });
                    return true;
                })
            );

            expect(amqpCommunicationLayer.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should call sendData() and ack() only once', async () => {
            config.FUNCTION = 'end_after_data_twice';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);

            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });
            sandbox.stub(amqpCommunicationLayer, 'sendData');
            sandbox.stub(amqpCommunicationLayer, 'ack');
            sandbox.stub(amqpCommunicationLayer, 'reject');

            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(amqpCommunicationLayer.sendData).to.have.been.calledOnce;

            expect(amqpCommunicationLayer.reject).not.to.have.been.called;
            expect(amqpCommunicationLayer.ack).to.have.been.calledOnce;
        });

        it('should augment emitted message with passthrough data', async () => {
            sandbox.useFakeTimers();
            config.FUNCTION = 'passthrough';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);

            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return { is_passthrough: true };
            });

            const psPayload = {
                body: payload,
                passthrough: {
                    step_0: {
                        body: { key: 'value' }
                    }
                }
            };

            sandbox.stub(amqpCommunicationLayer, 'sendData');
            sandbox.stub(amqpCommunicationLayer, 'ack');

            await sailor.prepare();
            await sailor.processMessage(psPayload, message);

            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(amqpCommunicationLayer.sendData).to.have.been.calledOnce.and.calledWith(
                {
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
                            body: { param1: 'Value1' }
                        }
                    }
                },
                sinon.match(arg => {
                    expect(arg.headers.messageId).to.be.a.uuid('v4');
                    delete arg.headers.messageId;
                    expect(arg).to.deep.equal({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        mandatory: true,
                        headers: {
                            execId: 'some-exec-id',
                            taskId: '5559edd38968ec0736000003',
                            userId: '5559edd38968ec0736000002',
                            containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                            workspaceId: '5559edd38968ec073600683',
                            stepId: 'step_1',
                            compId: '5559edd38968ec0736000456',
                            function: 'passthrough',
                            start: 0,
                            cid: 1,
                            end: 0,
                            threadId: message.properties.headers.threadId
                        }
                    });
                    return true;
                })
            );

            expect(amqpCommunicationLayer.ack).to.have.been.calledOnce.and.calledWith(message);
        });
        it('should provide access to flow vairables', async () => {
            sandbox.useFakeTimers();
            config.FUNCTION = 'use_flow_variables';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);

            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {
                    is_passthrough: false,
                    variables: {
                        var1: 'val1',
                        var2: 'val2'
                    }
                };
            });

            const psPayload = {
                body: payload
            };

            sandbox.stub(amqpCommunicationLayer, 'sendData');
            sandbox.stub(amqpCommunicationLayer, 'ack');

            await sailor.prepare();
            await sailor.processMessage(psPayload, message);

            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(amqpCommunicationLayer.sendData).to.have.been.calledOnce.and.calledWith(
                {
                    body: {
                        var1: 'val1',
                        var2: 'val2'
                    }
                },
                sinon.match(arg => {
                    expect(arg.headers.messageId).to.be.a.uuid('v4');
                    delete arg.headers.messageId;
                    expect(arg).to.deep.equal({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        mandatory: true,
                        headers: {
                            execId: 'some-exec-id',
                            taskId: '5559edd38968ec0736000003',
                            userId: '5559edd38968ec0736000002',
                            containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                            workspaceId: '5559edd38968ec073600683',
                            stepId: 'step_1',
                            compId: '5559edd38968ec0736000456',
                            function: 'use_flow_variables',
                            start: 0,
                            cid: 1,
                            end: 0,
                            threadId: message.properties.headers.threadId
                        }
                    });
                    return true;
                })
            );

            expect(amqpCommunicationLayer.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should send request to API server to update keys', async () => {
            config.FUNCTION = 'keys_trigger';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            const account = '1234567890';
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {
                    config: {
                        _account: account
                    }
                };
            });

            sandbox.stub(sailor._apiClient.accounts, 'update').callsFake(async (accountId, keys) => {
                expect(accountId).to.equal(account);
                expect(keys).to.deep.equal({ keys: { oauth: { access_token: 'newAccessToken' } } });
            });
            sandbox.stub(amqpCommunicationLayer, 'ack');

            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(sailor._apiClient.accounts.update).to.have.been.calledOnce;

            expect(amqpCommunicationLayer.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should emit error if failed to update keys', async () => {
            config.FUNCTION = 'keys_trigger';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            const account = '1234567890';
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {
                    config: {
                        _account: account
                    }
                };
            });
            const error = new Error('Update keys error');
            sandbox.stub(sailor._apiClient.accounts, 'update').callsFake(async (accountId, keys) => {
                expect(accountId).to.equal(account);
                expect(keys).to.deep.equal({ keys: { oauth: { access_token: 'newAccessToken' } } });
                throw error;
            });
            sandbox.stub(amqpCommunicationLayer, 'ack');
            sandbox.stub(amqpCommunicationLayer, 'sendError');
            await sailor.prepare();
            await sailor.processMessage(payload, message);
            // It will not throw an error because component
            // process method is not `async`
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(sailor._apiClient.accounts.update).to.have.been.calledOnce;

            expect(amqpCommunicationLayer.sendError).to.have.been.calledOnce
                .and.calledWith(sinon.match(arg => arg.message === error.message));
            expect(amqpCommunicationLayer.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should call sendRebound() and ack()', async () => {
            config.FUNCTION = 'rebound_trigger';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);

            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });
            sandbox.stub(amqpCommunicationLayer, 'sendRebound');
            sandbox.stub(amqpCommunicationLayer, 'ack');

            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(amqpCommunicationLayer.sendRebound).to.have.been.calledOnce
                .and.calledWith(sinon.match(arg => arg.message === 'Rebound reason'));
            expect(amqpCommunicationLayer.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should call sendSnapshot() and ack() after a `snapshot` event', async () => {
            sandbox.useFakeTimers();
            config.FUNCTION = 'update';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });
            sandbox.stub(amqpCommunicationLayer, 'sendSnapshot');
            sandbox.stub(amqpCommunicationLayer, 'ack');
            await sailor.prepare();
            const payload = {
                snapshot: { blabla: 'blablabla' }
            };
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            const expectedSnapshot = { blabla: 'blablabla' };
            expect(amqpCommunicationLayer.sendSnapshot).to.have.been.calledOnce.and.calledWith(
                expectedSnapshot,
                sinon.match(arg => {
                    expect(arg.headers.messageId).to.be.uuid('v4');
                    delete arg.headers.messageId;
                    expect(arg).to.deep.equal({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        mandatory: true,
                        headers: {
                            taskId: '5559edd38968ec0736000003',
                            execId: 'some-exec-id',
                            userId: '5559edd38968ec0736000002',
                            containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                            workspaceId: '5559edd38968ec073600683',
                            stepId: 'step_1',
                            compId: '5559edd38968ec0736000456',
                            function: 'update',
                            start: 0,
                            cid: 1,
                            snapshotEvent: 'snapshot',
                            threadId: message.properties.headers.threadId
                        }
                    });
                    return true;
                })
            );
            expect(amqpCommunicationLayer.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should call sendSnapshot() and ack() after an `updateSnapshot` event', async () => {
            sandbox.useFakeTimers();
            config.FUNCTION = 'update';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {
                    snapshot: {
                        someId: 'someData'
                    }
                };
            });

            sandbox.stub(amqpCommunicationLayer, 'sendSnapshot');
            sandbox.stub(amqpCommunicationLayer, 'ack');
            await sailor.prepare();
            const payload = {
                updateSnapshot: { updated: 'value' }
            };
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.to.have.been.calledOnce;

            const expectedSnapshot = { someId: 'someData', updated: 'value' };

            expect(amqpCommunicationLayer.sendSnapshot).to.have.been.calledOnce
                .and.calledWith(
                    { updated: 'value' },
                    sinon.match(arg => {
                        expect(arg.headers.messageId).to.be.uuid('v4');
                        delete arg.headers.messageId;
                        expect(arg).to.deep.equal({
                            contentType: 'application/json',
                            contentEncoding: 'utf8',
                            mandatory: true,
                            headers: {
                                taskId: '5559edd38968ec0736000003',
                                execId: 'some-exec-id',
                                userId: '5559edd38968ec0736000002',
                                containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                                workspaceId: '5559edd38968ec073600683',
                                stepId: 'step_1',
                                compId: '5559edd38968ec0736000456',
                                function: 'update',
                                start: 0,
                                cid: 1,
                                snapshotEvent: 'updateSnapshot',
                                threadId: message.properties.headers.threadId
                            }
                        });
                        return true;
                    })
                );
            expect(sailor.snapshot).to.deep.equal(expectedSnapshot);
            expect(amqpCommunicationLayer.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should send error if error happened', async () => {
            config.FUNCTION = 'error_trigger';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });
            sandbox.stub(amqpCommunicationLayer, 'sendError');
            sandbox.stub(amqpCommunicationLayer, 'reject');
            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(amqpCommunicationLayer.sendError).to.have.been.calledOnce
                .and.calledWith(
                    sinon.match(arg => {
                        expect(arg.message).to.equal('Some component error');
                        expect(arg.stack).to.be.ok;
                        return true;
                    }),
                    sinon.match(() => true),
                    message.content
                );
            expect(amqpCommunicationLayer.reject).to.have.been.calledOnce.and.calledWith(message);

        });

        it('should send error and reject only once()', async () => {
            config.FUNCTION = 'end_after_error_twice';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });
            sandbox.stub(amqpCommunicationLayer, 'reject');
            sandbox.stub(amqpCommunicationLayer, 'ack');
            sandbox.stub(amqpCommunicationLayer, 'sendError');
            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(amqpCommunicationLayer.sendError).to.have.been.calledOnce;
            expect(amqpCommunicationLayer.ack).not.to.have.been.called;
            expect(amqpCommunicationLayer.reject).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should reject message if trigger is missing', async () => {
            config.FUNCTION = 'missing_trigger';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });

            sandbox.stub(amqpCommunicationLayer, 'reject');
            sandbox.stub(amqpCommunicationLayer, 'sendError');

            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(amqpCommunicationLayer.sendError).to.have.been.calledOnce
                .and.calledWith(
                    sinon.match(arg => {
                        expect(arg.message).match(
                            /Failed to load file \'.\/triggers\/missing_trigger.js\': Cannot find module.+missing_trigger\.js/ // eslint-disable-line
                        );
                        expect(arg.stack).to.be.ok;
                        return true;
                    }),
                    sinon.match(() => true),
                    message.content
                );
            expect(amqpCommunicationLayer.reject).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should not process message if taskId in header is not equal to task._id', async () => {
            const message2 = _.cloneDeep(message);
            message2.properties.headers.taskId = 'othertaskid';

            config.FUNCTION = 'error_trigger';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });

            sandbox.stub(amqpCommunicationLayer, 'reject');

            await sailor.prepare();
            await sailor.processMessage(payload, message2);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(amqpCommunicationLayer.reject).to.have.been.calledOnce;
        });

        it('should catch all data calls and all error calls', async () => {
            const clock = sandbox.useFakeTimers();
            // Notice this test relies on timeout's behavior of sailor
            // e.g. if message is not processed during timeout
            // (see ELASTICIO_TIMEOUT env var or TIMEOUT parameter in config)
            // then end message is emitted anyway.
            config.FUNCTION = 'datas_and_errors';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });

            sandbox.stub(amqpCommunicationLayer, 'sendData');
            sandbox.stub(amqpCommunicationLayer, 'sendError');
            sandbox.stub(amqpCommunicationLayer, 'reject');

            await sailor.prepare();
            // SORRY i was made to do this by angry aliens
            process.nextTick(() => {
                clock.tick(1000);
                process.nextTick(() => clock.tick(2000));
            });
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(amqpCommunicationLayer.sendData).to.have.been.calledThrice;
            expect(amqpCommunicationLayer.sendError).to.have.been.calledTwice;
            expect(amqpCommunicationLayer.reject).to.have.been.calledOnce.and.calledWith(message);
        }).timeout(10000);

        it('should handle errors in httpReply properly', async () => {
            sandbox.useFakeTimers();
            config.FUNCTION = 'http_reply';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });

            sandbox.stub(amqpCommunicationLayer, 'sendHttpReply');
            sandbox.stub(amqpCommunicationLayer, 'ack');
            sandbox.stub(amqpCommunicationLayer, 'sendData');

            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce
                .and.calledWith(config.FLOW_ID, config.STEP_ID);

            expect(amqpCommunicationLayer.sendHttpReply).to.have.been.calledOnce.and.calledWith(
                {
                    statusCode: 200,
                    body: 'Ok',
                    headers: {
                        'content-type': 'text/plain'
                    }
                },
                sinon.match(arg => {
                    expect(arg.headers.messageId).to.be.uuid('v4');
                    delete arg.headers.messageId;
                    expect(arg).to.deep.equal({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        mandatory: true,
                        headers: {
                            execId: 'some-exec-id',
                            taskId: '5559edd38968ec0736000003',
                            userId: '5559edd38968ec0736000002',
                            containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                            workspaceId: '5559edd38968ec073600683',
                            stepId: 'step_1',
                            compId: '5559edd38968ec0736000456',
                            function: 'http_reply',
                            start: 0,
                            cid: 1,
                            threadId: message.properties.headers.threadId
                        }
                    });
                    return true;
                })
            );

            expect(amqpCommunicationLayer.sendData).to.have.been.calledOnce.and.calledWith(
                { body: {} },
                sinon.match(arg => {
                    expect(arg.headers.messageId).to.be.uuid('v4');
                    delete arg.headers.messageId;
                    expect(arg).to.deep.equal({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        mandatory: true,
                        headers: {
                            execId: 'some-exec-id',
                            taskId: '5559edd38968ec0736000003',
                            userId: '5559edd38968ec0736000002',
                            containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                            workspaceId: '5559edd38968ec073600683',
                            stepId: 'step_1',
                            compId: '5559edd38968ec0736000456',
                            function: 'http_reply',
                            threadId: message.properties.headers.threadId,
                            start: 0,
                            cid: 1,
                            end: 0
                        }
                    });
                    return true;
                })
            );
            expect(amqpCommunicationLayer.ack).to.have.been.calledOnce.and.calledWith(message);
        });

        it('should handle errors in httpReply properly', async () => {
            sandbox.useFakeTimers();
            config.FUNCTION = 'http_reply';
            const sailor = new Sailor(amqpCommunicationLayer, config, logger);
            sandbox.stub(sailor._apiClient.tasks, 'retrieveStep').callsFake(async (taskId, stepId) => {
                expect(taskId).to.equal(config.FLOW_ID);
                expect(stepId).to.equal(config.STEP_ID);
                return {};
            });

            sandbox.stub(amqpCommunicationLayer, 'sendHttpReply').rejects(new Error('Failed to send HTTP reply'));
            sandbox.stub(amqpCommunicationLayer, 'ack');
            sandbox.stub(amqpCommunicationLayer, 'reject');
            sandbox.stub(amqpCommunicationLayer, 'sendError');
            sandbox.stub(amqpCommunicationLayer, 'sendData');


            await sailor.prepare();
            await sailor.processMessage(payload, message);
            expect(sailor._apiClient.tasks.retrieveStep).to.have.been.calledOnce
                .and.calledWith(config.FLOW_ID, config.STEP_ID);

            expect(amqpCommunicationLayer.sendHttpReply).to.have.been.calledOnce
                .and.calledWith(
                    {
                        statusCode: 200,
                        body: 'Ok',
                        headers: {
                            'content-type': 'text/plain'
                        }
                    },
                    sinon.match(arg => {
                        expect(arg.headers.messageId).to.be.uuid('v4');
                        delete arg.headers.messageId;

                        expect(arg).to.deep.equal({
                            contentType: 'application/json',
                            contentEncoding: 'utf8',
                            mandatory: true,
                            headers: {
                                execId: 'some-exec-id',
                                taskId: '5559edd38968ec0736000003',
                                userId: '5559edd38968ec0736000002',
                                containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                                workspaceId: '5559edd38968ec073600683',
                                stepId: 'step_1',
                                compId: '5559edd38968ec0736000456',
                                function: 'http_reply',
                                threadId: message.properties.headers.threadId,
                                start: 0,
                                cid: 1
                            }
                        });
                        return true;
                    })
                );

            expect(amqpCommunicationLayer.ack).not.to.have.been.called;
            expect(amqpCommunicationLayer.sendData).not.to.have.been.called;
            expect(amqpCommunicationLayer.reject).to.have.been.calledOnce.and.calledWith(message);
            expect(amqpCommunicationLayer.sendError).to.have.been.calledOnce.and.calledWith(sinon.match(arg => {
                expect(arg.message).to.equal('Failed to send HTTP reply');
                return true;
            }));
        });
    });

    describe('_readIncomingMessageHeaders', () => {
        let sailor;
        beforeEach(() => {
            sailor = new Sailor(amqpCommunicationLayer, config, logger);
        });
        it('execId missing', () => {
            try {
                sailor._readIncomingMessageHeaders({
                    properties: {
                        headers: {}
                    }
                });
                throw new Error('Must not be reached');
            } catch (e) {
                expect(e.message).to.equal('ExecId is missing in message header');
            }
        });

        it('taskId missing', () => {
            try {
                sailor._readIncomingMessageHeaders({
                    properties: {
                        headers: {
                            execId: 'my_exec_123'
                        }
                    }
                });
                throw new Error('Must not be reached');
            } catch (e) {
                expect(e.message).to.equal('TaskId is missing in message header');
            }
        });

        it('userId missing', () => {
            try {
                sailor._readIncomingMessageHeaders({
                    properties: {
                        headers: {
                            execId: 'my_exec_123',
                            taskId: 'my_task_123'
                        }
                    }
                });
                throw new Error('Must not be reached');
            } catch (e) {
                expect(e.message).to.equal('UserId is missing in message header');
            }
        });

        it('Message with wrong taskID arrived to the sailor', () => {
            try {
                sailor._readIncomingMessageHeaders({
                    properties: {
                        headers: {
                            execId: 'my_exec_123',
                            taskId: 'my_task_123',
                            userId: 'my_user_123'
                        }
                    }
                });
                throw new Error('Must not be reached');
            } catch (e) {
                expect(e.message).to.equal('Message with wrong taskID arrived to the sailor');
            }
        });

        it('should copy standard headers', () => {
            const headers = {
                execId: 'my_exec_123',
                taskId: config.FLOW_ID,
                userId: 'my_user_123',
                threadId: uuid.v4()
            };

            const result = sailor._readIncomingMessageHeaders({
                properties: {
                    headers
                }
            });

            expect(result).to.deep.equal(headers);
        });

        it('should copy standard headers and parentMessageId', () => {
            const messageId = 'parent_message_1234';

            const headers = {
                execId: 'my_exec_123',
                taskId: config.FLOW_ID,
                userId: 'my_user_123',
                messageId,
                threadId: uuid.v4()
            };

            const result = sailor._readIncomingMessageHeaders({
                properties: {
                    headers
                }
            });

            expect(result).to.deep.equal({
                execId: 'my_exec_123',
                taskId: config.FLOW_ID,
                userId: 'my_user_123',
                parentMessageId: messageId,
                threadId: headers.threadId
            });
        });

        it('should copy standard headers and reply_to', () => {
            const headers = {
                execId: 'my_exec_123',
                taskId: config.FLOW_ID,
                userId: 'my_user_123',
                reply_to: 'my_reply_to_exchange',
                threadId: uuid.v4()
            };

            const result = sailor._readIncomingMessageHeaders({
                properties: {
                    headers
                }
            });

            expect(result).to.deep.equal(headers);
        });

        it('should copy standard headers, reply_to and x-eio headers', () => {
            const headers = {
                'execId': 'my_exec_123',
                'taskId': config.FLOW_ID,
                'userId': 'my_user_123',
                'reply_to': 'my_reply_to_exchange',
                'x-eio-meta-lowercase': 'I am lowercase',
                'X-eio-meta-miXeDcAse': 'Eventually to become lowercase',
                'threadId': uuid.v4()
            };

            const result = sailor._readIncomingMessageHeaders({
                properties: {
                    headers
                }
            });

            expect(result).to.deep.equal({
                'execId': 'my_exec_123',
                'taskId': config.FLOW_ID,
                'userId': 'my_user_123',
                'reply_to': 'my_reply_to_exchange',
                'x-eio-meta-lowercase': 'I am lowercase',
                'x-eio-meta-mixedcase': 'Eventually to become lowercase',
                'threadId': headers.threadId
            });
        });
    });

});
