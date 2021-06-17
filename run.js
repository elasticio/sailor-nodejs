/**
 * Entrypoint for starting task step.
 */
const logger = require('./lib/logging.js');
const Sailor = require('./lib/sailor.js').Sailor;
const settings = require('./lib/settings.js');
const { IPC } = require('./lib/ipc.js');
const Q = require('q');
const http = require('http');

let sailor;
let sailorInit;
let disconnectRequired;

// miserable try to workaround issue described in https://github.com/elasticio/elasticio/issues/4874
const { Agent } = http;
http.globalAgent = new Agent({
    keepAlive: true
});

async function putOutToSea(settings, ipc) {
    ipc.send('init:started');
    const deferred = Q.defer();
    sailorInit = deferred.promise;
    sailor = new Sailor(settings);

    //eslint-disable-next-line no-extra-boolean-cast
    if (!!settings.HOOK_SHUTDOWN) {
        disconnectRequired = false;
        //eslint-disable-next-line no-empty-function
        sailor.reportError = () => {
        };
        await sailor.prepare();
        await sailor.runHookShutdown();
        return;
    }

    disconnectRequired = true;
    await sailor.connect();
    await sailor.prepare();

    //eslint-disable-next-line no-extra-boolean-cast
    if (!!settings.STARTUP_REQUIRED) {
        await sailor.startup();
    }

    await sailor.runHookInit();
    await sailor.run();
    deferred.resolve();
    ipc.send('init:ended');
}

async function disconnectAndExit() {
    if (!disconnectRequired) {
        return;
    }
    disconnectRequired = false;

    try {
        logger.info('Disconnecting...');
        await sailor.disconnect();
        logger.info('Successfully disconnected');
        process.exit();
    } catch (err) {
        logger.error(err, 'Unable to disconnect');
        process.exit(-1);
    }
}

async function gracefulShutdown() {
    if (!disconnectRequired) {
        return;
    }

    if (!sailor) {
        logger.warn('Something went wrong – sailor is falsy');
        return;
    }

    // we connect to amqp, create channels, start listen a queue on init and interrupting this process with 'disconnect'
    // will lead to undefined behaviour
    logger.trace('Checking/waiting for init before graceful shutdown');
    await sailorInit;
    logger.trace('Waited an init before graceful shutdown');

    await sailor.scheduleShutdown();
    await disconnectAndExit();
}

async function run(settings, ipc) {
    try {
        await putOutToSea(settings, ipc);
        logger.info('Fully initialized and waiting for messages');
    } catch (e) {
        if (sailor && !sailor.amqpConnection.closed) {
            await sailor.reportError(e);
        }
        logger.criticalErrorAndExit('putOutToSea.catch', e);
    }
}

exports.__test__ = {
    disconnectOnly: function disconnectOnly() {
        if (!disconnectRequired) {
            return Promise.resolve();
        }
        return sailor.disconnect();
    },
    closeConsumerChannel: function closeConsumerChannel() {
        return sailor.amqpConnection.consumerChannel.close();
    }
};
exports.run = run;
exports.putOutToSea = putOutToSea;

if (require.main === module || process.mainModule.filename === __filename) {
    process.on('SIGTERM', function onSigterm() {
        logger.info('Received SIGTERM');
        gracefulShutdown();
    });

    process.on('SIGINT', function onSigint() {
        logger.info('Received SIGINT');
        gracefulShutdown();
    });

    process.on('uncaughtException', logger.criticalErrorAndExit.bind(logger, 'process.uncaughtException'));
    process.on('unhandledRejection', logger.criticalErrorAndExit.bind(logger, 'process.unhandledRejection'));

    const ipc = new IPC();

    run(settings.readFrom(process.env), ipc);
}
