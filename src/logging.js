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
        'ELASTICIO_TASK_ID',
        'ELASTICIO_EXEC_ID',
        'ELASTICIO_STEP_ID',
        'ELASTICIO_COMP_ID',
        'ELASTICIO_FUNCTION'
    ]),
    { tag: process.env.ELASTICIO_TASK_ID }
);

const log = bunyan.createLogger({ name: 'sailor', level: level, serializers: bunyan.stdSerializers }).child(data);

_.bindAll(log, ['error', 'warn', 'info', 'debug', 'trace']);

function criticalErrorAndExit (err) {
    if (err.message) {
        log.error('Error happened: %s', err.message);
        log.error(err.stack);
    } else {
        log.error(String(err));
    }

    if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
    }
}

module.exports = log;
module.exports.criticalErrorAndExit = criticalErrorAndExit;
