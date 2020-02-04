const cipher = require('./cipher.js');
const log = require('./logging.js');

exports.encryptMessageContent = encryptMessageContent;
exports.decryptMessageContent = decryptMessageContent;

function encryptMessageContent(messagePayload, outputEncoding) {
    return cipher.encrypt(JSON.stringify(messagePayload), outputEncoding);
}

function decryptMessageContent(messagePayload, messageHeaders, inputEncoding) {
    if (!messagePayload || messagePayload.toString().length === 0) {
        return null;
    }
    try {
        return JSON.parse(cipher.decrypt(messagePayload, messageHeaders, inputEncoding));
    } catch (err) {
        log.error(err, 'Failed to decrypt message');
        throw Error('Failed to decrypt message: ' + err.message);
    }
}
