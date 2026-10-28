'use strict';

const rp = require('request-promise-native');

exports.process = processTrigger;

function processTrigger(msg, cfg) {
    // eslint-disable-next-line no-invalid-this
    const that = this;
    const options = {
        uri: 'https://api.acme.com/customers',
        json: true
    };

    rp.get(options).then((data) => {
        that.emit('data', {
            body: {
                originalMsg: msg,
                customers: data
            }
        });
        that.emit('end');
    });
}
