// FIXME logger used inside sailor itself should not stringify nothing
// Logger inside users' code should stringify everything
const assert = require('assert');
const bunyan = require('bunyan');
// FIXME copy&paste ContainerLogger & ComponebtLogger
function mixinLogger(context, logger, stringify) {
    for (let type of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
        context[type] = function log() {
            let args;
            if (stringify) {
                args = Array.prototype.slice.call(arguments);

                if (args.length && typeof args[0] !== 'string') {
                    args[0] = String(args[0]);
                }
            } else {
                args = arguments;
            }

            return logger[type](...args);
        };
    }
}

/**
 * Logger for single sailor
 */
class SingleAppLogger {
    constructor(config) {
        const loggingContext = [
            'API_USERNAME',
            'COMP_ID',
            'COMP_NAME',
            'CONTAINER_ID',
            'CONTRACT_ID',
            'EXEC_ID',
            'EXEC_TYPE',
            'FLOW_ID',
            'FLOW_VERSION',
            'FUNCTION',
            'STEP_ID',
            'TASK_USER_EMAIL',
            'TENANT_ID',
            'USER_ID',
            'WORKSPACE_ID'
        ].reduce(
            (context, varName) => Object.assign({}, { [varName]: config[varName] }, context),
            { tag: config.FLOW_ID }
        );

        const logger = bunyan.createLogger({
            name: 'container',
            level: config.LOG_LEVEL,
            serializers: bunyan.stdSerializers
        })
            .child(loggingContext);
        mixinLogger(this, logger, false);
    }
}

/**
 * Logger for multiple sailor service
 */
class MultiAppLogger {
    constructor(config) {
        const loggingContext = [
            'COMP_ID',
            'COMP_NAME',
            'CONTAINER_ID'
        ].reduce(
            (context, varName) => Object.assign({}, { [varName]: config[varName] }, context),
            {}
        );

        const logger = bunyan.createLogger({
            name: 'container',
            level: config.LOG_LEVEL,
            serializers: bunyan.stdSerializers
        })
            .child(loggingContext);
        mixinLogger(this, logger, false);
    }
}

/**
 * @class Logger used to log something
 * in context of one message
 */
class MessageLevelLogger {
    constructor(config, options, stringify) {
        assert(options.threadId);
        assert(options.messageId);
        assert(options.parentMessageId);
        const loggingContext = [
            'API_USERNAME',
            'COMP_ID',
            'COMP_NAME',
            'CONTAINER_ID',
            'CONTRACT_ID',
            'EXEC_ID',
            'EXEC_TYPE',
            'FLOW_ID',
            'FLOW_VERSION',
            'FUNCTION',
            'STEP_ID',
            'TASK_USER_EMAIL',
            'TENANT_ID',
            'USER_ID',
            'WORKSPACE_ID'
        ].reduce(
            (context, varName) => Object.assign({}, { [varName]: config[varName] }, context),
            { tag: config.FLOW_ID }
        );

        const logger = bunyan.createLogger({
            name: 'component',
            level: config.LOG_LEVEL,
            serializers: bunyan.stdSerializers
        })
            .child(loggingContext)
            .child(options);
        mixinLogger(this, logger, stringify);
    }
}

class OneTimeExecutionLogger {
    constructor(config) {
        const loggingContext = [
            'API_USERNAME',
            'CONTAINER_ID',
            'EXEC_TYPE',
            'EXECUTION_RESULT_ID',
            'ACTION_OR_TRIGGER',
            'GET_MODEL_METHOD'
        ].reduce(
            (context, varName) => Object.assign({}, { [varName]: config[varName] }, context),
            { tag: config.FLOW_ID }
        );

        const logger = bunyan.createLogger({
            name: 'component',
            level: config.LOG_LEVEL,
            serializers: bunyan.stdSerializers
        })
            .child(loggingContext);
        mixinLogger(this, logger);
    }
};

module.exports = {
    MessageLevelLogger,
    SingleAppLogger,
    MultiAppLogger,
    OneTimeExecutionLogger
};
