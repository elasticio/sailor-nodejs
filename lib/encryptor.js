const cipher = require('./cipher.js');

function encryptMessageContent(cryptoSettings, messagePayload) {
    return cipher.encrypt(cryptoSettings, JSON.stringify(messagePayload));
}

function decryptMessageContent(cryptoSettings, messagePayload) {
    if (!messagePayload || messagePayload.toString().length === 0) {
        return null;
    }
    try {
        return JSON.parse(cipher.decrypt(cryptoSettings, messagePayload.toString()));
    } catch (err) {
        throw Error('Failed to decrypt message: ' + err.message);
    }
}
exports.encryptMessageContent = encryptMessageContent;
exports.decryptMessageContent = decryptMessageContent;
exports.getEncryptionId = () => cipher.id;
