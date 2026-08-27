'use strict';

const chai = require('chai');
const sinon = require('sinon');
const { expect } = chai;
chai.use(require('sinon-chai'));

const uuid = require('uuid');

const { Sailor } = require('../../lib/sailor');
const { ProxyClient } = require('../../lib/proxy-client');
const Settings = require('../../lib/settings');

describe('Sailor', () => {
    let settings;
    let sandbox;
    let envVars;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        envVars = {};

        envVars.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
        envVars.ELASTICIO_STEP_ID = 'step_1';
        envVars.ELASTICIO_EXEC_ID = 'some-exec-id';
        envVars.ELASTICIO_WORKSPACE_ID = '5559edd38968ec073600683';
        envVars.ELASTICIO_CONTAINER_ID = 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948';

        envVars.ELASTICIO_USER_ID = '5559edd38968ec0736000002';
        envVars.ELASTICIO_COMP_ID = '5559edd38968ec0736000456';
        envVars.ELASTICIO_FUNCTION = 'list';

        envVars.ELASTICIO_COMPONENT_PATH = '/spec/component';
        envVars.ELASTICIO_DEBUG = 'sailor';

        envVars.ELASTICIO_API_URI = 'http://apihost.com';
        envVars.ELASTICIO_API_USERNAME = 'test@test.com';
        envVars.ELASTICIO_API_KEY = '5559edd';

        envVars.ELASTICIO_MESSAGE_CRYPTO_PASSWORD = 'testCryptoPassword';
        envVars.ELASTICIO_MESSAGE_CRYPTO_IV = 'iv=any16_symbols';

        envVars.ELASTICIO_SAILOR_PROXY_URI = 'http://test-proxy:1245';
        envVars.ELASTICIO_SAILOR_PROXY_JWT_SECRET = 'testProxySecret';

        envVars.ELASTICIO_OUTGOING_MESSAGE_SIZE_LIMIT = '1000000';

        settings = Settings.readFrom(envVars);
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('processMessage', function () {
        let metadata;
        let payload;

        beforeEach(() => {
            // Stub all ProxyClient prototype methods so no real HTTP/2 connections are made.
            sandbox.stub(ProxyClient.prototype, 'connect').resolves();
            sandbox.stub(ProxyClient.prototype, 'disconnect').resolves();
            sandbox.stub(ProxyClient.prototype, 'sendMessage').resolves();
            sandbox.stub(ProxyClient.prototype, 'sendError').resolves();
            sandbox.stub(ProxyClient.prototype, 'sendRebound').resolves();
            sandbox.stub(ProxyClient.prototype, 'sendSnapshot').resolves();
            sandbox.stub(ProxyClient.prototype, 'finishProcessing').resolves();

            payload = { param1: 'Value1' };
            metadata = {
                messageId: uuid.v4(),
                threadId: uuid.v4(),
                parentMessageId: uuid.v4(),
                stepId: settings.STEP_ID,
                protocolVersion: 1
            };
        });

        it('should call sendMessage(data) and finishProcessing(success) if success', async () => {
            settings.FUNCTION = 'data_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(sailor.proxyClient.connect).to.have.been.calledOnce;
            expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce.and.calledWith(sinon.match({
                type: 'data',
                data: { headers: {}, body: { items: [1, 2, 3, 4, 5, 6] } },
                metadata: sinon.match({
                    compId: '5559edd38968ec0736000456',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    end: sinon.match.number,
                    execId: 'some-exec-id',
                    function: 'data_trigger',
                    parentMessageId: metadata.messageId,
                    start: sinon.match.number,
                    stepId: 'step_1',
                    taskId: '5559edd38968ec0736000003',
                    threadId: metadata.threadId,
                    userId: '5559edd38968ec0736000002',
                    workspaceId: '5559edd38968ec073600683'
                })
            }));

            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'success'
            );
        });

        it('should call sendMessage() with extended (snake_case) additional-vars headers', async () => {
            const customVars = {
                ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS: 'ELASTICIO_FIRST, ELASTICIO_SECOND_ELASTICIO_ENV,' +
                    'ELASTICIO_NOT_PRESENT',
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
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(sailor.proxyClient.connect).to.have.been.calledOnce;
            expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce.and.calledWith(sinon.match({
                type: 'data',
                data: { headers: {}, body: { items: [1, 2, 3, 4, 5, 6] } },
                metadata: sinon.match({
                    first: 'first',
                    second_elasticio_env: 'second',
                    not_present: undefined,
                    execId: 'some-exec-id',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    workspaceId: '5559edd38968ec073600683',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'data_trigger',
                    start: sinon.match.number,
                    end: sinon.match.number
                })
            }));
        });

        it('should call sendMessage(data) and finishProcessing only once when end emitted twice', async () => {
            settings.FUNCTION = 'end_after_data_twice';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(sailor.proxyClient.connect).to.have.been.calledOnce;
            expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce;
            expect(sailor.proxyClient.sendError).not.to.have.been.called;
            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'success'
            );
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
            await sailor.processMessage(metadata, psPayload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(sailor.proxyClient.connect).to.have.been.calledOnce;
            expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce.and.calledWith(sinon.match({
                type: 'data',
                data: {
                    headers: {},
                    body: { param1: 'Value1' },
                    passthrough: {
                        step_0: { body: { key: 'value' } },
                        step_1: { headers: {}, body: { param1: 'Value1' } }
                    }
                },
                metadata: sinon.match({
                    execId: 'some-exec-id',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    workspaceId: '5559edd38968ec073600683',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'passthrough',
                    start: sinon.match.number,
                    end: sinon.match.number
                })
            }));

            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'success'
            );
        });

        it(
            'should augment emitted message with passthrough with data from incoming message ' +
            'if NO_SELF_PASSTRHOUGH set', async () => {
                metadata.stepId = 'step_0';
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
                await sailor.processMessage(metadata, psPayload);
                expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                expect(sailor.proxyClient.connect).to.have.been.calledOnce;
                expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce.and.calledWith(sinon.match({
                    type: 'data',
                    data: {
                        headers: {},
                        body: { param1: 'Value1' },
                        passthrough: {
                            step_oth: { body: { key: 'value' } },
                            step_0: { body: { param1: 'Value1' } }
                        }
                    },
                    metadata: sinon.match({
                        execId: 'some-exec-id',
                        taskId: '5559edd38968ec0736000003',
                        userId: '5559edd38968ec0736000002',
                        containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                        workspaceId: '5559edd38968ec073600683',
                        stepId: 'step_1',
                        compId: '5559edd38968ec0736000456',
                        function: 'passthrough',
                        start: sinon.match.number,
                        end: sinon.match.number
                    })
                }));

                expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                    metadata, 'success'
                );
            }
        );

        it(
            'should not augment emitted message with passthrough with data from incoming message ' +
            'if NO_SELF_PASSTRHOUGH set without stepId in metadata',
            async () => {
                delete metadata.stepId;
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
                await sailor.processMessage(metadata, psPayload);
                expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                expect(sailor.proxyClient.connect).to.have.been.calledOnce;
                expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce.and.calledWith(sinon.match({
                    type: 'data',
                    data: {
                        headers: {},
                        body: { param1: 'Value1' },
                        passthrough: {
                            step_oth: { body: { key: 'value' } }
                        }
                    },
                    metadata: sinon.match({
                        execId: 'some-exec-id',
                        taskId: '5559edd38968ec0736000003',
                        userId: '5559edd38968ec0736000002',
                        containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                        workspaceId: '5559edd38968ec073600683',
                        stepId: 'step_1',
                        compId: '5559edd38968ec0736000456',
                        function: 'passthrough',
                        start: sinon.match.number,
                        end: sinon.match.number
                    })
                }));

                expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                    metadata, 'success'
                );
            }
        );

        it('should provide access to flow variables', async () => {
            settings.FUNCTION = 'use_flow_variables';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({
                    is_passthrough: true,
                    variables: { var1: 'val1', var2: 'val2' }
                });
            });

            const psPayload = { body: payload };

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(metadata, psPayload);
            expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce.and.calledWith(sinon.match({
                type: 'data',
                data: sinon.match({ body: { var1: 'val1', var2: 'val2' } })
            }));
        });

        it('should send request to API server to update keys', async () => {
            settings.FUNCTION = 'keys_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({ config: { _account: '1234567890' } });
            });

            sandbox.stub(sailor.apiClient.accounts, 'update').callsFake((accountId, keys) => {
                expect(accountId).to.deep.equal('1234567890');
                expect(keys).to.deep.equal({ keys: { oauth: { access_token: 'newAccessToken' } } });
                return Promise.resolve();
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(sailor.apiClient.accounts.update).to.have.been.calledOnce;
            expect(sailor.proxyClient.connect).to.have.been.calledOnce;
            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'success'
            );
        });

        it('should emit error if failed to update keys', async () => {
            settings.FUNCTION = 'keys_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({ config: { _account: '1234567890' } });
            });

            sandbox.stub(sailor.apiClient.accounts, 'update').callsFake((accountId, keys) => {
                expect(accountId).to.deep.equal('1234567890');
                expect(keys).to.deep.equal({ keys: { oauth: { access_token: 'newAccessToken' } } });
                return Promise.reject(new Error('Update keys error'));
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            expect(sailor.apiClient.accounts.update).to.have.been.calledOnce;

            expect(sailor.proxyClient.connect).to.have.been.calledOnce;
            expect(sailor.proxyClient.sendError).to.have.been.calledOnce.and.calledWith(sinon.match({
                message: 'Update keys error'
            }));
            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'success' // onEnd sees errorCount=0 before onUpdateKeys increments it
            );
        });

        it('should call sendRebound() and finishProcessing(success)', async () => {
            settings.FUNCTION = 'rebound_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(sailor.proxyClient.sendRebound).to.have.been.calledOnce.and.calledWith(
                sinon.match({ message: 'Rebound reason' }),
                metadata,
                sinon.match.object
            );
            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'success'
            );
        });

        it('should call sendSnapshot() and finishProcessing(success) after a `snapshot` event', async () => {
            settings.FUNCTION = 'update';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            const snapshotPayload = { snapshot: { blabla: 'blablabla' } };
            await sailor.processMessage(metadata, snapshotPayload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            const expectedSnapshot = { blabla: 'blablabla' };
            expect(sailor.proxyClient.connect).to.have.been.calledOnce;

            expect(sailor.proxyClient.sendSnapshot).to.have.been.calledOnce.and.calledWith(
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
                    snapshotEvent: 'snapshot'
                })
            );
            expect(sailor.snapshot).to.deep.equal(expectedSnapshot);
            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'success'
            );
        });

        it('should call sendSnapshot() and finishProcessing(success) after an `updateSnapshot` event', async () => {
            settings.FUNCTION = 'update';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({ snapshot: { someId: 'someData' } });
            });

            await sailor.prepare();
            await sailor.connect();
            const updatePayload = { updateSnapshot: { updated: 'value' } };
            await sailor.processMessage(metadata, updatePayload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
            const expectedSnapshot = { someId: 'someData', updated: 'value' };
            expect(sailor.proxyClient.connect).to.have.been.calledOnce;

            expect(sailor.proxyClient.sendSnapshot).to.have.been.calledOnce.and.calledWith(
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
                    snapshotEvent: 'updateSnapshot'
                })
            );

            expect(sailor.snapshot).to.deep.equal(expectedSnapshot);
            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'success'
            );
        });

        it('should call sendError() and finishProcessing(error) if error happened', async () => {
            settings.FUNCTION = 'error_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(sailor.proxyClient.connect).to.have.been.calledOnce;

            expect(sailor.proxyClient.sendError).to.have.been.calledOnce.and.calledWith(
                sinon.match({
                    message: 'Some component error',
                    stack: sinon.match.string
                }),
                sinon.match.object,
                payload,
                metadata
            );

            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'error'
            );
        });

        it('should call sendError() and finishProcessing(error) only once when end emitted twice after error', async () => {
            settings.FUNCTION = 'end_after_error_twice';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(sailor.proxyClient.connect).to.have.been.calledOnce;
            expect(sailor.proxyClient.sendError).to.have.been.calledOnce;
            expect(sailor.proxyClient.sendMessage).not.to.have.been.called;
            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'error'
            );
        });

        it('should call sendError() and finishProcessing(error) if trigger is missing', async () => {
            settings.FUNCTION = 'missing_trigger';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                expect(stepId).to.deep.equal('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(sailor.proxyClient.connect).to.have.been.calledOnce;

            expect(sailor.proxyClient.sendError).to.have.been.calledOnce.and.calledWith(
                sinon.match({
                    /* eslint-disable max-len */
                    message: sinon.match(/Failed to load file '.\/triggers\/missing_trigger.js': Cannot find module.+missing_trigger\.js/),
                    /* eslint-enable max-len */
                    stack: sinon.match.truthy
                }),
                sinon.match.object,
                payload,
                metadata
            );

            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'error'
            );
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
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;

            expect(sailor.proxyClient.connect).to.have.been.calledOnce;

            // 3 data messages
            expect(sailor.proxyClient.sendMessage).to.have.callCount(3);
            // 2 errors
            expect(sailor.proxyClient.sendError).to.have.callCount(2);
            // finishProcessing with error (errorCount > 0)
            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'error'
            );
        });

        it('should handle httpReply properly', async () => {
            settings.FUNCTION = 'http_reply';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').resolves({});

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep)
                .to.have.been.calledWith('5559edd38968ec0736000003', 'step_1');

            expect(sailor.proxyClient.connect).to.have.been.calledOnce;

            // First call: http-reply
            expect(sailor.proxyClient.sendMessage.firstCall).to.have.been.calledWith(sinon.match({
                type: 'http-reply',
                data: {
                    statusCode: 200,
                    body: 'Ok',
                    headers: { 'content-type': 'text/plain' }
                },
                metadata: sinon.match({
                    execId: 'some-exec-id',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                    workspaceId: '5559edd38968ec073600683',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'http_reply',
                    start: sinon.match.number,
                    parentMessageId: metadata.messageId,
                    threadId: metadata.threadId
                })
            }));

            // Second call: data
            expect(sailor.proxyClient.sendMessage.secondCall).to.have.been.calledWith(sinon.match({
                type: 'data',
                data: { headers: {}, body: {} },
                metadata: sinon.match({
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
                    parentMessageId: metadata.messageId,
                    threadId: metadata.threadId
                })
            }));

            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'success'
            );
        });

        it('should handle errors in httpReply properly', async () => {
            settings.FUNCTION = 'http_reply';
            const sailor = new Sailor(settings);

            sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').resolves({});

            // Make sendMessage throw for http-reply type
            sailor.proxyClient.sendMessage.callsFake(({ type }) => {
                if (type === 'http-reply') {
                    throw new Error('Failed to send HTTP reply');
                }
                return Promise.resolve();
            });

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(metadata, payload);
            expect(sailor.apiClient.tasks.retrieveStep)
                .to.have.been.calledWith('5559edd38968ec0736000003', 'step_1');

            expect(sailor.proxyClient.connect).to.have.been.calledOnce;
            // sendMessage was called once (for http-reply, which threw)
            expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce;
            expect(sailor.proxyClient.sendMessage.firstCall.args[0].type).to.equal('http-reply');

            // error
            expect(sailor.proxyClient.sendError).to.have.been.calledOnce.and.calledWith(sinon.match({
                message: 'Failed to send HTTP reply',
                stack: sinon.match.truthy
            }));

            // finishProcessing with error
            expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                metadata, 'error'
            );
        });

        describe('for incoming lightweight message', () => {
            let lightweightPayload;
            let bodyObjectId;
            let passthroughObjectId;
            let body;
            let passThroughBody;

            beforeEach(() => {
                bodyObjectId = 'body-object-id';
                passthroughObjectId = 'passthrough-object-id';
                body = { data: { some: 'body' } };
                passThroughBody = { data: { some: 'body' } };
                lightweightPayload = {
                    headers: {
                        [Sailor.OBJECT_ID_HEADER]: bodyObjectId
                    },
                    body: {},
                    passthrough: {
                        step_2: { body: { step_1: 'body' } },
                        step_3: { headers: {}, body: { step_2: 'body' } },
                        step_4: {
                            headers: { [Sailor.OBJECT_ID_HEADER]: passthroughObjectId },
                            body: {}
                        }
                    }
                };
            });

            describe('when autoResolveObjectReference enabled', () => {
                let sailor;
                beforeEach(async () => {
                    settings.FUNCTION = 'data_trigger';
                    sailor = new Sailor(settings);
                    sandbox.stub(sailor, 'fetchMessageBody').callsFake(async (msg) => msg.body);

                    sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                        expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                        expect(stepId).to.deep.equal('step_1');
                        return Promise.resolve({ is_passthrough: true });
                    });

                    await sailor.connect();
                    await sailor.prepare();
                });

                describe('and all objects can be downloaded successfully', () => {
                    let runExecSpy;
                    beforeEach(async () => {
                        // Override fetchMessageBody: return body.data for known object IDs
                        sailor.fetchMessageBody.callsFake(async (msg) => {
                            const objectId = msg.headers && msg.headers[Sailor.OBJECT_ID_HEADER];
                            if (objectId === bodyObjectId) {
                                return body.data;
                            }
                            if (objectId === passthroughObjectId) {
                                return passThroughBody.data;
                            }
                            return msg.body;
                        });

                        runExecSpy = sandbox.spy(sailor, 'runExec');
                    });

                    it('should fetch message bodies and process', async () => {
                        await sailor.processMessage(metadata, lightweightPayload);
                        expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                        expect(sailor.proxyClient.connect).to.have.been.calledOnce;
                        sinon.assert.calledOnce(runExecSpy);
                        sinon.assert.calledWith(
                            runExecSpy,
                            sinon.match.object,
                            sinon.match
                                .hasNested('body', body.data)
                                .and(sinon.match.hasNested('passthrough.step_4.body', passThroughBody.data)),
                            metadata,
                            sinon.match.object,
                            sinon.match.object,
                            sinon.match.number,
                            sinon.match.object
                        );
                        expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce.and.calledWith(
                            sinon.match({
                                type: 'data',
                                data: {
                                    headers: {},
                                    body: { items: [1, 2, 3, 4, 5, 6] },
                                    passthrough: {
                                        step_1: {
                                            headers: {},
                                            body: { items: [1, 2, 3, 4, 5, 6] }
                                        },
                                        step_2: { body: { step_1: 'body' } },
                                        step_3: { body: { step_2: 'body' }, headers: {} },
                                        step_4: {
                                            headers: { [Sailor.OBJECT_ID_HEADER]: passthroughObjectId },
                                            body: passThroughBody.data
                                        }
                                    }
                                },
                                metadata: sinon.match({
                                    compId: '5559edd38968ec0736000456',
                                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                                    end: sinon.match.number,
                                    execId: 'some-exec-id',
                                    function: 'data_trigger',
                                    parentMessageId: metadata.messageId,
                                    start: sinon.match.number,
                                    stepId: 'step_1',
                                    taskId: '5559edd38968ec0736000003',
                                    threadId: metadata.threadId,
                                    userId: '5559edd38968ec0736000002',
                                    workspaceId: '5559edd38968ec073600683'
                                })
                            })
                        );

                        expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                            metadata, 'success'
                        );
                    });
                });

                describe('and one object can not be downloaded successfully', () => {
                    let runExecSpy;
                    beforeEach(async () => {
                        sailor.fetchMessageBody.callsFake(async (msg) => {
                            const objectId = msg.headers && msg.headers[Sailor.OBJECT_ID_HEADER];
                            if (objectId === bodyObjectId) {
                                return body.data;
                            }
                            if (objectId === passthroughObjectId) {
                                throw new Error(`Failed to get message body with id=${passthroughObjectId}`);
                            }
                            return msg.body;
                        });

                        runExecSpy = sandbox.spy(sailor, 'runExec');
                    });

                    it('should fetch message bodies and reject', async () => {
                        await sailor.processMessage(metadata, lightweightPayload);
                        expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                        expect(sailor.proxyClient.connect).to.have.been.calledOnce;
                        sinon.assert.notCalled(runExecSpy);

                        expect(sailor.proxyClient.sendError).to.have.been.calledOnce.and.calledWith(
                            sinon.match({
                                message: `Failed to get message body with id=${passthroughObjectId}`,
                                stack: sinon.match.string
                            }),
                            sinon.match.object,
                            lightweightPayload,
                            metadata
                        );

                        expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                            metadata, 'error'
                        );
                    });
                });
            });

            describe('when autoResolveObjectReference disabled', () => {
                let sailor;
                let runExecSpy;
                beforeEach(async () => {
                    settings.FUNCTION = 'data_trigger';
                    settings.COMPONENT_PATH = '/spec/component-auto-resolve-object-refs-false';
                    sailor = new Sailor(settings);
                    sandbox.stub(sailor, 'fetchMessageBody').callsFake(async (msg) => msg.body);

                    sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                        expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                        expect(stepId).to.deep.equal('step_1');
                        return Promise.resolve({ is_passthrough: true });
                    });

                    // Only step_4 (lightweight passthrough) gets downloaded in onData
                    sailor.fetchMessageBody.callsFake(async (msg) => {
                        const objectId = msg.headers && msg.headers[Sailor.OBJECT_ID_HEADER];
                        if (objectId === passthroughObjectId) {
                            return passThroughBody.data;
                        }
                        return msg.body;
                    });

                    runExecSpy = sandbox.spy(sailor, 'runExec');

                    await sailor.connect();
                    await sailor.prepare();
                });

                it('should not fetch message body itself but download lightweight passthrough bodies in onData', async () => {
                    await sailor.processMessage(metadata, lightweightPayload);
                    await new Promise(resolve => setTimeout(resolve, 50)); // wait for upload
                    expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                    expect(sailor.proxyClient.connect).to.have.been.calledOnce;
                    sinon.assert.calledOnce(runExecSpy);
                    sinon.assert.calledWith(
                        runExecSpy,
                        sinon.match.object,
                        lightweightPayload, // payload NOT modified (autoResolve disabled)
                        metadata,
                        sinon.match.object,
                        sinon.match.object,
                        sinon.match.number,
                        sinon.match.object
                    );
                    expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce.and.calledWith(
                        sinon.match({
                            type: 'data',
                            data: {
                                headers: {},
                                body: { items: [1, 2, 3, 4, 5, 6] },
                                passthrough: {
                                    step_1: {
                                        headers: {},
                                        body: { items: [1, 2, 3, 4, 5, 6] }
                                    },
                                    step_2: { body: { step_1: 'body' } },
                                    step_3: { body: { step_2: 'body' }, headers: {} },
                                    step_4: {
                                        headers: { [Sailor.OBJECT_ID_HEADER]: passthroughObjectId },
                                        body: passThroughBody.data
                                    }
                                }
                            },
                            metadata: sinon.match({
                                compId: '5559edd38968ec0736000456',
                                containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                                end: sinon.match.number,
                                execId: 'some-exec-id',
                                function: 'data_trigger',
                                parentMessageId: metadata.messageId,
                                start: sinon.match.number,
                                stepId: 'step_1',
                                taskId: '5559edd38968ec0736000003',
                                threadId: metadata.threadId,
                                userId: '5559edd38968ec0736000002',
                                workspaceId: '5559edd38968ec073600683'
                            })
                        })
                    );

                    expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                        metadata, 'success'
                    );
                });
            });
        });

        describe('when outgoing lightweight is enabled', () => {
            let lightweightPayload;
            let sailor;
            let passthroughObjectId;
            beforeEach(async () => {
                passthroughObjectId = 'passthrough-object-id';
                lightweightPayload = {
                    headers: {},
                    body: { some: 'body' },
                    passthrough: {
                        step_2: {
                            headers: { [Sailor.OBJECT_ID_HEADER]: passthroughObjectId },
                            body: {}
                        },
                        step_3: {
                            headers: {},
                            body: { pass: 'body' }
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
                    sandbox.stub(sailor, 'fetchMessageBody').callsFake(async (msg) => msg.body);
                    sandbox.stub(sailor, 'uploadMessageBody').resolves('uploaded-object-id');

                    sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                        expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                        expect(stepId).to.deep.equal('step_1');
                        return Promise.resolve({ is_passthrough: true });
                    });

                    // step_2 has a lightweight passthrough body (objectId header)
                    sailor.fetchMessageBody.callsFake(async (msg) => {
                        const objectId = msg.headers && msg.headers[Sailor.OBJECT_ID_HEADER];
                        if (objectId === passthroughObjectId) {
                            return { passthrough: 'body' };
                        }
                        return msg.body;
                    });

                    await sailor.connect();
                    await sailor.prepare();
                });

                describe('and all objects can be uploaded successfully', () => {
                    let bodyObjectId;
                    beforeEach(async () => {
                        bodyObjectId = 'body-object-id';
                        sailor.uploadMessageBody.resolves(bodyObjectId);
                    });

                    it('should send lightweight outgoing message', async () => {
                        await sailor.processMessage(metadata, lightweightPayload);
                        await new Promise(resolve => setTimeout(resolve, 10)); // wait for upload
                        expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                        expect(sailor.proxyClient.connect).to.have.been.calledOnce;
                        expect(sailor.uploadMessageBody).to.have.been.calledTwice;
                        expect(sailor.proxyClient.sendError).not.to.have.been.called;
                        expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce.and.calledWith(
                            sinon.match({
                                type: 'data',
                                data: {
                                    body: {},
                                    headers: { [Sailor.OBJECT_ID_HEADER]: bodyObjectId },
                                    passthrough: {
                                        ...lightweightPayload.passthrough,
                                        step_2: {
                                            body: {},
                                            headers: { [Sailor.OBJECT_ID_HEADER]: passthroughObjectId }
                                        },
                                        step_1: {
                                            headers: { [Sailor.OBJECT_ID_HEADER]: bodyObjectId },
                                            body: {}
                                        },
                                        step_3: {
                                            headers: { [Sailor.OBJECT_ID_HEADER]: bodyObjectId },
                                            body: {}
                                        }
                                    }
                                },
                                metadata: sinon.match({
                                    compId: '5559edd38968ec0736000456',
                                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                                    end: sinon.match.number,
                                    execId: 'some-exec-id',
                                    function: 'data_trigger',
                                    parentMessageId: metadata.messageId,
                                    start: sinon.match.number,
                                    stepId: 'step_1',
                                    taskId: '5559edd38968ec0736000003',
                                    threadId: metadata.threadId,
                                    userId: '5559edd38968ec0736000002',
                                    workspaceId: '5559edd38968ec073600683'
                                })
                            })
                        );

                        expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                            metadata, 'success'
                        );
                    });
                });

                describe('and objects can not be uploaded successfully', () => {
                    beforeEach(async () => {
                        sailor.uploadMessageBody.rejects(new Error('Upload failed'));
                    });

                    it('should send error and not upload lightweight', async () => {
                        await sailor.processMessage(metadata, lightweightPayload);
                        await new Promise(resolve => setTimeout(resolve, 100)); // wait for upload attempt
                        expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                        expect(sailor.proxyClient.connect).to.have.been.calledOnce;
                        expect(sailor.uploadMessageBody).to.have.been.calledTwice;
                        expect(sailor.proxyClient.sendError).to.have.been.calledOnce.and.calledWith(
                            sinon.match({
                                message: 'Lightweight message/passthrough body upload error',
                                stack: sinon.match.string
                            })
                        );
                        expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                            metadata, 'error'
                        );
                    });
                });
            });

            describe('when message is below OBJECT_STORAGE_SIZE_THRESHOLD', () => {
                beforeEach(async () => {
                    settings.OBJECT_STORAGE_SIZE_THRESHOLD = 61;
                    sailor = new Sailor(settings);
                    sandbox.stub(sailor, 'fetchMessageBody').callsFake(async (msg) => msg.body);
                    sandbox.stub(sailor, 'uploadMessageBody').resolves('uploaded-object-id');

                    sandbox.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
                        expect(taskId).to.deep.equal('5559edd38968ec0736000003');
                        expect(stepId).to.deep.equal('step_1');
                        return Promise.resolve({ is_passthrough: true });
                    });

                    sailor.fetchMessageBody.callsFake(async (msg) => {
                        const objectId = msg.headers && msg.headers[Sailor.OBJECT_ID_HEADER];
                        if (objectId === passthroughObjectId) {
                            return { passthrough: 'body' };
                        }
                        return msg.body;
                    });

                    await sailor.connect();
                    await sailor.prepare();
                });

                describe('and all objects can be uploaded successfully', () => {
                    it('should not send lightweight (body small enough)', async () => {
                        await sailor.processMessage(metadata, lightweightPayload);
                        await new Promise(resolve => setTimeout(resolve, 10)); // wait for upload
                        expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledOnce;
                        expect(sailor.proxyClient.connect).to.have.been.calledOnce;
                        expect(sailor.uploadMessageBody).not.to.have.been.called;
                        expect(sailor.proxyClient.sendError).not.to.have.been.called;
                        expect(sailor.proxyClient.sendMessage).to.have.been.calledOnce.and.calledWith(
                            sinon.match({
                                type: 'data',
                                data: sinon.match({
                                    body: { items: [1, 2, 3, 4, 5, 6] },
                                    headers: {},
                                    passthrough: sinon.match({
                                        ...lightweightPayload.passthrough,
                                        step_1: {
                                            body: { items: [1, 2, 3, 4, 5, 6] },
                                            headers: {}
                                        }
                                    })
                                }),
                                metadata: sinon.match({
                                    compId: '5559edd38968ec0736000456',
                                    containerId: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
                                    end: sinon.match.number,
                                    execId: 'some-exec-id',
                                    function: 'data_trigger',
                                    parentMessageId: metadata.messageId,
                                    start: sinon.match.number,
                                    stepId: 'step_1',
                                    taskId: '5559edd38968ec0736000003',
                                    threadId: metadata.threadId,
                                    userId: '5559edd38968ec0736000002',
                                    workspaceId: '5559edd38968ec073600683'
                                })
                            })
                        );

                        expect(sailor.proxyClient.finishProcessing).to.have.been.calledOnce.and.calledWith(
                            metadata, 'success'
                        );
                    });
                });
            });
        });
    });
});
