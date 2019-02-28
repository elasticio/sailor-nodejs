const request = require('request');

exports.process = processTrigger;

async function processTrigger (msg, cfg) {
    const tokenOptions = {
        uri: 'https://login.acme/oauth2/v2.0/token',
        json: true,
        body: {
            client_id: 'admin',
            client_secret: 'secret'
        }
    };

    const [, newToken] = await request.post(tokenOptions);

    this.emit('updateKeys', { oauth: newToken });

    const options = {
        uri: 'https://login.acme/oauth2/v2.0/contacts',
        json: true
    };

    const [, body] = await request.get(options);

    return { body };
}
