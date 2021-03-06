const logger = require('./lib/logging.js');
const Sailor = require('./lib/sailor.js').Sailor;
const settings = require('./lib/settings.js');
const co = require('co');
const http = require('http');

let sailor;
let disconnectRequired;

// miserable try to workaround issue described in https://github.com/elasticio/elasticio/issues/4874
const { Agent } = http;
http.globalAgent = new Agent({
    keepAlive: true
});

async function putOutToSea(settings) {
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
}

function disconnectAndExit() {
    if (!disconnectRequired) {
        return;
    }
    disconnectRequired = false;
    co(function* putIn() {
        logger.info('Disconnecting...');
        yield sailor.disconnect();
        logger.info('Successfully disconnected');
        process.exit();
    }).catch((err) => {
        logger.error('Unable to disconnect', err.stack);
        process.exit(-1);
    });
}

function _disconnectOnly() {
    if (!disconnectRequired) {
        return Promise.resolve();
    }
    return sailor.disconnect();
}

function _closeConsumerChannel() {
    return sailor.amqpConnection.consumerChannel.close();
}

function gracefulShutdown() {
    if (!disconnectRequired) {
        return;
    }

    if (!sailor) {
        logger.warn('Something went wrong – sailor is falsy');
        return;
    }

    sailor.scheduleShutdown().then(disconnectAndExit);
}

async function run(settings) {
    try {
        await putOutToSea(settings);
    } catch (e) {
        if (sailor && !sailor.amqpConnection.closed) {
            await sailor.reportError(e);
        }
        logger.criticalErrorAndExit('putOutToSea.catch', e);
    }
}

exports._disconnectOnly = _disconnectOnly;
exports._closeConsumerChannel = _closeConsumerChannel;
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

    run(settings.readFrom(process.env));
}
