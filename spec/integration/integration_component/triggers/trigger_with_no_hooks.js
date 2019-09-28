const rp = require('request-promise-native');

exports.process = function processTrigger(msg) {
    const options = {
        uri: 'https://api.acme.com/customers',
        json: true
    };

    rp.get(options).then((data) => {
        this.emit('data', {
            id: 'f45be600-f770-11e6-b42d-b187bfbf19fd',
            body: {
                originalMsg: msg,
                customers: data
            }
        });
        this.emit('end');
    });
};
