const logging = require('./logging.js');
const Sailor = require('./sailor.js').Sailor;
const settings = require('./settings.js').readFrom(process.env);

process.on('SIGTERM', function onSigterm () {
    console.log('Received SIGTERM');
    disconnectAndExit();
});

process.on('SIGINT', function onSigint () {
    console.log('Received SIGINT');
    disconnectAndExit();
});

process.on('uncaughtException', logging.criticalErrorAndExit);

let sailor;
let disconnectRequired;

async function disconnect () {
    console.log('Disconnecting');
    return sailor.disconnect();
}

async function disconnectAndExit () {
    if (!disconnectRequired) {
        return;
    }

    try {
        await disconnect();
        console.log('Successfully disconnected');
        process.exit();
    } catch (err) {
        console.error('Unable to disconnect', err.stack);
        process.exit(-1);
    }
}

(async function putOutToSea () {
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
})().catch(e => {
    if (sailor) {
        sailor.reportError(e);
    }

    logging.criticalErrorAndExit(e);
});

exports.disconnect = disconnect;
