var _ = require('lodash');

var ENV_VARS = {};

exports.get = get;
exports.init = init;
exports.initSailor = initSailor;

function get(varName) {
    return ENV_VARS['ELASTICIO_' + varName] || ENV_VARS[varName];
}

function getEnvVar(varName, object) {
    console.log('%j', object);
    console.log('getEnvVar ELASTICIO_%s %s', varName, object['ELASTICIO_AMQP_URI']);
    return object['ELASTICIO_' + varName] || object[varName];
}

function init(env) {
    ENV_VARS = env;
}

function initSailor(env) {

    var requiredVars = [
        'AMQP_URI',
        'LISTEN_MESSAGES_ON',
        'PUBLISH_MESSAGES_TO',
        'DATA_ROUTING_KEY',
        'ERROR_ROUTING_KEY',
        'REBOUND_ROUTING_KEY',
        'REBOUND_ROUTING_KEY',
        'TASK',
        'STEP_ID',
        'API_URI',
        'API_USERNAME',
        'API_KEY'
    ];

    var result = {};

    // read required vars
    _.forEach(requiredVars, function readRequired(key){
        result[key] = getEnvVar(key, env);
        if (!result[key]) {
            throw new Error(key + ' is missing');
        }
    });

    // parse task
    result.TASK = JSON.parse(result.TASK);

    // set default values
    result.REBOUND_INITIAL_EXPIRATION = getEnvVar('REBOUND_INITIAL_EXPIRATION', env) || 15000;
    result.REBOUND_LIMIT = getEnvVar('REBOUND_LIMIT', env) || 20;
    result.COMPONENT_PATH = getEnvVar('COMPONENT_PATH', env) || '';
    result.RABBITMQ_PREFETCH_SAILOR = parseInt(getEnvVar('RABBITMQ_PREFETCH_SAILOR', env) || 1);

    // init
    ENV_VARS = result;
}




