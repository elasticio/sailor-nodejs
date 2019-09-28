const rp = require('request-promise-native');

const subscription = {};

function startup() {
    const options = {
        uri: 'http://example.com/subscriptions/enable',
        json: true,
        body: {
            data: 'startup'
        }
    };

    return rp.post(options)
        .then((body) => ({ subscriptionResult: body }));
}

function shutdown(cfg, startupData) {
    const options = {
        uri: 'http://example.com/subscriptions/disable',
        json: true,
        body: {
            cfg,
            startupData
        }
    };

    return rp.post(options);
}

function initTrigger(cfg) {
    const options = {
        uri: 'https://api.acme.com/subscribe',
        json: true,
        body: {
            event: 'Opened'
        }
    };

    return rp.post(options)
        .then((body) => {
            subscription.id = body.id;
            subscription.cfg = cfg;
        });
}

function processTrigger(msg) {
    const options = {
        uri: 'https://api.acme.com/customers',
        json: true
    };

    rp.get(options).then((data) => {
        this.emit('data', {
            id: 'f45be600-f770-11e6-b42d-b187bfbf19fd',
            body: {
                originalMsg: msg,
                customers: data,
                subscription: subscription
            }
        });
        this.emit('end');
    });
}

exports.init = initTrigger;
exports.startup = startup;
exports.shutdown = shutdown;
exports.process = processTrigger;


