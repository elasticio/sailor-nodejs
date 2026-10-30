import { expect } from 'chai';
import { Encryptor } from '../../../src/crypto/index.ts';

const PASSWORD = 'testCryptoPassword';
const IV = 'iv=any16_symbols';
const PAYLOAD = { body: { text: 'héllo ✓' }, headers: { a: 1 } };
// Captured from the old lib/encryptor.js with the values above.
const OLD_HEX = 'c77cfcd644932106578a0f070221ceffb00acb0c97609190ee532f0f0bdcafb5'
    + 'ce9c7da410276cd2b911aa30e88739ba46fad86cab937a71617a4910270bbfc7';
const OLD_BASE64 = 'x3z81kSTIQZXig8HAiHO/7AKywyXYJGQ7lMvDwvcr7XOnH2kECds0rkRqjDohzm6RvrYbKuTenFhekkQJwu/xw==';

describe('Encryptor', () => {
    const encryptor = new Encryptor(PASSWORD, IV);

    it('produces the same ciphertext as the old implementation', () => {
        expect(encryptor.encryptMessageContent(PAYLOAD).toString('hex')).to.equal(OLD_HEX);
        expect(encryptor.encryptMessageContent(PAYLOAD, 'base64').toString()).to.equal(OLD_BASE64);
    });

    it('decrypts ciphertext from the old implementation', () => {
        expect(encryptor.decryptMessageContent(Buffer.from(OLD_HEX, 'hex'))).to.deep.equal(PAYLOAD);
        expect(encryptor.decryptMessageContent(Buffer.from(OLD_BASE64), 'base64')).to.deep.equal(PAYLOAD);
    });

    it('round-trips with hex encoding', () => {
        const encrypted = encryptor.encryptMessageContent(PAYLOAD, 'hex');
        expect(encryptor.decryptMessageContent(encrypted, 'hex')).to.deep.equal(PAYLOAD);
    });

    it('returns null for empty input', () => {
        expect(encryptor.decryptMessageContent(null)).to.equal(null);
        expect(encryptor.decryptMessageContent(Buffer.alloc(0))).to.equal(null);
    });

    it('throws "Failed to decrypt message" on garbage', () => {
        expect(() => encryptor.decryptMessageContent(Buffer.from('garbage')))
            .to.throw(/^Failed to decrypt message: /);
    });

    it('throws when the password is set but the IV is missing', () => {
        expect(() => new Encryptor(PASSWORD, undefined)).to.throw(/missing crypt initialiazation vector/);
    });

    it('passes plain text through without a password', () => {
        const plain = new Encryptor(undefined, undefined);
        const encrypted = plain.encryptMessageContent(PAYLOAD);
        expect(encrypted.toString()).to.equal(JSON.stringify(PAYLOAD));
        expect(plain.decryptMessageContent(encrypted)).to.deep.equal(PAYLOAD);
    });

    it('cipher/decipher streams interoperate with encryptMessageContent', () => {
        const encrypted = encryptor.encryptMessageContent(PAYLOAD);
        const decipher = encryptor.createDecipher();
        const text = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString();
        expect(JSON.parse(text)).to.deep.equal(PAYLOAD);
    });
});
