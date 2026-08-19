/* eslint-disable no-unused-vars */
const Encryptor = require('./lib/encryptor');
const config = require('./config/local.json');

const DEFAULT_MESSAGE = {
    headers: {
        messageHeader1: 'headerValue1',
        messageHeader2: 'headerValue2'
    },
    body: {
        dataField1: 'dataValue1',
        dataField2: 'dataValue2'
    }
};

function generateEncodedMessage(body, protocolVersion = 2) {
    const encryptor = new Encryptor(config.ELASTICIO_MESSAGE_CRYPTO_PASSWORD, config.ELASTICIO_MESSAGE_CRYPTO_IV);
    return encryptor.encryptMessageContent(
        body,
        protocolVersion < 2 ? 'base64' : undefined
    );
}

function decodeMessage(encodedMessageBuffer, protocolVersion = 2) {
    const encryptor = new Encryptor(config.ELASTICIO_MESSAGE_CRYPTO_PASSWORD, config.ELASTICIO_MESSAGE_CRYPTO_IV);
    return encryptor.decryptMessageContent(
        encodedMessageBuffer,
        protocolVersion < 2 ? 'base64' : undefined
    );
}

exports.generateEncodedMessage = generateEncodedMessage;
exports.decodeMessage = decodeMessage;

// # Encode the default sample message
// npm run encode
//
// # Encode a custom JSON message
// npm run encode -- '{"body":{"key":"value"}}'
//
// # Decode a base64-encoded message
// npm run decode -- <base64-string>
//
// # Encode with a specific protocol version (1 or 2)
// npm run encode -- '{"body":{}}' 1
if (require.main === module) {
    const [,, command, ...args] = process.argv;

    if (command === 'encode') {
        const body = args[0] ? JSON.parse(args[0]) : DEFAULT_MESSAGE;
        const protocolVersion = args[1] ? parseInt(args[1]) : 2;
        const encoded = generateEncodedMessage(body, protocolVersion);
        console.log('Encoded Message (base64):', encoded.toString('base64'));
    } else if (command === 'decode') {
        const encoded = args[0];
        if (!encoded) {
            console.error('Usage: npm run decode -- <base64-encoded-message>');
            process.exit(1);
        }
        const protocolVersion = args[1] ? parseInt(args[1]) : 2;
        const decoded = decodeMessage(Buffer.from(encoded, 'base64'), protocolVersion);
        console.log('Decoded Message:', JSON.stringify(decoded, null, 2));
    } else {
        console.log('Usage:');
        console.log('  npm run encode                          # encode default sample message');
        console.log('  npm run encode -- \'{"body":{"k":"v"}}\'  # encode custom JSON message');
        console.log('  npm run decode -- <base64-string>       # decode an encoded message');
    }
}
