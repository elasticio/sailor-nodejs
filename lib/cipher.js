const _ = require('lodash');
const crypto = require('crypto');
const debug = require('debug')('sailor:cipher');
const { PassThrough } = require('stream');

const ALGORYTHM = 'aes-256-cbc';

exports.id = 1;
exports.encrypt = encryptIV;
exports.encryptStream = createCypher;
exports.decrypt = decryptIV;
exports.decryptStream = createDecipher;

function createCypher() {
    const PASSWORD = process.env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD;
    const VECTOR = process.env.ELASTICIO_MESSAGE_CRYPTO_IV;

    if (!PASSWORD) {
        //mimic cypher
        return new class extends PassThrough {
            update(data) {
                return data;
            }
            final() {
                return '';
            }
        };
    }

    if (!VECTOR) {
        throw new Error('process.env.ELASTICIO_MESSAGE_CRYPTO_IV is not set');
    }

    const encodeKey = crypto.createHash('sha256').update(PASSWORD, 'utf-8').digest();
    return crypto.createCipheriv(ALGORYTHM, encodeKey, VECTOR);
}

function createDecipher() {
    const PASSWORD = process.env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD;
    const VECTOR = process.env.ELASTICIO_MESSAGE_CRYPTO_IV;

    if (!PASSWORD) {
        //mimic cypher
        return new class extends PassThrough {
            update(data) {
                return data;
            }
            final() {
                return '';
            }
        };
    }

    if (!VECTOR) {
        throw new Error('process.env.ELASTICIO_MESSAGE_CRYPTO_IV is not set');
    }

    const decodeKey = crypto.createHash('sha256').update(PASSWORD, 'utf-8').digest();
    return crypto.createDecipheriv(ALGORYTHM, decodeKey, VECTOR);
}

function encryptIV(rawData, outputEncoding) {
    debug('About to encrypt:', rawData);

    if (!_.isString(rawData)) {
        throw new Error('RabbitMQ message cipher.encryptIV() accepts only string as parameter.');
    }

    const cipher = createCypher();
    return Buffer.concat([
        Buffer.from(cipher.update(rawData, 'utf8', outputEncoding)),
        Buffer.from(cipher.final(outputEncoding))
    ]);
}

function decryptIV(encData, inputEncoding) {
    const decipher = createDecipher();

    const data = inputEncoding ? encData.toString() : encData;

    return decipher.update(data, inputEncoding, 'utf8') + decipher.final('utf8');
}
