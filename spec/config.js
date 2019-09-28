const _ = require('lodash');
module.exports.prepareEnv = function prepareEnv(currentStep) {
    const WORKSPACE_ID = String(Math.ceil(Math.random() * 10000000));
    const FLOW_ID = String(Math.ceil(Math.random() * 10000000));
    const STEP_ID = currentStep;
    const config = {
        /** ********************** SAILOR ITSELF CONFIGURATION ***********************************/

        AMQP_URI: 'amqp://guest:guest@localhost:5672',
        API_URI: 'http://apihost.com',
        API_USERNAME: 'test@test.com',
        API_KEY: '5559edd',
        API_REQUEST_RETRY_DELAY: 100,
        API_REQUEST_RETRY_ATTEMPTS: 3,

        FLOW_ID,
        STEP_ID,
        EXEC_ID: 'some-exec-id',
        WORKSPACE_ID,
        CONTAINER_ID: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',

        USER_ID: '5559edd38968ec0736000002',
        COMP_ID: '5559edd38968ec0736000456',
        FUNCTION: 'list',

        TIMEOUT: 3000,

        /** ********************** COMMUNICATION LAYER SETTINGS ***********************************/
        MESSAGE_CRYPTO_PASSWORD: 'testCryptoPassword',
        MESSAGE_CRYPTO_IV: 'iv=any16_symbols',

        LISTEN_MESSAGES_ON: `${WORKSPACE_ID}:${FLOW_ID}/ordinary:${STEP_ID}:messages`,
        PUBLISH_MESSAGES_TO: `${WORKSPACE_ID}_org`,
        DATA_ROUTING_KEY: `${WORKSPACE_ID}.${FLOW_ID}/ordinary.${STEP_ID}.message`,
        ERROR_ROUTING_KEY: `${WORKSPACE_ID}.${FLOW_ID}/ordinary.${STEP_ID}.error`,
        REBOUND_ROUTING_KEY: `${WORKSPACE_ID}.${FLOW_ID}/ordinary.${STEP_ID}.rebound`,
        SNAPSHOT_ROUTING_KEY: `${WORKSPACE_ID}.${FLOW_ID}/ordinary.${STEP_ID}.snapshot`,

        DATA_RATE_LIMIT: 1000,
        ERROR_RATE_LIMIT: 1000,
        SNAPSHOT_RATE_LIMIT: 1000,
        RATE_INTERVAL: 1000,

        REBOUND_INITIAL_EXPIRATION: 15000,
        REBOUND_LIMIT: 5,

        RABBITMQ_PREFETCH_SAILOR: 1,

        /** ***************************** MINOR PARAMETERS ********************************/
        COMP_NAME: 'does_NOT_MATTER',
        EXEC_TYPE: 'flow-step',
        FLOW_VERSION: '12345',
        TENANT_ID: 'tenant_id',
        CONTRACT_ID: 'contract_id',
        TASK_USER_EMAIL: 'user@email',
        EXECUTION_RESULT_ID: '987654321',
        COMPONENT_PATH: '/spec/integration/integration_component'
    };
    return _.fromPairs(Object.entries(config).map(([k, v]) => ['ELASTICIO_' + k, v]));
};
