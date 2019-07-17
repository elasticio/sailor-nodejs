'use strict';

const bunyan = require('bunyan');
const _ = require('lodash');

let level;

if (process.env.NODE_ENV === 'test') {
    level = bunyan.FATAL + 1; // turn off logging
} else {
    level = process.env.LOG_LEVEL || 'info';
}

const data = Object.assign(
    _.pick(process.env, [
        'ELASTICIO_API_USERNAME',
        'ELASTICIO_COMP_ID',
        'ELASTICIO_COMP_NAME',
        'ELASTICIO_CONTAINER_ID',
        'ELASTICIO_CONTRACT_ID',
        'ELASTICIO_EXEC_ID',
        'ELASTICIO_EXEC_TYPE',
        'ELASTICIO_EXECUTION_RESULT_ID',
        'ELASTICIO_FLOW_ID',
        'ELASTICIO_FLOW_VERSION',
        'ELASTICIO_FUNCTION',
        'ELASTICIO_STEP_ID',
        'ELASTICIO_TASK_USER_EMAIL',
        'ELASTICIO_TENANT_ID',
        'ELASTICIO_USER_ID',
        'ELASTICIO_WORKSPACE_ID'
    ]),
    { tag: process.env.ELASTICIO_FLOW_ID }
);

const log = bunyan.createLogger({
    name: 'sailor',
    level: level,
    serializers: bunyan.stdSerializers
})
    .child(data);

_.bindAll(log, [
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace'
]);

function criticalErrorAndExit(err) {
    if (err instanceof Error) {
        log.fatal(err);
    } else {
        log.fatal('Error happened: %s', err);
    }

    process.exit(1);
}

function ComponentLogger(options) {
    const logger = bunyan.createLogger({
        name: 'component',
        level: level,
        serializers: bunyan.stdSerializers
    })
        .child(data)
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

module.exports = log;
module.exports.ComponentLogger = ComponentLogger;
module.exports.criticalErrorAndExit = criticalErrorAndExit;
