const _ = require('lodash');

const PREFIX = 'ELASTICIO_';

function getOptionalEnvVars(envVars) {
    const optional = {
        REBOUND_INITIAL_EXPIRATION: 15000,
        REBOUND_LIMIT: 20,
        COMPONENT_PATH: '',
        RABBITMQ_PREFETCH_SAILOR: 1,
        STARTUP_REQUIRED: false,
        HOOK_SHUTDOWN: false,
        API_REQUEST_RETRY_ATTEMPTS: 3,
        API_REQUEST_RETRY_DELAY: 100,
        DATA_RATE_LIMIT: 10, // 10 data events every 100ms
        ERROR_RATE_LIMIT: 2, // 2 errors every 100ms
        SNAPSHOT_RATE_LIMIT: 2, // 2 Snapshots every 100ms
        RATE_INTERVAL: 100, // 100ms
        PROCESS_AMQP_DRAIN: true,
        AMQP_PUBLISH_RETRY_DELAY: 100, // 100ms
        AMQP_PUBLISH_RETRY_ATTEMPTS: Infinity,
        AMQP_PUBLISH_MAX_RETRY_DELAY: 5 * 60 * 1000, // 5 mins
        AMQP_PERSISTENT_MESSAGES: false,
        OUTGOING_MESSAGE_SIZE_LIMIT: 10485760,
        NO_SELF_PASSTRHOUGH: false,
        PROTOCOL_VERSION: 1,
        NO_ERROR_REPLIES: false,
        INPUT_FORMAT: 'default',
        OBJECT_STORAGE_URI: null,
        OBJECT_STORAGE_TOKEN: null,
        OBJECT_STORAGE_SIZE_THRESHOLD: 1048576,
        EMIT_LIGHTWEIGHT_MESSAGE: false,
        AMQP_RECONNECT_ATTEMPTS: 3,
        AMQP_RECONNECT_TIMEOUT: 100,
        WAIT_MESSAGES_TIMEOUT: 50
    };

    const result = {};
    _.forEach(optional, function readOptional(defaultValue, key) {
        const envVarName = PREFIX + key;
        if (typeof defaultValue === 'number' && envVars[envVarName]) {
            result[key] = parseInt(envVars[envVarName]) || defaultValue;
        } else if (typeof defaultValue === 'boolean') {
            if (envVars[envVarName] === undefined) {
                result[key] = defaultValue;
            } else {
                result[key] = (!envVars[envVarName] || envVars[envVarName] === 'false') ? false : true;
            }
        } else {
            result[key] = envVars[envVarName] || defaultValue;
        }
    });
    return result;
}

function getAdditionalVars(envVars) {
    if (envVars.ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS) {
        const vars = {};
        envVars.ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS
            .split(',')
            .map(env => env.trim())
            .forEach(env => {
                const key = env.indexOf(PREFIX) === 0 ? env.slice(PREFIX.length) : env;
                vars[key] = envVars[env];
            });

        return vars;
    }
}

function getMandatoryEnvVars(envVars) {
    // required settings
    const requiredAlways = [
        'FLOW_ID',
        'EXEC_ID',
        'STEP_ID',
        'CONTAINER_ID',
        'WORKSPACE_ID',

        'USER_ID',
        'COMP_ID',
        'FUNCTION',

        'API_URI',
        'API_USERNAME',
        'API_KEY'
    ];

    const requiredForMessageProcessing = [
        'AMQP_URI',
        'LISTEN_MESSAGES_ON',
        'PUBLISH_MESSAGES_TO',

        'DATA_ROUTING_KEY',
        'ERROR_ROUTING_KEY',
        'REBOUND_ROUTING_KEY',
        'SNAPSHOT_ROUTING_KEY',
        'MESSAGE_CRYPTO_IV',
        'MESSAGE_CRYPTO_PASSWORD'
    ];

    const envVarsList = requiredAlways.slice(0);

    if (!envVars.ELASTICIO_HOOK_SHUTDOWN) {
        envVarsList.push(...requiredForMessageProcessing);
    }

    return envVarsList.reduce((result, key) => {
        const envVarName = PREFIX + key;
        if (!envVars[envVarName]) {
            throw new Error(`${envVarName} is missing`);
        }
        result[key] = envVars[envVarName];
        return result;
    }, {});
}

function readFrom(envVars) {
    return {
        ...getMandatoryEnvVars(envVars),
        ...getOptionalEnvVars(envVars),
        additionalVars: getAdditionalVars(envVars)
    };
}

exports.readFrom = readFrom;
