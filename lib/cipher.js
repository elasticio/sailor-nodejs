var crypto = require('crypto');

var ALGORYTHM = 'aes-256-cbc';
var PASSWORD = process.env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD;
var VECTOR = process.env.ELASTICIO_MESSAGE_CRYPTO_IV;

exports.id = 1;
exports.encrypt = encryptIV;
exports.decrypt = decryptIV;

function encryptIV(rawData, outputEncoding) {
    if (!PASSWORD) {
        return rawData;
    }

    if (!VECTOR) {
        throw new Error('process.env.ELASTICIO_MESSAGE_CRYPTO_IV is not set');
    }

    var encodeKey = crypto.createHash('sha256').update(PASSWORD, 'utf-8').digest();
    var cipher = crypto.createCipheriv(ALGORYTHM, encodeKey, VECTOR);
    const res = Buffer.concat([cipher.update(rawData, 'utf8'), cipher.final()]);

    if (outputEncoding) {
        return res.toString(outputEncoding);
    }

    return res;
}

function decryptIV(encData, inputEncoding) {
    if (!PASSWORD) {
        return encData;
    }

    if (!VECTOR) {
        throw new Error('process.env.ELASTICIO_MESSAGE_CRYPTO_IV is not set');
    }

    var decodeKey = crypto.createHash('sha256').update(PASSWORD, 'utf-8').digest();
    var decipher = crypto.createDecipheriv(ALGORYTHM, decodeKey, VECTOR);

    return decipher.update(encData, inputEncoding, 'utf8') + decipher.final('utf8');
}
