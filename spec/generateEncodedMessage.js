const Encryptor = require('../lib/encryptor');
const config = require('../config/local.json');

function generateEncodedMessage(
    body,
    protocolVersion = 2
) {
    // console.log({ config, protocolVersion }, 'Generating encoded message with config and protocol version');
    const encryptor = new Encryptor(config.ELASTICIO_MESSAGE_CRYPTO_PASSWORD, config.ELASTICIO_MESSAGE_CRYPTO_IV);
    return encryptor.encryptMessageContent(
        body,
        protocolVersion < 2
            ? 'base64'
            : undefined
    );
}

function decodeMessage(encodedMessageBuffer, protocolVersion = 2) {
    // console.log({ config, protocolVersion }, 'Decoding message with config and protocol version');
    const encryptor = new Encryptor(config.ELASTICIO_MESSAGE_CRYPTO_PASSWORD, config.ELASTICIO_MESSAGE_CRYPTO_IV);
    return encryptor.decryptMessageContent(
        encodedMessageBuffer,
        protocolVersion < 2
            ? 'base64'
            : undefined
    );
}

exports.generateEncodedMessage = generateEncodedMessage;

if (require.main === module) {
    const sampleMessage = {
        headers: {
            messageHeader1: 'headerValue1',
            messageHeader2: 'headerValue2'
            // "x-ipaas-object-storage-id": "2ad7b3b7-4e6b-4772-9f38-8327d71fde7e"
        },
        body: {
            dataField1: 'dataValue1',
            dataField2: 'dataValue2'
        }
    };

    const encodedMessage = generateEncodedMessage(sampleMessage, 2);
    console.log('Encoded Message:', encodedMessage.toString('base64'));
    // const message = 'SmVGMloxRGtyOFFjNm9oSU5DUXpkMVBIYktURlNvNU92VkVQdnBUK1hlRmlhYUtDQVJxSEZScHpnMTl2NmFUaXpFWTZiRDArTDZZSVNPQ0ZjZS85SlhrMFVUcmdraTJiTUNrUjQ3OHYrOGlXUUN4TXJOMWFiV2VCcC9ZZVpvUW1KOUNFZmpzTjFPV1YraXQ2MXVnS1UxMDBXY0c0TDZzaGpZWWFlak9kczU2em5uU0cvcVBtRHV0SkRFdDRuZjR4';
    // const decodedMessage = decodeMessage(Buffer.from(message, 'base64'));
    // console.log("Decoded Message:", decodedMessage);
}
