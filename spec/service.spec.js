process.env.COMPONENT_PATH = '/spec/component';
describe('Service', function(){
    var request = require('request');
    var service = require('../lib/service');
    var env = require('../lib/settings.js');
    var nock = require('nock');

    describe('execService', function(){

        function prepareEnv(envVars) {
            envVars.CFG = envVars.CFG || '{}';
            envVars.COMPONENT_PATH = '/spec/component';
            envVars.POST_RESULT_URL = envVars.POST_RESULT_URL || 'http://test.com/123/456';
            envVars.API_URI = 'http://apihost.com';
            envVars.API_USERNAME = 'test@test.com';
            envVars.API_KEY = '5559edd';
            env.init(envVars);
        }

        describe('error cases', function(){

            beforeEach(function(){
                nock('http://test.com:80')
                    .post('/123/456')
                    .reply(200, "OK");
            });

            it('should fail if no POST_RESULT_URL provided', function(done){

                env.init({});

                service.processService('verifyCredentials')
                    .catch(checkError)
                    .done();

                function checkError(err){
                    expect(err.message).toEqual('POST_RESULT_URL is not provided');
                    done();
                }
            });

            it('should throw an error when there is no such service method', function(done){

                prepareEnv({});

                service.processService('unknownMethod')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('error');
                    expect(result.data.message).toEqual('Unknown service method "unknownMethod"');
                    done();
                }
            });

            it('should send error response if no CFG provided', function(done){

                env.init({'POST_RESULT_URL':'http://test.com/123/456'});

                service.processService('verifyCredentials')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('error');
                    expect(result.data.message).toEqual('CFG is not provided');
                    done();
                }
            });

            it('should send error response if failed to parse CFG', function(done){

                env.init({'POST_RESULT_URL':'http://test.com/123/456', CFG: 'test'});

                service.processService('verifyCredentials')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('error');
                    expect(result.data.message).toEqual('Unable to parse CFG');
                    done();
                }
            });

            it('should send error response if component is not found', function(done){

                env.init({'POST_RESULT_URL':'http://test.com/123/456', CFG: '{"param1":"param2"}'});

                service.processService('verifyCredentials')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('error');
                    expect(result.data.message).toMatch('Failed to load component.json');
                    done();
                }
            });

            it('should throw an error when ACTION_OR_TRIGGER is not provided', function(done){

                prepareEnv({});

                service.processService('getMetaModel')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('error');
                    expect(result.data.message).toEqual('ACTION_OR_TRIGGER is not provided');
                    done();
                }
            });

            it('should throw an error when ACTION_OR_TRIGGER is not found', function(done){

                prepareEnv({ACTION_OR_TRIGGER: 'unknown'});

                service.processService('getMetaModel')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('error');
                    expect(result.data.message).toEqual('Trigger or action "unknown" is not found in component.json!');
                    done();
                }
            });

            it('should throw an error when GET_MODEL_METHOD is not provided', function(done){

                prepareEnv({ACTION_OR_TRIGGER: 'update'});

                service.processService('selectModel')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('error');
                    expect(result.data.message).toEqual('GET_MODEL_METHOD is not provided');
                    done();
                }
            });

            it('should throw an error when GET_MODEL_METHOD is not found', function(done){

                prepareEnv({ACTION_OR_TRIGGER: 'update', GET_MODEL_METHOD: 'unknown'});

                service.processService('selectModel')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('error');
                    expect(result.data.message).toEqual('Method "unknown" is not found in "update" action or trigger');
                    done();
                }
            });

        });

        describe('success cases', function(){

            beforeEach(function(){
                nock('http://test.com:80')
                    .post('/123/456')
                    .reply(200, "OK");
            });

            it('verifyCredentials', function(done){

                prepareEnv({});

                service.processService('verifyCredentials')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual({verified: true});
                    done();
                }
            });

            it('getMetaModel', function(done){

                prepareEnv({ACTION_OR_TRIGGER: 'update'});

                service.processService('getMetaModel')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual('metamodel');
                    done();
                }
            });

            it('selectModel', function(done){

                prepareEnv({ACTION_OR_TRIGGER: 'update', GET_MODEL_METHOD: 'getModel'});

                service.processService('selectModel')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual('model');
                    done();
                }
            });

            it('selectModel with updateKeys event', function(done){

                prepareEnv({
                    ACTION_OR_TRIGGER: 'update',
                    GET_MODEL_METHOD: 'getModelWithKeysUpdate',
                    CFG: '{"_account":"1234567890"}',
                    API_URI: 'http://apihost.com',
                    API_USERNAME: 'test@test.com',
                    API_KEY: '5559edd'
                });

                var nockScope = nock('http://apihost.com:80')
                    .put('/v1/accounts/1234567890', {keys: {oauth: {access_token: 'newAccessToken'}}})
                    .reply(200, "Success");

                service.processService('selectModel')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(nockScope.isDone()).toEqual(true);
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual('model2');
                    done();
                }
            });

            it('selectModel with failed updateKeys event should return result anyway', function(done){

                prepareEnv({
                    ACTION_OR_TRIGGER: 'update',
                    GET_MODEL_METHOD: 'getModelWithKeysUpdate',
                    CFG: '{"_account":"1234567890"}',
                    API_URI: 'http://apihost.com',
                    API_USERNAME: 'test@test.com',
                    API_KEY: '5559edd'
                });

                var nockScope = nock('http://apihost.com:80')
                    .put('/v1/accounts/1234567890', {keys: {oauth: {access_token: 'newAccessToken'}}})
                    .reply(400, "Success");

                service.processService('selectModel')
                    .then(checkResult)
                    .done();

                function checkResult(result){
                    expect(nockScope.isDone()).toEqual(true);
                    expect(result.status).toEqual('success');
                    expect(result.data).toEqual('model2');
                    done();
                }
            });

        });

        describe('sending error', function(){

            beforeEach(function(){
                nock('http://test.com:80')
                    .post('/111/222')
                    .reply(404, "Page not found");
            });

            it('verifyCredentials', function(done){

                prepareEnv({POST_RESULT_URL: 'http://test.com/111/222'});

                service.processService('verifyCredentials')
                    .catch(checkError)
                    .done();

                function checkError(err){
                    expect(err.message).toEqual('Failed to POST data to http://test.com/111/222 (404, Page not found)');
                    done();
                }
            });

        });
    });
});