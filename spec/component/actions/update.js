const request = require('request-promise-native');

exports.process = function processAction(msg) {
    if (msg.snapshot) {
        this.emit('snapshot', msg.snapshot);
    }
    if (msg.updateSnapshot) {
        this.emit('updateSnapshot', msg.updateSnapshot);
    }
    this.emit('end');
};

exports.getMetaModel = function getMetaModel(cfg, cb) {
    return cb(null, {
        in: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    title: 'Name'
                }
            }
        }
    });
};

exports.getModel = function getModel(cfg, cb) {
    return cb(null, {
        de: 'Germany',
        us: 'USA',
        ua: 'Ukraine'
    });
};

exports.getModelWithKeysUpdate = function getModelWithKeysUpdate(cfg, cb) {
    this.emit('updateKeys', { oauth: { access_token: 'newAccessToken' } });
    return cb(null, {
        0: 'Mr',
        1: 'Mrs'
    });
};

exports.promiseSelectModel = function promiseSelectModel() {
    return Promise.resolve({
        de: 'de_DE',
        at: 'de_AT'
    });
};

exports.promiseRequestSelectModel = function promiseRequestSelectModel() {
    const options = {
        uri: 'http://promise_target_url:80/selectmodel',
        json: true
    };

    return request.get(options);
};

exports.promiseSelectModelRejected = function promiseSelectModelRejected() {
    return Promise.reject(new Error('Ouch. This promise is rejected'));
};
