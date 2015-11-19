describe('Settings', function () {

    var settings = require('../lib/settings.js');

    it('should throw error if no important settings provided', function () {
        expect(function(){
            settings.initSailor({});
        }).toThrow('AMQP_URI is missing');
    });

    it('should not throw error if all important settings provided', function () {

        var envVars = {};
        envVars.AMQP_URI = 'amqp://test2/test2';
        envVars.TASK = '{"_id":"5559edd38968ec0736000003","data":{"step_2":{"uri":"546456456456456"}},"recipe":{"nodes":[{"id":"step_2","function":"passthrough"}]}}';
        envVars.STEP_ID = 'step_1';

        envVars.LISTEN_MESSAGES_ON = '5559edd38968ec0736000003:step_1:1432205514864:messages';
        envVars.PUBLISH_MESSAGES_TO = 'userexchange:5527f0ea43238e5d5f000001';
        envVars.DATA_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:message';
        envVars.ERROR_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:error';
        envVars.REBOUND_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:rebound';
        envVars.SNAPSHOT_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:snapshot';

        envVars.API_URI = 'http://apihost.com';
        envVars.API_USERNAME = 'test@test.com';
        envVars.API_KEY = '5559edd';

        settings.initSailor(envVars);
        expect(settings.get('LISTEN_MESSAGES_ON')).toEqual('5559edd38968ec0736000003:step_1:1432205514864:messages');
    });

    it('should read values from ELASTICIO_ variables also', function () {

        var envVars = {};
        envVars.ELASTICIO_AMQP_URI = 'amqp://test2/test2';
        envVars.ELASTICIO_TASK = '{"_id":"5559edd38968ec0736000003","data":{"step_2":{"uri":"546456456456456"}},"recipe":{"nodes":[{"id":"step_2","function":"passthrough"}]}}';
        envVars.ELASTICIO_STEP_ID = 'step_1';

        envVars.ELASTICIO_LISTEN_MESSAGES_ON = '5559edd38968ec0736000003:step_1:1432205514864:messages';
        envVars.ELASTICIO_PUBLISH_MESSAGES_TO = 'userexchange:5527f0ea43238e5d5f000001';
        envVars.ELASTICIO_DATA_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:message';
        envVars.ELASTICIO_ERROR_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:error';
        envVars.ELASTICIO_REBOUND_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:rebound';
        envVars.ELASTICIO_SNAPSHOT_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:snapshot';

        envVars.ELASTICIO_API_URI = 'http://apihost.com';
        envVars.ELASTICIO_API_USERNAME = 'test@test.com';
        envVars.ELASTICIO_API_KEY = '5559edd';

        settings.initSailor(envVars);
        expect(settings.get('LISTEN_MESSAGES_ON')).toEqual('5559edd38968ec0736000003:step_1:1432205514864:messages');
    });

});
