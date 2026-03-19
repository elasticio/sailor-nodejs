/**
 * Entrypoint for starting task step.
 */
const logger = require('./lib/logging.js');
const Sailor = require('./lib/sailor.js').Sailor;
const settings = require('./lib/settings.js');
const { IPC } = require('./lib/ipc.js');
const Q = require('q');
const http = require('http');
const https = require('https');

let sailor;
let sailorInit;
let disconnectRequired;

function prepareSandbox() {
    // enable keep alive by default to handle issues like https://github.com/elasticio/elasticio/issues/4874
    http.globalAgent = new http.Agent({
        keepAlive: true
    });
    https.globalAgent = new https.Agent({
        keepAlive: true
    });
}

async function putOutToSea(settings, ipc) {
    logger.trace({ settings }, 'putOutToSea called');
    ipc.send('init:started');
    const deferred = Q.defer();
    sailorInit = deferred.promise;
    sailor = new Sailor(settings);

    //eslint-disable-next-line no-extra-boolean-cast
    if (!!settings.HOOK_SHUTDOWN) {
        logger.trace('Running hook shutdown');
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
    deferred.resolve();
    ipc.send('init:ended');

    await sailor.run();
}

async function gracefulShutdown() {
    if (!disconnectRequired) {
        return;
    }

    if (!sailor) {
        logger.warn('Something went wrong – sailor is falsy');
        return;
    }

    // Wait for init to complete before disconnecting
    logger.trace('Checking/waiting for init before graceful shutdown');
    await sailorInit;
    logger.trace('Waited an init before graceful shutdown');

    try {
        logger.info('Scheduling shutdown...');
        await sailor.scheduleShutdown();
        logger.info('Finished shutdown. Disconnecting...');
        await sailor.disconnect();
        logger.info('Successfully disconnected');
        process.exit();
    } catch (err) {
        logger.error(err, 'Unable to disconnect');
        process.exit(-1);
    }
}

async function run(settings, ipc) {
    prepareSandbox();
    try {
        await putOutToSea(settings, ipc);
    } catch (e) {
        if (sailor && !sailor.isConnected()) {
            await sailor.reportError(e);
        }
        logger.criticalErrorAndExit('putOutToSea.catch', e);
    }
}

function addProcessListeners() {
    process.on('SIGTERM', function onSigterm() {
        logger.info('Received SIGTERM');
        gracefulShutdown();
    });

    process.on('SIGINT', function onSigint() {
        logger.info('Received SIGINT');
        gracefulShutdown();
    });

    process.on('uncaughtException', logger.criticalErrorAndExit.bind(logger, 'process.uncaughtException'));
    process.on('unhandledRejection', (err) => logger.error(err, 'process.unhandledRejection'));
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
exports.addProcessListeners = addProcessListeners;

if (require.main === module || process.mainModule.filename === __filename) {
    addProcessListeners();
    const ipc = new IPC();
    run(settings.readFrom(process.env), ipc);
}
