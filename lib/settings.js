var _ = require('lodash');

var ENV_VARS = {};

exports.get = getOne;
exports.getMultiple = getMultiple;
exports.init = init;
exports.initSailor = initSailor;

function getOne(varName) {
    return ENV_VARS['ELASTICIO_' + varName] || ENV_VARS[varName];
}

function getMultiple(varNames) {
    var result = {};
    _.forEach(varNames, function readRequired(key){
        result[key] = getOne(key);
    });
    return result;
}

function getEnvVar(varName, object) {
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

    var settings = {};

    // read required vars
    _.forEach(requiredVars, function readRequired(key){
        settings[key] = getEnvVar(key, env);
        if (!settings[key]) {
            throw new Error(key + ' is missing');
        }
    });

    // parse task
    settings.TASK = JSON.parse(settings.TASK);

    // set default values
    settings.REBOUND_INITIAL_EXPIRATION = getEnvVar('REBOUND_INITIAL_EXPIRATION', env) || 15000;
    settings.REBOUND_LIMIT = getEnvVar('REBOUND_LIMIT', env) || 20;
    settings.COMPONENT_PATH = getEnvVar('COMPONENT_PATH', env) || '';
    settings.RABBITMQ_PREFETCH_SAILOR = parseInt(getEnvVar('RABBITMQ_PREFETCH_SAILOR', env) || 1);

    // init
    init(settings);
}




