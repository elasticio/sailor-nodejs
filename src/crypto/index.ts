import crypto, { type Cipheriv, type Decipheriv } from 'node:crypto';
import logging from '../logging/index.ts';

export type ContentEncoding = 'hex' | 'base64' | 'utf-8';

const ALGORITHM = 'aes-256-cbc';

/**
 * Message encryption: aes-256-cbc, key = sha256(password), IV used as given.
 * Without a password, content is passed through as plain text.
 */
export class Encryptor {
    readonly #key: Buffer | undefined;
    readonly #iv: string | undefined;

    constructor(password: string | undefined, iv: string | undefined) {
        this.#iv = iv;
        if (password) {
            this.#key = crypto.createHash('sha256').update(password, 'utf-8').digest();
            if (!iv) {
                throw new Error(
                    'missing crypt initialiazation vector, most likely ELASTICIO_MESSAGE_CRYPTO_IV env var is not set'
                );
            }
        }
    }

    /** Used by Maester as a stream transform. */
    createCipher(): Cipheriv {
        return crypto.createCipheriv(ALGORITHM, this.#requireKey(), this.#iv!);
    }

    /** Used by Maester as a stream transform. */
    createDecipher(): Decipheriv {
        return crypto.createDecipheriv(ALGORITHM, this.#requireKey(), this.#iv!);
    }

    /** JSON-stringifies and encrypts. With an encoding, returns the encoded ciphertext as a buffer. */
    encryptMessageContent(payload: unknown, outputEncoding?: ContentEncoding): Buffer {
        const encrypted = this.#encrypt(JSON.stringify(payload));
        return outputEncoding ? Buffer.from(encrypted.toString(outputEncoding)) : encrypted;
    }

    /** Decrypts and JSON-parses. Empty input gives `null`. */
    decryptMessageContent(payload: Buffer | null | undefined, inputEncoding?: ContentEncoding): unknown {
        if (!payload || payload.length === 0) {
            return null;
        }
        const encrypted = inputEncoding ? Buffer.from(payload.toString(), inputEncoding) : payload;
        try {
            return JSON.parse(this.#decrypt(encrypted));
        } catch (err) {
            logging.error(err, 'Failed to decrypt message');
            throw new Error(`Failed to decrypt message: ${(err as Error).message}`);
        }
    }

    #requireKey(): Buffer {
        if (!this.#key) {
            throw new Error('Encryption key is not set');
        }
        return this.#key;
    }

    #encrypt(message: string): Buffer {
        if (!this.#key) {
            logging.warn('Encryption key is not set, message will be stored in plain text');
            return Buffer.from(message);
        }
        const cipher = this.createCipher();
        return Buffer.concat([cipher.update(message), cipher.final()]);
    }

    #decrypt(message: Buffer): string {
        if (!this.#key) {
            return message.toString();
        }
        const decipher = this.createDecipher();
        return Buffer.concat([decipher.update(message), decipher.final()]).toString('utf8');
    }
}
