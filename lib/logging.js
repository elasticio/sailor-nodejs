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
        'ELASTICIO_CONTAINER_ID',
        'ELASTICIO_FLOW_ID',
        'ELASTICIO_FLOW_VERSION',
        'ELASTICIO_EXEC_ID',
        'ELASTICIO_STEP_ID',
        'ELASTICIO_COMP_ID',
        'ELASTICIO_FUNCTION'
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

module.exports = log;
module.exports.criticalErrorAndExit = criticalErrorAndExit;
