const sinon = require('sinon');
const chai = require('chai');
const { expect } = chai;
chai.use(require('sinon-chai'));

const encryptor = require('../../lib/encryptor.js');
const cipher = require('../../lib/cipher.js');

describe('Cipher', () => {
    const cryptoSettings = {
        password: 'testCryptoPassword',
        cryptoIV: 'iv=any16_symbols'
    };

    let sandbox;
    beforeEach(() => {
        sandbox = sinon.createSandbox();
        sandbox.spy(global, 'decodeURIComponent');
        sandbox.spy(global, 'encodeURIComponent');
    });
    afterEach(() => {
        sandbox.restore();
    });

    it('should encrypt & decrypt strings', () => {
        const content = 'B2B_L größere Firmenkunden 25% Rabatt';
        const result = encryptor.encryptMessageContent(cryptoSettings, content);
        const decryptedResult = encryptor.decryptMessageContent(cryptoSettings, result);
        expect(decryptedResult.toString()).to.equal(content.toString());
        expect(global.decodeURIComponent).not.to.have.been.called;
        expect(global.encodeURIComponent).not.to.have.been.called;
    });

    it('should encrypt & decrypt objects', () => {
        const content = { property1: 'Hello world' };
        const result = encryptor.encryptMessageContent(cryptoSettings, content);
        const decryptedResult = encryptor.decryptMessageContent(cryptoSettings, result);
        expect(decryptedResult).to.deep.equal({ property1: 'Hello world' });
    });

    it('should encrypt & decrypt buffer', () => {
        const content = Buffer.from('Hello world');
        const result = encryptor.encryptMessageContent(cryptoSettings, content.toString());
        const decryptedResult = encryptor.decryptMessageContent(cryptoSettings, result);
        expect(decryptedResult).to.equal('Hello world');
    });

    it('should encrypt & decrypt message with buffers', () => {
        const content = {
            property1: Buffer.from('Hello world').toString()
        };
        const result = encryptor.encryptMessageContent(cryptoSettings, content);
        const decryptedResult = encryptor.decryptMessageContent(cryptoSettings, result);
        expect(decryptedResult).to.deep.equal({ property1: 'Hello world' });
    });

    it('should throw error if failed to decrypt', () => {
        let caughtError;
        try {
            encryptor.decryptMessageContent(cryptoSettings, 'dsdasdsad');
        } catch (err) {
            caughtError = err;
        }
        expect(caughtError).to.be.instanceof(Error);
        expect(caughtError.message).to.contain('Failed to decrypt message');
    });

    //eslint-disable-next-line mocha/no-skipped-tests
    it.skip('should be compatible with Java-Sailor', () => {
        // NOBODY knows why this test is skipped. I've moved it from jasmine
        //eslint-disable-next-line max-len
        const javaResult = 'wXTeSuonL1KvG7eKJ1Dk/hUHeLOhr7GMC1mGa7JyGQ9ZGg6AdjrKKn0ktoFMNVU77uB9dRd+tqqe0GNKlH8yuJrM2JWNdMbAWFHDLK5PvSRgL/negMTlmEnk/5/V5wharU8Qs9SW6rFI/E78Nkqlmqgwbd7ovHyzuOQIZj3kT4h6CW7S2fWJ559jpByhwXU1T8ZcGPOs4T+356AqYTXj8q2QgnkduKY7sNTrXNDsQUIZpm7tbBmMkoWuE6BXTitN/56TI2SVpo7TEQ/ef4c11fnrnCkpremZl4qPCCQcXD/47gMTSbSIydZCFQ584PE64pAwwn7UxloSen059tKKYF1BtGmBaqj97mHAL8izh3wsDoG8GuMRo2GhKopHnZTm';

        const data = {
            body: {
                incomingProperty1: 'incomingValue1',
                incomingProperty2: 'incomingValue2'
            },
            attachments: {
                incomingAttachment2: 'incomingAttachment2Content',
                incomingAttachment1: 'incomingAttachment1Content'
            }
        };

        expect(encryptor.decryptMessageContent(cryptoSettings, javaResult)).to.deep.equal(data);
    });
    it('should properly return encryption identifier', () => {
        expect(encryptor.getEncryptionId()).to.equal(cipher.id);
    });
});
