const { expect } = require('chai');
const nock = require('nock');
const service = require('../lib/service');

describe('Service', () => {
  describe('execService', () => {
    beforeEach(() => {
      process.env.ELASTICIO_API_URI = 'http://apihost.com';
    });

    afterEach(() => {
      delete process.env.ELASTICIO_API_URI;
    });

    function makeEnv(env) {
      const newEnv = { ...env };
      newEnv.ELASTICIO_CFG = env.ELASTICIO_CFG || '{}';
      newEnv.ELASTICIO_COMPONENT_PATH = env.ELASTICIO_COMPONENT_PATH || '/spec/component';
      newEnv.ELASTICIO_POST_RESULT_URL = env.ELASTICIO_POST_RESULT_URL || 'http://test.com/123/456';
      newEnv.ELASTICIO_API_URI = 'http://apihost.com';
      newEnv.ELASTICIO_API_USERNAME = 'test@test.com';
      newEnv.ELASTICIO_API_KEY = '5559edd';
      return newEnv;
    }

    describe('error cases', () => {
      beforeEach(() => {
        nock('http://test.com:80')
          .post('/123/456')
          .reply(200, 'OK');
      });

      it('should fail if no ELASTICIO_POST_RESULT_URL provided', async () => {
        service.processService('verifyCredentials', {})
          .catch((err) => {
            expect(err.message).to.be.equal('ELASTICIO_POST_RESULT_URL is not provided');
          });
      });

      it('should throw an error when there is no such service method', async () => {
        const result = await service.processService('unknownMethod', makeEnv({}));
        expect(result.status).to.be.equal('error');
        expect(result.data.message).to.be.equal('Unknown service method "unknownMethod"');
      });

      it('should send error response if no ELASTICIO_CFG provided', async () => {
        const result = await service.processService('verifyCredentials', { ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456' });
        expect(result.status).to.be.equal('error');
        expect(result.data.message).to.be.equal('ELASTICIO_CFG is not provided');
      });

      it('should send error response if failed to parse ELASTICIO_CFG', async () => {
        const result = await service.processService('verifyCredentials', makeEnv({
          ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456',
          ELASTICIO_CFG: 'test',

        }));
        expect(result.status).to.be.equal('error');
        expect(result.data.message).to.be.equal('Unable to parse CFG');
      });

      it('should send error response if component is not found', async () => {
        const result = await service.processService('verifyCredentials', {
          ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456',
          ELASTICIO_CFG: '{"param1":"param2"}',
          ELASTICIO_API_URI: 'http://example.com',
          ELASTICIO_API_USERNAME: 'admin',
          ELASTICIO_API_KEY: 'key',
        });

        expect(result.status).to.be.equal('error');
        expect(result.data.message).to.include('Failed to load component.json');
      });

      it('should throw an error when ELASTICIO_ACTION_OR_TRIGGER is not provided', async () => {
        const result = await service.processService('getMetaModel', makeEnv({}));
        expect(result.status).to.be.equal('error');
        expect(result.data.message).to.be.equal('ELASTICIO_ACTION_OR_TRIGGER is not provided');
      });

      it('should throw an error when ELASTICIO_ACTION_OR_TRIGGER is not found', async () => {
        const result = await service.processService('getMetaModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'unknown' }));
        expect(result.status).to.be.equal('error');
        expect(result.data.message).to.be.equal('Trigger or action "unknown" is not found in component.json!');
      });

      it('should throw an error when ELASTICIO_GET_MODEL_METHOD is not provided', async () => {
        const result = await service.processService('selectModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update' }));
        expect(result.status).to.be.equal('error');
        expect(result.data.message).to.be.equal('ELASTICIO_GET_MODEL_METHOD is not provided');
      });

      it('should throw an error when ELASTICIO_GET_MODEL_METHOD is not found', async () => {
        const result = await service.processService('selectModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update', ELASTICIO_GET_MODEL_METHOD: 'unknown' }));
        expect(result.status).to.be.equal('error');
        expect(result.data.message).to.be.equal('Method "unknown" is not found in "update" action or trigger');
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
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({ verified: true });
        });

        it('should verify successfully when callback verified', async () => {
          // eslint-disable-next-line max-len
          const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component2' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({ verified: true });
        });

        it('should NOT verify successfully when callback did not verify', async () => {
          // eslint-disable-next-line max-len
          const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component3' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({ verified: false });
        });

        it('should verify successfully when promise resolves', async () => {
          // eslint-disable-next-line max-len
          const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component4' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({ verified: true });
        });

        it('should NOT verify successfully when promise rejects', async () => {
          // eslint-disable-next-line max-len
          const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component5' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            verified: false,
            reason: 'Your API key is invalid',
          });
        });

        it('should NOT verify successfully when error thrown synchronously', async () => {
          // eslint-disable-next-line max-len
          const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component6' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            verified: false,
            reason: 'Ouch. This occurred during verification.',
          });
        });

        it('should verify successfully for an async verifyCredentials', async () => {
          const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component7' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            verified: true,
          });
        });

        it('should fail verification successfully for an async verifyCredentials', async () => {
          const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component8' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            reason: 'Verification failed :(',
            verified: false,
          });
        });

        it('should fail verification successfully for async with a return (no cb)', async () => {
          const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component9' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            reason: 'This is an error',
            verified: false,
          });
        });

        it('should succeed correct verification with callback and return', async () => {
          const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component10' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            verified: true,
          });
        });

        it('should emit from verifyCredentials', async () => {
          const result = await service.processService('verifyCredentials', makeEnv({ ELASTICIO_COMPONENT_PATH: '/spec/component11' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            reason: 'Error emitted!!',
            verified: false,
          });
        });
      });

      describe('getMetaModel', () => {
        it('should return callback based model successfully', async () => {
          const result = await service.processService('getMetaModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            in: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  title: 'Name',
                },
              },
            },
          });
        });
        it('should return promise based model successfully', async () => {
          const result = await service.processService('getMetaModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update1' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            in: {
              type: 'object',
              properties: {
                email: {
                  type: 'string',
                  title: 'E-Mail',
                },
              },
            },
          });
        });
        it('should return error when promise rejects', async () => {
          const result = await service.processService('getMetaModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update2' }));
          expect(result.status).to.be.equal('error');
          expect(result.data).to.be.deep.equal({
            message: 'Today no metamodels. Sorry!',
          });
        });
      });

      describe('selectModel', () => {
        it('selectModel', async () => {
          // eslint-disable-next-line max-len
          const result = await service.processService('selectModel', makeEnv({ ELASTICIO_ACTION_OR_TRIGGER: 'update', ELASTICIO_GET_MODEL_METHOD: 'getModel' }));
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            de: 'Germany',
            us: 'USA',
            ua: 'Ukraine',
          });
        });

        it('selectModel with updateKeys event', async () => {
          const env = makeEnv({
            ELASTICIO_ACTION_OR_TRIGGER: 'update',
            ELASTICIO_GET_MODEL_METHOD: 'getModelWithKeysUpdate',
            ELASTICIO_CFG: '{"_account":"1234567890"}',
            ELASTICIO_API_URI: 'http://apihost.com',
            ELASTICIO_API_USERNAME: 'test@test.com',
            ELASTICIO_API_KEY: '5559edd',
          });

          const nockScope = nock('http://apihost.com:80')
            .matchHeader('Connection', 'Keep-Alive')
            .put('/v1/accounts/1234567890', { keys: { oauth: { access_token: 'newAccessToken' } } })
            .reply(200, 'Success');

          const result = await service.processService('selectModel', env);
          expect(nockScope.isDone()).to.be.equal(true);
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            0: 'Mr',
            1: 'Mrs',
          });
        });

        it('selectModel with failed updateKeys event should return result anyway', async () => {
          const env = makeEnv({
            ELASTICIO_ACTION_OR_TRIGGER: 'update',
            ELASTICIO_GET_MODEL_METHOD: 'getModelWithKeysUpdate',
            ELASTICIO_CFG: '{"_account":"1234567890"}',
            ELASTICIO_API_URI: 'http://apihost.com',
            ELASTICIO_API_USERNAME: 'test@test.com',
            ELASTICIO_API_KEY: '5559edd',
          });

          const nockScope = nock('http://apihost.com:80')
            .matchHeader('Connection', 'Keep-Alive')
            .put('/v1/accounts/1234567890', { keys: { oauth: { access_token: 'newAccessToken' } } })
            .reply(400, 'Success');

          const result = await service.processService('selectModel', env);
          expect(nockScope.isDone()).to.be.equal(true);
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            0: 'Mr',
            1: 'Mrs',
          });
        });

        it('selectModel returns a promise that resolves successfully', async () => {
          const env = makeEnv({
            ELASTICIO_ACTION_OR_TRIGGER: 'update',
            ELASTICIO_GET_MODEL_METHOD: 'promiseSelectModel',
            ELASTICIO_CFG: '{"_account":"1234567890"}',
            ELASTICIO_API_URI: 'http://apihost.com',
            ELASTICIO_API_USERNAME: 'test@test.com',
            ELASTICIO_API_KEY: '5559edd',
          });

          const result = await service.processService('selectModel', env);
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            de: 'de_DE',
            at: 'de_AT',
          });
        });

        it('selectModel returns a promise that sends a request', async () => {
          const env = makeEnv({
            ELASTICIO_ACTION_OR_TRIGGER: 'update',
            ELASTICIO_GET_MODEL_METHOD: 'promiseRequestSelectModel',
            ELASTICIO_CFG: '{"_account":"1234567890"}',
            ELASTICIO_API_URI: 'http://apihost.com',
            ELASTICIO_API_USERNAME: 'test@test.com',
            ELASTICIO_API_KEY: '5559edd',
          });

          const nockScope = nock('http://promise_target_url:80')
            .get('/selectmodel')
            .reply(200, {
              a: 'x',
              b: 'y',
            });

          const result = await service.processService('selectModel', env);


          expect(nockScope.isDone()).to.be.equal(true);
          expect(result.status).to.be.equal('success');
          expect(result.data).to.be.deep.equal({
            a: 'x',
            b: 'y',
          });
        });

        it('selectModel returns a promise that rejects', async () => {
          const env = makeEnv({
            ELASTICIO_ACTION_OR_TRIGGER: 'update',
            ELASTICIO_GET_MODEL_METHOD: 'promiseSelectModelRejected',
            ELASTICIO_CFG: '{"_account":"1234567890"}',
            ELASTICIO_API_URI: 'http://apihost.com',
            ELASTICIO_API_USERNAME: 'test@test.com',
            ELASTICIO_API_KEY: '5559edd',
          });

          const result = await service.processService('selectModel', env);


          expect(result.status).to.be.equal('error');
          expect(result.data.message).to.be.equal('Ouch. This promise is rejected');
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
        service.processService('verifyCredentials', makeEnv({ ELASTICIO_POST_RESULT_URL: 'http://test.com/111/222' }))
          .catch((err) => {
            expect(err.message).to.be.equal('Failed to POST data to http://test.com/111/222 (404, Page not found)');
          });
      });
    });
  });
});
