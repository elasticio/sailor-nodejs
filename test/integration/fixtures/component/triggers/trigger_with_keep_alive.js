const rp = require('request-promise-native');

exports.process = async function process(msg) {
    const options = {
        uri: `${msg.body.isHttps ? 'https' : 'http'}://api.acme.com/customers`,
        json: true,
        resolveWithFullResponse: true
    };

    const response = await rp.get(options);
    this.emit('data', {
        body: {
            originalMsg: msg,
            customers: response.body,
            keepAlive: response.request.agent.keepAlive
        }
    });
    this.emit('end');
};
