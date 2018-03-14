const logging = require('./lib/logging.js');
const Sailor = require('./lib/sailor.js').Sailor;
const settings = require('./lib/settings.js').readFrom(process.env);
const co = require('co');

exports.disconnect = disconnect;

let sailor;
let disconnectRequired;

co(function* putOutToSea() {
    sailor = new Sailor(settings);


    //eslint-disable-next-line no-extra-boolean-cast
    if (!!settings.HOOK_SHUTDOWN) {
        disconnectRequired = false;
        //eslint-disable-next-line no-empty-function
        sailor.reportError = () => {
        };
        yield sailor.prepare();
        yield sailor.shutdown();
        return;
    }

    disconnectRequired = true;
    yield sailor.connect();
    yield sailor.prepare();

    //eslint-disable-next-line no-extra-boolean-cast
    if (!!settings.STARTUP_REQUIRED) {
        yield sailor.startup();
    }

    yield sailor.init();
    yield sailor.run();
}).catch((e) => {
    if (sailor) {
        sailor.reportError(e);
    }
    logging.criticalError(e);
});

process.on('SIGTERM', function onSigterm() {
    console.log('Received SIGTERM');
    disconnectAndExit();
});

process.on('SIGINT', function onSigint() {
    console.log('Received SIGINT');
    disconnectAndExit();
});

process.on('uncaughtException', logging.criticalError);

function disconnect() {
    return co(function* putIn() {
        console.log('Disconnecting');
        return yield sailor.disconnect();
    });
}

function disconnectAndExit() {
    if (!disconnectRequired) {
        return;
    }
    co(function* putIn() {
        yield disconnect();
        console.log('Successfully disconnected');
        process.exit();
    }).catch((err) => {
        console.error('Unable to disconnect', err.stack);
        process.exit(-1);
    });
}
