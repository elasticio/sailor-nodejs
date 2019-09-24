const bunyan = require('bunyan');
// FIXME copy&paste ContainerLogger & ComponebtLogger
class ContainerLogger {
    constructor(config) {
        const logger = bunyan.createLogger({
            name: 'container',
            level: config.LOG_LEVEL,
            serializers: bunyan.stdSerializers
        });

        for (let type of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
            this[type] = function log() {
                const args = Array.prototype.slice.call(arguments);

                if (args.length && typeof args[0] !== 'string') {
                    args[0] = String(args[0]);
                }

                return logger[type](...args);
            };
        }
    }
}

class MessageLogger {
    // fIXME implement me
}

// FIXME there is Component level logger and message level logger
class ComponentLogger {
    constructor(config, options) {
        const loggingContext = [
            'API_USERNAME',
            'COMP_ID',
            'COMP_NAME',
            'CONTAINER_ID',
            'CONTRACT_ID',
            'EXEC_ID',
            'EXEC_TYPE',
            'EXECUTION_RESULT_ID',
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

        for (let type of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
            this[type] = function log() {
                const args = Array.prototype.slice.call(arguments);

                if (args.length && typeof args[0] !== 'string') {
                    args[0] = String(args[0]);
                }

                return logger[type](...args);
            };
        }
    }
}

module.exports = {
    ComponentLogger,
    ContainerLogger
};
