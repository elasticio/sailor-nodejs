const crypto = require('crypto');
const log = require('./logging.js');

class Encryptor {
    constructor(password, iv) {
        this._cryptoPassword = password;
        this._cryptoIV = iv;
        if (this._cryptoPassword) {
            this._encryptionKey = crypto
                .createHash('sha256')
                .update(this._cryptoPassword, 'utf-8')
                .digest();
            if (!this._cryptoIV) {
                throw new Error(
                    `missing crypt initialiazation vector,
                    most likely ELASTICIO_MESSAGE_CRYPTO_PASSWORD env var is not set
                    `
                );
            }
        }
        this._algorithm = 'aes-256-cbc';
    }

    createCipher() {
        return crypto.createCipheriv(
            this._algorithm,
            this._encryptionKey,
            this._cryptoIV
        );
    }

    createDecipher() {
        return crypto.createDecipheriv(
            this._algorithm,
            this._encryptionKey,
            this._cryptoIV
        );
    }


    /**
     * Encrypt message to proper format
     * @param {*} messagePayload anything json-stringifiable
     * @param {'hex'|'base64'|'utf-8',undefined} outputEncoding
     * @returns {Buffer}
     */
    encryptMessageContent(messagePayload, outputEncoding) {
        const encryptedBuffer = this._encryptToBuffer(JSON.stringify(messagePayload));
        if (outputEncoding) {
            return Buffer.from(encryptedBuffer.toString(outputEncoding));
        } else {
            return encryptedBuffer;
        }
    }

    /**
     * Encrypt message to proper format
     * @param {Buffer} messagePayload
     * @param {'hex'|'base64'|'utf-8',undefined} inputEncoding
     * @returns {*} anything, what have been encrypted
     */
    decryptMessageContent(messagePayload, inputEncoding) {
        if (!messagePayload || messagePayload.length === 0) {
            return null;
        }
        let encryptedBuffer;
        if (inputEncoding) {
            encryptedBuffer = Buffer.from(messagePayload.toString(), inputEncoding);
        } else {
            encryptedBuffer = messagePayload;
        }
        try {
            const decryptedMessage = this._decryptFromBuffer(encryptedBuffer);
            return JSON.parse(decryptedMessage);
        } catch (err) {
            log.error(err, 'Failed to decrypt message');
            throw Error('Failed to decrypt message: ' + err.message);
        }
    }

    /**
     * Encrypt payload.
     * @param {Buffer|String} message
     * @returns {Buffer}
     */
    _encryptToBuffer(message) {
        if (!this._encryptionKey) {
            return Buffer.from(message);
        }
        const cipher = this.createCipher();
        return Buffer.concat([
            cipher.update(message),
            cipher.final()
        ]);
    }

    /**
     * Decrypt payload.
     * @param {Buffer} message
     * @returns {String}
     */
    _decryptFromBuffer(message) {
        if (!this._encryptionKey) {
            return message.toString();
        }
        const decipher = this.createDecipher();

        return Buffer.concat([
            decipher.update(message),
            decipher.final()
        ]).toString('utf8');
    }
}
module.exports = Encryptor;
