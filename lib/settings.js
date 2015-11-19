var _ = require('lodash');

var ENV_VARS = {};

exports.get = getOne;
exports.getAll = getAll;
exports.init = init;
exports.initSailor = initSailor;

function getOne(varName) {
    return ENV_VARS['ELASTICIO_' + varName] || ENV_VARS[varName];
}

function getAll(varNames) {
    return ENV_VARS;
}

function getEnvVar(varName, object) {
    return object['ELASTICIO_' + varName] || object[varName];
}

function init(env) {
    ENV_VARS = env;
}

function initSailor(env) {

    var required = [
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

    var optional = {
        'REBOUND_INITIAL_EXPIRATION': 15000,
        'REBOUND_LIMIT': 20,
        'COMPONENT_PATH': '',
        'RABBITMQ_PREFETCH_SAILOR': 1
    };

    var settings = {};

    // read required vars
    _.forEach(required, function readRequired(key){
        settings[key] = getEnvVar(key, env);
        if (settings[key] === undefined) {
            throw new Error(key + ' is missing');
        }
    });

    _.forEach(optional, function readOptional(defaultValue, key){
        settings[key] = getEnvVar(key, env);
        if (settings[key] === undefined) {
            settings[key] = defaultValue;
        }
    });

    // parse task
    settings.TASK = JSON.parse(settings.TASK);

    // init
    init(settings);
}




