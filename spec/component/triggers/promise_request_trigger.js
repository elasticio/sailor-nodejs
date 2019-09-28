const request = require('request-promise-native');

exports.process = async function processTrigger() {
    const options = {
        uri: 'http://promise_target_url:80/foo/bar',
        json: true
    };

    const data = await request.get(options);
    return {
        body: data
    };
};
