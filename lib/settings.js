const MANDATORTY_VARS = [
    'LISTEN_MESSAGES_ON',
    'AMQP_URI',
    'API_URI',
    'API_USERNAME',
    'API_KEY',
    'MESSAGE_CRYPTO_PASSWORD',
    'MESSAGE_CRYPTO_IV'
];
const ROUTING_ENV_VARS = [
    'PUBLISH_MESSAGES_TO',
    'DATA_ROUTING_KEY',
    'ERROR_ROUTING_KEY',
    'REBOUND_ROUTING_KEY',
    'SNAPSHOT_ROUTING_KEY'
];


const MANDATORY_SAILOR = [
    'FLOW_ID',
    'STEP_ID',
    'EXEC_ID',
    'CONTAINER_ID',
    'WORKSPACE_ID',
    'USER_ID',
    'COMP_ID',
    'FUNCTION'
];

const LOGGING_SAILOR = [
    'COMP_NAME',
    'EXEC_TYPE',
    'FLOW_VERSION',
    'TENANT_ID',
    'CONTRACT_ID',
    'TASK_USER_EMAIL',
    'EXECUTION_RESULT_ID'
];


// FIXME document this. But vars are not required;
//const OPTIONAL = [
//    'RABBITMQ_PREFETCH_SAILOR',
//    'PROCESS_AMQP_DRAIN',
//    'AMQP_PUBLISH_RETRY_DELAY',
//    'AMQP_PUBLISH_RETRY_ATTEMPTS',
//    'REBOUND_INITIAL_EXPIRATION',
//    'REBOUD_LIMIT',
//    'API_REQUEST_RETRY_ATTEMTPTS',
//    'API_REQUEST_RETRY_DELAY',
//    'DATA_RATE_LIMIT',
//    'RATE_INTERVAL',
//    'ERROR_RATE_LIMIT',
//    'SNAPSHOT_RATE_LIMIT',
//    'ELASTICIO_TIMEOUT',
//];

const DEFAULTS = {
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
    AMQP_PUBLISH_RETRY_ATTEMPTS: 10,
    TIMEOUT: 20 * 60 * 1000, // 20 minutes
    LOG_LEVEL: 'info'
};

function normalizeEnvVars(prefix, list, envVars) {
    const vars = list.reduce((valueTable, varName) => {
        if (!((prefix + varName) in envVars)) {
            throw new Error(`${prefix}${varName} is missing`);
        }
        valueTable[varName] = envVars[prefix + varName];
        return valueTable;
    }, {});
    return Object.entries(process.env).reduce((vars, [k, v]) => {
        if (k.indexOf(prefix) === 0) {
            vars[k.replace(prefix, '')] = v;
        }
        return vars;
    }, vars);
}

class Config {
    constructor(values, defaults) {
        Object.assign(this, defaults, values);
    }
    get(varName) {
        if (!(varName in this._values)) {
            throw new Error(`variable ${varName} is not defined`);
        }
        return this._values[varName];
    }
    set(varName, varValue) {
        this._values[varName] = varValue;
    }
    static fromEnv() {
        throw new Error('implement me');
    }
}
class MultisailorConfig extends Config {
    static fromEnv() {
        const values = normalizeEnvVars('ELASTICIO_', MANDATORTY_VARS, process.env);
        return new this(values, DEFAULTS);
    }
}
class SingleSailorConfig extends Config {
    static fromEnv() {
        const values = normalizeEnvVars(
            'ELASTICIO_',
            MANDATORTY_VARS.concat(ROUTING_ENV_VARS, MANDATORY_SAILOR, LOGGING_SAILOR),
            process.env
        );
        return new this(values, DEFAULTS);
    }
}

module.exports = {
    MultisailorConfig,
    SingleSailorConfig
};
