const chai = require('chai');
const { expect } = chai;
const nock = require('nock');

const service = require('../../lib/service');
describe('Service', () => {
    describe('execService', () => {
        let oldEnv;
        beforeEach(() => {
            oldEnv = process.env;
        });

        afterEach(() => {
            process.env = oldEnv;
        });

        function makeEnv(env) {
            return Object.assign({
                ELASTICIO_API_URI: 'http://apihost.com',
                ELASTICIO_CFG: '{}',
                ELASTICIO_COMPONENT_PATH: '/spec/component',
                ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456',
                ELASTICIO_API_USERNAME: 'test@test.com',
                ELASTICIO_API_KEY: '5559edd',
                ELASTICIO_ACTION_OR_TRIGGER: 'do_smth',
                ELASTICIO_GET_MODEL_METHOD: 'really get smth'
            }, env);
        }

        describe('error cases', () => {
            beforeEach(() => {
                nock('http://test.com:80')
                    .post('/123/456')
                    .reply(200, 'OK');
            });

            it('should fail if no ELASTICIO_POST_RESULT_URL provided', async () => {
                let caughtError;
                try {
                    await service.processService('verifyCredentials', {});
                } catch (e) {
                    caughtError = e;
                }
                expect(caughtError).to.be.instanceof(Error);
                expect(caughtError.message).to.equal('ELASTICIO_POST_RESULT_URL is missing');
            });

            it('should throw an error when there is no such service method', async () => {
                process.env = makeEnv({});
                const result = await service.processService('unknownMethod');
                expect(result.status).to.equal('error');
                expect(result.data.message).to.equal('Unknown service method "unknownMethod"');
            });

            it('should send error response if no ELASTICIO_CFG provided', async () => {
                process.env = makeEnv({ ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456' });
                delete process.env.ELASTICIO_CFG;
                let caughtError;
                try {
                    await service.processService('verifyCredentials');
                } catch (e) {
                    caughtError = e;
                }
                expect(caughtError).to.be.instanceof(Error);
                expect(caughtError.message).to.equal('ELASTICIO_CFG is missing');
            });

            it('should send error response if failed to parse ELASTICIO_CFG', async () => {
                process.env = makeEnv({
                    ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456',
                    ELASTICIO_CFG: 'test'

                });
                const result = await service.processService('verifyCredentials');
                expect(result.status).to.equal('error');
                expect(result.data.message).to.equal('Unable to parse CFG');
            });

            it('should send error response if component is not found', async () => {
                process.env = makeEnv({
                    ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456',
                    ELASTICIO_CFG: '{"param1":"param2"}',
                    ELASTICIO_API_URI: 'http://example.com',
                    ELASTICIO_API_USERNAME: 'admin',
                    ELASTICIO_API_KEY: 'key'
                });
                delete process.env.ELASTICIO_COMPONENT_PATH;
                const result = await service.processService('verifyCredentials');
                expect(result.status).to.equal('error');
                expect(result.data.message).to.include('Failed to load component.json');
            });

            it('should throw an error when ELASTICIO_ACTION_OR_TRIGGER is not provided', async () => {
                process.env = makeEnv({});
                delete process.env.ELASTICIO_ACTION_OR_TRIGGER;
                let caughtError;
                try {
                    await service.processService('getMetaModel');
                } catch (e) {
                    caughtError = e;
                }
                expect(caughtError).to.be.instanceof(Error);
                expect(caughtError.message).to.equal('ELASTICIO_ACTION_OR_TRIGGER is missing');
            });

            it('should throw an error when ELASTICIO_ACTION_OR_TRIGGER is not found', async () => {
                process.env = makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'unknown' });
                const result = await service.processService('getMetaModel');
                expect(result.status).to.equal('error');
                expect(result.data.message).to.equal('Trigger or action "unknown" is not found in component.json!');
            });

            it('should throw an error when ELASTICIO_GET_MODEL_METHOD is not provided', async () => {
                process.env = makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update' });
                delete process.env.ELASTICIO_ACTION_OR_TRIGGER;
                let caughtError;
                try {
                    await service.processService('selectModel');
                } catch (e) {
                    caughtError = e;
                }
                expect(caughtError).to.be.instanceof(Error);
                expect(caughtError.message).to.equal('ELASTICIO_ACTION_OR_TRIGGER is missing');
            });

            it('should throw an error when ELASTICIO_GET_MODEL_METHOD is not found', async () => {
                process.env = makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update', ELASTICIO_GET_MODEL_METHOD: 'unknown' });
                const result = await service.processService('selectModel');
                expect(result.status).to.equal('error');
                expect(result.data.message).to.equal('Method "unknown" is not found in "update" action or trigger');
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
                    process.env = makeEnv({});
                    const result = await service.processService('verifyCredentials');
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({ verified: true });
                });

                it('should verify successfully when callback verified', async () => {
                    process.env = makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component2' });
                    const result = await service.processService('verifyCredentials');
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({ verified: true });
                });

                it('should NOT verify successfully when callback did not verify', async () => {
                    process.env = makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component3' });
                    const result = await service.processService('verifyCredentials');
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({ verified: false });
                });

                it('should verify successfully when promise resolves', async () => {
                    process.env = makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component4' });
                    const result = await service.processService('verifyCredentials');
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({ verified: true });
                });

                it('should NOT verify successfully when promise rejects', async () => {
                    process.env = makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component5' });
                    const result = await service.processService('verifyCredentials');
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({
                        verified: false,
                        reason: 'Your API key is invalid'
                    });
                });

                it('should NOT verify successfully when error thrown synchronously', async () => {
                    process.env = makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component6' });
                    const result = await service.processService('verifyCredentials');
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({
                        verified: false,
                        reason: 'Ouch. This occurred during verification.'
                    });
                });
            });

            describe('getMetaModel', () => {
                it('should return callback based model successfully', async () => {
                    process.env = makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update' });
                    const result = await service.processService('getMetaModel');
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({
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
                    process.env = makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update1' });
                    const result = await service.processService('getMetaModel');
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({
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
                    process.env = makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update2' });
                    const result = await service.processService('getMetaModel');
                    expect(result.status).to.equal('error');
                    expect(result.data).to.deep.equal({
                        message: 'Today no metamodels. Sorry!'
                    });
                });
            });

            describe('selectModel', () => {
                it('selectModel', async () => {
                    process.env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'getModel'
                    });
                    const result = await service.processService('selectModel');
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({
                        de: 'Germany',
                        us: 'USA',
                        ua: 'Ukraine'
                    });
                });

                it('selectModel with updateKeys event', async () => {
                    process.env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'getModelWithKeysUpdate',
                        ELASTICIO_CFG: '{"_account":"1234567890"}',
                        ELASTICIO_API_URI: 'http://apihost.com',
                        ELASTICIO_API_USERNAME: 'test@test.com',
                        ELASTICIO_API_KEY: '5559edd'
                    });

                    const nockScope = nock('http://apihost.com:80')
                        .matchHeader('Connection', 'Keep-Alive')
                        .put('/v1/accounts/1234567890', { keys: { oauth: { access_token: 'newAccessToken' } } })
                        .reply(200, 'Success');

                    const result = await service.processService('selectModel');
                    expect(nockScope.isDone()).to.equal(true);
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({
                        0: 'Mr',
                        1: 'Mrs'
                    });
                });

                it('selectModel with failed updateKeys event should return result anyway', async () => {
                    process.env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'getModelWithKeysUpdate',
                        ELASTICIO_CFG: '{"_account":"1234567890"}',
                        ELASTICIO_API_URI: 'http://apihost.com',
                        ELASTICIO_API_USERNAME: 'test@test.com',
                        ELASTICIO_API_KEY: '5559edd'
                    });

                    const nockScope = nock('http://apihost.com:80')
                        .matchHeader('Connection', 'Keep-Alive')
                        .put('/v1/accounts/1234567890', { keys: { oauth: { access_token: 'newAccessToken' } } })
                        .reply(400, 'Success');

                    const result = await service.processService('selectModel');
                    expect(nockScope.isDone()).to.equal(true);
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({
                        0: 'Mr',
                        1: 'Mrs'
                    });
                });

                it('selectModel returns a promise that resolves successfully', async () => {
                    process.env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'promiseSelectModel',
                        ELASTICIO_CFG: '{"_account":"1234567890"}',
                        ELASTICIO_API_URI: 'http://apihost.com',
                        ELASTICIO_API_USERNAME: 'test@test.com',
                        ELASTICIO_API_KEY: '5559edd'
                    });

                    const result = await service.processService('selectModel');

                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({
                        de: 'de_DE',
                        at: 'de_AT'
                    });
                });

                it('selectModel returns a promise that sends a request', async () => {
                    process.env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'promiseRequestSelectModel',
                        ELASTICIO_CFG: '{"_account":"1234567890"}',
                        ELASTICIO_API_URI: 'http://apihost.com',
                        ELASTICIO_API_USERNAME: 'test@test.com',
                        ELASTICIO_API_KEY: '5559edd'
                    });

                    const nockScope = nock('http://promise_target_url:80')
                        .get('/selectmodel')
                        .reply(200, {
                            a: 'x',
                            b: 'y'
                        });

                    const result = await service.processService('selectModel');
                    expect(nockScope.isDone()).to.equal(true);
                    expect(result.status).to.equal('success');
                    expect(result.data).to.deep.equal({
                        a: 'x',
                        b: 'y'
                    });
                });

                it('selectModel returns a promise that rejects', async () => {
                    process.env = makeEnv({
                        ELASTICIO_ACTION_OR_TRIGGER: 'update',
                        ELASTICIO_GET_MODEL_METHOD: 'promiseSelectModelRejected',
                        ELASTICIO_CFG: '{"_account":"1234567890"}',
                        ELASTICIO_API_URI: 'http://apihost.com',
                        ELASTICIO_API_USERNAME: 'test@test.com',
                        ELASTICIO_API_KEY: '5559edd'
                    });

                    const result = await service.processService('selectModel');
                    expect(result.status).to.equal('error');
                    expect(result.data.message).to.equal('Ouch. This promise is rejected');
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
                process.env = makeEnv({ ELASTICIO_POST_RESULT_URL: 'http://test.com/111/222' });
                let caughtError;
                try {
                    await service.processService('verifyCredentials');
                } catch (e) {
                    caughtError = e;
                }
                expect(caughtError).to.be.instanceof(Error);
                expect(caughtError.message)
                    .to.equal('Failed to POST data to http://test.com/111/222 (404, Page not found)');
            });
        });
    });
});
