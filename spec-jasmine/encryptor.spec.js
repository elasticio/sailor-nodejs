const cipher = require('../src/encryptor.js');

process.env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD = 'testCryptoPassword';
process.env.ELASTICIO_MESSAGE_CRYPTO_IV = 'iv=any16_symbols';

describe('Cipher', () => {
    beforeEach(() => {
        spyOn(global, 'decodeURIComponent').and.callThrough();
        spyOn(global, 'encodeURIComponent').and.callThrough();
    });

    it('should encrypt & decrypt strings', () => {
        const content = 'B2B_L größere Firmenkunden 25% Rabatt';
        const result = cipher.encryptMessageContent(content);
        const decryptedResult = cipher.decryptMessageContent(result);

        expect(decryptedResult.toString()).toEqual(content.toString());
        expect(global.decodeURIComponent).not.toHaveBeenCalled();
        expect(global.encodeURIComponent).not.toHaveBeenCalled();
    });

    it('should encrypt & decrypt objects', () => {
        const content = { property1: 'Hello world' };
        const result = cipher.encryptMessageContent(content);
        const decryptedResult = cipher.decryptMessageContent(result);

        expect(decryptedResult).toEqual({ property1: 'Hello world' });
    });

    it('should encrypt & decrypt buffer', () => {
        const content = Buffer.from('Hello world');
        const result = cipher.encryptMessageContent(content.toString());
        const decryptedResult = cipher.decryptMessageContent(result);

        expect(decryptedResult).toEqual('Hello world');
    });

    it('should encrypt & decrypt message with buffers', () => {
        const content = { property1: Buffer.from('Hello world').toString() };
        const result = cipher.encryptMessageContent(content);
        const decryptedResult = cipher.decryptMessageContent(result);

        expect(decryptedResult).toEqual({ property1: 'Hello world' });
    });

    it('should throw error if failed to decrypt', () => {
        let error;

        try {
            cipher.decryptMessageContent('dsdasdsad');
        } catch (err) {
            error = err;
        }

        expect(error.message).toMatch('Failed to decrypt message');
    });
});
