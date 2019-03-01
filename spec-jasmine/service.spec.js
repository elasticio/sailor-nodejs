const service = require('../src/service');
const nock = require('nock');

describe('Service', () => {
    describe('execService', () => {
        beforeEach(() => {
            process.env.ELASTICIO_API_URI = 'http://apihost.com';
        });

        afterEach(() => {
            delete process.env.ELASTICIO_API_URI;
        });

        function makeEnv (env) {
            env.ELASTICIO_CFG = env.ELASTICIO_CFG || '{}';
            env.ELASTICIO_COMPONENT_PATH = env.ELASTICIO_COMPONENT_PATH || '/spec-jasmine/component';
            env.ELASTICIO_POST_RESULT_URL = env.ELASTICIO_POST_RESULT_URL || 'http://test.com/123/456';
            env.ELASTICIO_API_URI = 'http://apihost.com';
            env.ELASTICIO_API_USERNAME = 'test@test.com';
            env.ELASTICIO_API_KEY = '5559edd';
            return env;
        }

        describe('error cases', () => {
            beforeEach(() => {
                nock('http://test.com:80')
                    .post('/123/456')
                    .reply(200, 'OK');
            });

            it('should fail if no ELASTICIO_POST_RESULT_URL provided', async () => {
                try {
                    await service.processService('verifyCredentials', {});
                } catch (err) {
                    expect(err.message).toEqual('ELASTICIO_POST_RESULT_URL is not provided');
                }
            });

            it('should throw an error when there is no such service method', async () => {
                const result = await service.processService('unknownMethod', makeEnv({}));
                expect(result.status).toEqual('error');
                expect(result.data.message).toEqual('Unknown service method "unknownMethod"');
            });

            it('should send error response if no ELASTICIO_CFG provided', async () => {
                const result = await service.processService('verifyCredentials', { ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456' });
                expect(result.status).toEqual('error');
                expect(result.data.message).toEqual('ELASTICIO_CFG is not provided');
            });

            it('should send error response if failed to parse ELASTICIO_CFG', async () => {
                const result = await service.processService('verifyCredentials', makeEnv({
                    ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456',
                    ELASTICIO_CFG: 'test'
                }));

                expect(result.status).toEqual('error');
                expect(result.data.message).toEqual('Unable to parse CFG');
            });

            it('should send error response if component is not found', async () => {
                const result = await service.processService('verifyCredentials', {
                    ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456',
                    ELASTICIO_CFG: '{"param1":"param2"}',
                    ELASTICIO_API_URI: 'http://example.com',
                    ELASTICIO_API_USERNAME: 'admin',
                    ELASTICIO_API_KEY: 'key'
                });

                expect(result.status).toEqual('error');
                expect(result.data.message).toMatch('Failed to load component.json');
            });

            it('should throw an error when ELASTICIO_ACTION_OR_TRIGGER is not provided', async () => {
                const result = await service.processService('getMetaModel', makeEnv({}));
                expect(result.status).toEqual('error');
                expect(result.data.message).toEqual('ELASTICIO_ACTION_OR_TRIGGER is not provided');
            });

            it('should throw an error when ELASTICIO_ACTION_OR_TRIGGER is not found', async () => {
                const result = await service.processService('getMetaModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'unknown' }));
                expect(result.status).toEqual('error');
                expect(result.data.message).toEqual('Trigger or action "unknown" is not found in component.json!');
            });

            it('should throw an error when ELASTICIO_GET_MODEL_METHOD is not provided', async () => {
                const result = await service.processService('selectModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update' }));
                expect(result.status).toEqual('error');
                expect(result.data.message).toEqual('ELASTICIO_GET_MODEL_METHOD is not provided');
            });

            it('should throw an error when ELASTICIO_GET_MODEL_METHOD is not found', async () => {
                const result = await service.processService('selectModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update', ELASTICIO_GET_MODEL_METHOD: 'unknown' }));
                expect(result.status).toEqual('error');
                expect(result.data.message).toEqual('Method "unknown" is not found in "update" action or trigger');
            });
        });

        describe('success cases', () => {
            beforeEach(() => {
                nock('http://test.com:80')
                    .post('/123/456')
                    .reply(200, 'OK');
            });

            describe('verifyCredentials', () => {
                it('should verify successfully when verifyCredentials.js is not available', async () => {
                    const result = await service.processService('verifyCredentials', makeEnv({}));
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({ verified: true });
                });

                it('should verify successfully when callback verified', async () => {
                    const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec-jasmine/component2' }));
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({ verified: true });
                });

                it('should NOT verify successfully when callback did not verify', async () => {
                    const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec-jasmine/component3' }));
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({ verified: false });
                });

                it('should verify successfully when promise resolves', async () => {
                    const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec-jasmine/component4' }));
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({ verified: true });
                });

                it('should NOT verify successfully when promise rejects', async () => {
                    const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec-jasmine/component5' }));
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({
                        verified: false,
                        reason: 'Your API key is invalid'
                    });
                });

                it('should NOT verify successfully when error thrown synchronously', async () => {
                    const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec-jasmine/component6' }));
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({
                        verified: false,
                        reason: 'Ouch. This occurred during verification.'
                    });
                });
            });

            describe('getMetaModel', () => {
                it('should return callback based model successfully', async () => {
                    const result = await service.processService('getMetaModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update' }));
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({
                        in: {
                            type: 'object',
                            properties: {
                                name: {
                                    type: 'string',
                                    title: 'Name'
                                }
                            }
                        }
                    });
                });

                it('should return promise based model successfully', async () => {
                    const result = await service.processService('getMetaModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update1' }));
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({
                        in: {
                            type: 'object',
                            properties: {
                                email: {
                                    type: 'string',
                                    title: 'E-Mail'
                                }
                            }
                        }
                    });
                });

                it('should return error when promise rejects', async () => {
                    const result = await service.processService('getMetaModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update2' }));
                    expect(result.status).toEqual('error');
                    expect(result.data).toEqual({ message: 'Today no metamodels. Sorry!' });
                });
            });

            describe('selectModel', () => {
                it('selectModel', async () => {
                    const result = await service.processService('selectModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update', ELASTICIO_GET_MODEL_METHOD: 'getModel' }));
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({
                        de: 'Germany',
                        us: 'USA',
                        ua: 'Ukraine'
                    });
                });

                it('selectModel with updateKeys event', async () => {
                    const env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'getModelWithKeysUpdate',
                        ELASTICIO_CFG: '{"_account":"1234567890"}',
                        ELASTICIO_API_URI: 'http://apihost.com',
                        ELASTICIO_API_USERNAME: 'test@test.com',
                        ELASTICIO_API_KEY: '5559edd'
                    });

                    const nockScope = nock('http://apihost.com:80')
                        .put('/v1/accounts/1234567890', { keys: { oauth: { access_token: 'newAccessToken' } } })
                        .reply(200, 'Success');

                    const result = await service.processService('selectModel', env);
                    expect(nockScope.isDone()).toEqual(true);
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({ 0: 'Mr', 1: 'Mrs' });
                });

                it('selectModel with failed updateKeys event should return result anyway', async () => {
                    const env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'getModelWithKeysUpdate',
                        ELASTICIO_CFG: '{"_account":"1234567890"}',
                        ELASTICIO_API_URI: 'http://apihost.com',
                        ELASTICIO_API_USERNAME: 'test@test.com',
                        ELASTICIO_API_KEY: '5559edd'
                    });

                    const nockScope = nock('http://apihost.com:80')
                        .put('/v1/accounts/1234567890', { keys: { oauth: { access_token: 'newAccessToken' } } })
                        .reply(400, 'Success');

                    const result = await service.processService('selectModel', env);
                    expect(nockScope.isDone()).toEqual(true);
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({
                        0: 'Mr',
                        1: 'Mrs'
                    });
                });

                it('selectModel returns a promise that resolves successfully', async () => {
                    const env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'promiseSelectModel',
                        ELASTICIO_CFG: '{"_account":"1234567890"}',
                        ELASTICIO_API_URI: 'http://apihost.com',
                        ELASTICIO_API_USERNAME: 'test@test.com',
                        ELASTICIO_API_KEY: '5559edd'
                    });

                    const result = await service.processService('selectModel', env);
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({ de: 'de_DE', at: 'de_AT' });
                });

                it('selectModel returns a promise that sends a request', async () => {
                    const env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'promiseRequestSelectModel',
                        ELASTICIO_CFG: '{"_account":"1234567890"}',
                        ELASTICIO_API_URI: 'http://apihost.com',
                        ELASTICIO_API_USERNAME: 'test@test.com',
                        ELASTICIO_API_KEY: '5559edd'
                    });

                    const nockScope = nock('http://promise_target_url:80')
                        .get('/selectmodel')
                        .reply(200, { a: 'x', b: 'y' });

                    const result = await service.processService('selectModel', env);
                    expect(nockScope.isDone()).toEqual(true);
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({ a: 'x', b: 'y' });
                });

                it('selectModel returns a promise that rejects', async () => {
                    const env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'promiseSelectModelRejected',
                        ELASTICIO_CFG: '{"_account":"1234567890"}',
                        ELASTICIO_API_URI: 'http://apihost.com',
                        ELASTICIO_API_USERNAME: 'test@test.com',
                        ELASTICIO_API_KEY: '5559edd'
                    });

                    const result = await service.processService('selectModel', env);
                    expect(result.status).toEqual('error');
                    expect(result.data.message).toEqual('Ouch. This promise is rejected');
                });
            });
        });

        describe('sending error', () => {
            beforeEach(() => {
                nock('http://test.com:80')
                    .post('/111/222')
                    .reply(404, 'Page not found');
            });

            it('verifyCredentials', async () => {
                try {
                    await service.processService('verifyCredentials', makeEnv({ ELASTICIO_POST_RESULT_URL: 'http://test.com/111/222' }));
                } catch (err) {
                    expect(err.message).toEqual('Failed to POST data to http://test.com/111/222 (404, Page not found)');
                }
            });
        });
    });
});
