var _ = require('lodash');
var crypto = require('crypto');
var debug = require('debug')('sailor:cipher');
var PassThrough = require('stream').PassThrough;

var ALGORYTHM = 'aes-256-cbc';
var PASSWORD = process.env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD;
var VECTOR = process.env.ELASTICIO_MESSAGE_CRYPTO_IV;

exports.id = 1;
exports.encrypt = encryptIV;
exports.decrypt = decryptIV;
exports.decryptStream = decryptStreamIV;
exports.encryptStream = encryptStreamIV;

function encryptIV(rawData) {
    debug('About to encrypt:', rawData);

    if (!_.isString(rawData)) {
        throw new Error('RabbitMQ message cipher.encryptIV() accepts only string as parameter.');
    }

    if (!PASSWORD) {
        return rawData;
    }

    if (!VECTOR) {
        throw new Error('process.env.ELASTICIO_MESSAGE_CRYPTO_IV is not set');
    }

    var encodeKey = crypto.createHash('sha256').update(PASSWORD, 'utf-8').digest();
    var cipher = crypto.createCipheriv(ALGORYTHM, encodeKey, VECTOR);
    return cipher.update(rawData, 'utf-8', 'base64') + cipher.final('base64');
}

function decryptIV(encData) {
    debug('About to decrypt:', encData);

    if (!_.isString(encData)) {
        throw new Error('RabbitMQ message cipher.decryptIV() accepts only string as parameter.');
    }

    if (!PASSWORD) {
        return encData;
    }

    if (!VECTOR) {
        throw new Error('process.env.ELASTICIO_MESSAGE_CRYPTO_IV is not set');
    }

    var decodeKey = crypto.createHash('sha256').update(PASSWORD, 'utf-8').digest();
    var cipher = crypto.createDecipheriv(ALGORYTHM, decodeKey, VECTOR);

    var result = cipher.update(encData, 'base64', 'utf-8') + cipher.final('utf-8');

    return result;
}

function encryptStreamIV() {
    debug('Creating encryption stream');

    if (!PASSWORD) {
        return new PassThrough;
    }

    if (!VECTOR) {
        throw new Error('process.env.ELASTICIO_MESSAGE_CRYPTO_IV is not set');
    }

    var encodeKey = crypto.createHash('sha256').update(PASSWORD, 'utf-8').digest();
    return crypto.createCipheriv(ALGORYTHM, encodeKey, VECTOR);
}

function decryptStreamIV() {
    debug('Creating decryption stream');

    if (!PASSWORD) {
        return new PassThrough;
    }

    if (!VECTOR) {
        throw new Error('process.env.ELASTICIO_MESSAGE_CRYPTO_IV is not set');
    }

    var decodeKey = crypto.createHash('sha256').update(PASSWORD, 'utf-8').digest();
    return crypto.createDecipheriv(ALGORYTHM, decodeKey, VECTOR);
}
