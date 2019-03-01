const logging = require('./logging.js');
const Sailor = require('./sailor.js').Sailor;
const settings = require('./settings.js').readFrom(process.env);

if (process.listenerCount('SIGTERM') === 0) {
    process.once('SIGTERM', function onSigterm () {
        logging.info('Received SIGTERM');
        disconnectAndExit();
    });
}

if (process.listenerCount('SIGINT') === 0) {
    process.once('SIGINT', function onSigint () {
        logging.info('Received SIGINT');
        disconnectAndExit();
    });
}

if (process.listenerCount('uncaughtException') === 0) {
    process.once('uncaughtException', logging.criticalErrorAndExit);
}

let sailor;
let disconnectRequired;

async function disconnect () {
    logging.info('Disconnecting');
    return sailor.disconnect();
}

async function disconnectAndExit () {
    if (!disconnectRequired) {
        return;
    }

    try {
        await disconnect();
        logging.info('Successfully disconnected');
        process.exit(0);
    } catch (err) {
        logging.error('Unable to disconnect', err.stack);
        process.exit(-1);
    }
}

(async function putOutToSea () {
    try {
        sailor = new Sailor(settings);

        if (settings.HOOK_SHUTDOWN) {
            disconnectRequired = false;
            sailor.reportError = () => { };
            await sailor.prepare();
            await sailor.shutdown();
            return;
        }

        disconnectRequired = true;
        await sailor.connect();
        await sailor.prepare();

        if (settings.STARTUP_REQUIRED) {
            await sailor.startup();
        }

        await sailor.init();
        await sailor.run();
    } catch (e) {
        if (sailor) {
            sailor.reportError(e);
        }

        logging.criticalErrorAndExit(e);
    }
})();

exports.disconnect = disconnect;
