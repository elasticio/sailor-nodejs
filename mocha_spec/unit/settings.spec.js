const { expect } = require('chai');
const settings = require('../../lib/settings.js');

describe('Settings', () => {
    let envVars;
    beforeEach(() => {
        envVars = {};

        envVars.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
        envVars.ELASTICIO_EXEC_ID = 'some-exec-id';
        envVars.ELASTICIO_STEP_ID = 'step_1';
        envVars.ELASTICIO_WORKSPACE_ID = '5559edd38968ec073600683';
        envVars.ELASTICIO_CONTAINER_ID = 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948';

        envVars.ELASTICIO_USER_ID = '5559edd38968ec0736000002';
        envVars.ELASTICIO_COMP_ID = '5559edd38968ec0736000456';
        envVars.ELASTICIO_FUNCTION = 'list';

        envVars.ELASTICIO_API_URI = 'http://apihost.com';
        envVars.ELASTICIO_API_USERNAME = 'test@test.com';
        envVars.ELASTICIO_API_KEY = '5559edd';

        envVars.ELASTICIO_SAILOR_PROXY_URI = 'http://proxy:1245';
        envVars.ELASTICIO_SAILOR_PROXY_JWT_SECRET = 'testProxySecret';

        envVars.ELASTICIO_MESSAGE_CRYPTO_IV = 'initiailization vector';
        envVars.ELASTICIO_MESSAGE_CRYPTO_PASSWORD = 'this is password';
    });

    it('should throw error if no important settings provided', () => {
        expect(() => {
            settings.readFrom({});
        }).throws('ELASTICIO_FLOW_ID is missing');
    });

    it('should not throw error if all important settings provided', () => {
        const result = settings.readFrom(envVars);

        expect(result.FLOW_ID).to.equal('5559edd38968ec0736000003');
        expect(result.SAILOR_PROXY_URI).to.equal('http://proxy:1245');
    });

    it('should support also numbers as a settings parameter', () => {
        envVars.ELASTICIO_PROXY_PREFETCH_SAILOR = '20';

        const result = settings.readFrom(envVars);

        expect(result.FLOW_ID).to.equal('5559edd38968ec0736000003');
        expect(result.PROXY_PREFETCH_SAILOR).to.equal(20);
    });

    it('should support also booleans as a settings parameter', () => {
        envVars.ELASTICIO_NO_SELF_PASSTRHOUGH = '';
        let result = settings.readFrom(envVars);
        expect(result.NO_SELF_PASSTRHOUGH).to.equal(false);

        envVars.ELASTICIO_NO_SELF_PASSTRHOUGH = 'false';
        result = settings.readFrom(envVars);
        expect(result.NO_SELF_PASSTRHOUGH).to.equal(false);

        envVars.ELASTICIO_NO_SELF_PASSTRHOUGH = 'true';
        result = settings.readFrom(envVars);
        expect(result.NO_SELF_PASSTRHOUGH).to.equal(true);
    });

    it('should pass additional vars to settings that are listed in ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS', () => {
        envVars.ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS = 'ELASTICIO_FIRST, ELASTICIO_SECOND ,' +
            'ELASTICIO_THIRD_ELASTICIO_ENV,ELASTICIO_NOT_PRESENT';

        envVars.ELASTICIO_RANDOM = 'random';
        envVars.ELASTICIO_FIRST = 'first';
        envVars.ELASTICIO_SECOND = 'second';
        envVars.ELASTICIO_THIRD_ELASTICIO_ENV = 'third';

        const result = settings.readFrom(envVars);

        expect(result.additionalVars).to.deep.equal({
            FIRST: 'first',
            SECOND: 'second',
            THIRD_ELASTICIO_ENV: 'third',
            NOT_PRESENT: undefined
        });
    });
});
