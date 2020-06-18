const { expect } = require('chai');
const Encryptor = require('../../lib/encryptor.js');
describe('Cipher', () => {
    let encryptor;
    beforeEach(() => {
        encryptor = new Encryptor('testCryptoPassword', 'iv=any16_symbols');
    });

    it('should encrypt & decrypt strings', () => {
        const content = 'B2B_L größere Firmenkunden 25% Rabatt';
        const result = encryptor.encryptMessageContent(content);
        const decryptedResult = encryptor.decryptMessageContent(result);
        expect(decryptedResult.toString()).to.equal(content.toString());
    });

    it('should encrypt & decrypt objects', () => {
        const content = { property1: 'Hello world' };
        const result = encryptor.encryptMessageContent(content);
        const decryptedResult = encryptor.decryptMessageContent(result);
        expect(decryptedResult).to.deep.equal({ property1: 'Hello world' });
    });

    it('should encrypt & decrypt buffer', () => {
        const content = Buffer.from('Hello world');
        const result = encryptor.encryptMessageContent(content.toString());
        const decryptedResult = encryptor.decryptMessageContent(result);
        expect(decryptedResult).to.equal('Hello world');
    });

    it('should encrypt & decrypt message with buffers', () => {
        const content = {
            property1: Buffer.from('Hello world').toString()
        };
        const result = encryptor.encryptMessageContent(content);
        const decryptedResult = encryptor.decryptMessageContent(result);
        expect(decryptedResult).to.deep.equal({ property1: 'Hello world' });
    });

    it('should throw error if failed to decrypt', () => {
        let error;
        try {
            encryptor.decryptMessageContent('dsdasdsad');
        } catch (err) {
            error = err;
        }
        expect(error).to.be.instanceof(Error);
        expect(error.message).to.include('Failed to decrypt message');
    });
    it('should properly encrypt<->decrypt base64 encoded buffers', () => {
        const content = { property1: 'Hello world' };
        const result = encryptor.encryptMessageContent(content, 'base64');
        const decryptedResult = encryptor.decryptMessageContent(result, 'base64');
        expect(decryptedResult).to.deep.equal({ property1: 'Hello world' });
    });
});
