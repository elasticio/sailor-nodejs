'use strict';

describe('Sailor', () => {
    const envVars = {};

    envVars.ELASTICIO_AMQP_URI = 'amqp://test2/test2';
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

    envVars.ELASTICIO_TIMEOUT = 3000;

    const amqp = require('../lib/amqp.js');
    let settings;
    const Sailor = require('../lib/sailor.js').Sailor;

    beforeEach(() => {
        settings = require('../lib/settings').readFrom(envVars);
    });

    describe('runHookInit', () => {
        it('should runHookInit properly if developer returned a plain string in init', done => {
            settings.FUNCTION = 'init_trigger_returns_string';

            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').andCallFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({
                    config: {
                        _account: '1234567890'
                    }
                });
            });

            sailor.prepare()
                .then(() => sailor.runHookInit({}))
                .then((result) => {
                    expect(result).toEqual('this_is_a_string');
                    done();
                })
                .catch(done);
        });

        it('should runHookInit properly if developer returned a promise', done => {
            settings.FUNCTION = 'init_trigger';

            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').andCallFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({
                    config: {
                        _account: '1234567890'
                    }
                });
            });

            sailor.prepare()
                .then(() => sailor.runHookInit({}))
                .then((result) => {
                    expect(result).toEqual({
                        subscriptionId: '_subscription_123'
                    });
                    done();
                })
                .catch(done);
        });
    });

    describe('prepare', () => {
        let sailor;

        beforeEach(() => {
            sailor = new Sailor(settings);
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
                    spyOn(sailor.componentReader, 'init').andReturn(Promise.resolve());
                    spyOn(sailor.apiClient.tasks, 'retrieveStep').andReturn(Promise.resolve(stepData));
                });

                it('should init component', done => {
                    sailor.prepare()
                        .then(() => {
                            expect(sailor.stepData).toEqual(stepData);
                            expect(sailor.snapshot).toEqual(stepData.snapshot);
                            expect(sailor.apiClient.tasks.retrieveStep)
                                .toHaveBeenCalledWith(settings.FLOW_ID, settings.STEP_ID);
                            expect(sailor.componentReader.init).toHaveBeenCalledWith(settings.COMPONENT_PATH);
                            done();
                        })
                        .catch(done);
                });
            });
        });

        describe('when step data is not retrieved', () => {
            beforeEach(() => {
                spyOn(sailor.apiClient.tasks, 'retrieveStep')
                    .andReturn(Promise.reject(new Error('failed')));
            });

            it('should fail', done => {
                sailor.prepare()
                    .then(() => {
                        throw new Error('Error is expected');
                    })
                    .catch(err => {
                        expect(err.message).toEqual('failed');
                        done();
                    });
            });
        });
    });

    describe('disconnection', () => {
        it('should disconnect Mongo and RabbitMQ, and exit process', done => {
            const fakeAMQPConnection = jasmine.createSpyObj('AMQPConnection', ['disconnect']);
            fakeAMQPConnection.disconnect.andReturn(Promise.resolve());

            spyOn(amqp, 'Amqp').andReturn(fakeAMQPConnection);
            spyOn(process, 'exit').andReturn(0);

            const sailor = new Sailor(settings);

            sailor.disconnect()
                .then(() => {
                    expect(fakeAMQPConnection.disconnect).toHaveBeenCalled();
                    done();
                })
                .catch(done);
        });
    });

});
