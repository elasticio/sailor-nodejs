const crypto = require('crypto');
const _ = require('lodash');
// TODO remove this shit. Use bunyan
const debug = require('debug')('sailor:cipher');

const ALGORYTHM = 'aes-256-cbc';

function encryptIV(cryptoSettings, rawData) {
    debug('About to encrypt:', rawData);

    if (!_.isString(rawData)) {
        throw new Error('RabbitMQ message cipher.encryptIV() accepts only string as parameter.');
    }

    const encodeKey = crypto.createHash('sha256').update(cryptoSettings.password, 'utf-8').digest();
    const cipher = crypto.createCipheriv(ALGORYTHM, encodeKey, cryptoSettings.cryptoIV);
    return cipher.update(rawData, 'utf-8', 'base64') + cipher.final('base64');
}

function decryptIV(cryptoSettings, encData) {
    debug('About to decrypt:', encData);

    if (!_.isString(encData)) {
        throw new Error('RabbitMQ message cipher.decryptIV() accepts only string as parameter.');
    }

    const decodeKey = crypto.createHash('sha256').update(cryptoSettings.password, 'utf-8').digest();
    const cipher = crypto.createDecipheriv(ALGORYTHM, decodeKey, cryptoSettings.cryptoIV);

    return cipher.update(encData, 'base64', 'utf-8') + cipher.final('utf-8');
}

exports.id = 1;
exports.encrypt = encryptIV;
exports.decrypt = decryptIV;
