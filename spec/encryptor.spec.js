describe('Cipher', function () {

    process.env.MESSAGE_CRYPTO_PASSWORD = 'testCryptoPassword';
    process.env.MESSAGE_CRYPTO_IV = 'iv=any16_symbols';

    var cipher = require('../lib/encryptor.js');

    it('should encrypt & decrypt strings', function () {
        var content = 'Hello world';
        var result = cipher.encryptMessageContent(content);
        var decryptedResult = cipher.decryptMessageContent(result);
        expect(decryptedResult.toString()).toEqual(content.toString());
    });

    it('should encrypt & decrypt objects', function () {
        var content = {property1: 'Hello world'};
        var result = cipher.encryptMessageContent(content);
        var decryptedResult = cipher.decryptMessageContent(result);
        expect(decryptedResult).toEqual({property1: 'Hello world'});
    });

    it('should encrypt & decrypt buffer', function () {
        var content = new Buffer('Hello world');
        var result = cipher.encryptMessageContent(content.toString());
        var decryptedResult = cipher.decryptMessageContent(result);
        expect(decryptedResult).toEqual('Hello world');
    });

    it('should encrypt & decrypt message with buffers', function () {
        var content = {
            property1: new Buffer('Hello world').toString()
        };
        var result = cipher.encryptMessageContent(content);
        var decryptedResult = cipher.decryptMessageContent(result);
        expect(decryptedResult).toEqual({property1: 'Hello world'});
    });

    it('should throw error if failed to decrypt', function () {
        var error;
        try {
            cipher.decryptMessageContent("dsdasdsad");
        } catch (err) {
            error = err;
        }
        expect(error.message).toMatch('Failed to decrypt message');
    });

    it('should be compatible with Java-Sailor', function(){

        var javaResult = "wXTeSuonL1KvG7eKJ1Dk/hUHeLOhr7GMC1mGa7JyGQ9ZGg6AdjrKKn0ktoFMNVU77uB9dRd+tqqe0GNKlH8yuJrM2JWNdMbAWFHDLK5PvSRgL/negMTlmEnk/5/V5wharU8Qs9SW6rFI/E78Nkqlmqgwbd7ovHyzuOQIZj3kT4h6CW7S2fWJ559jpByhwXU1T8ZcGPOs4T+356AqYTXj8q2QgnkduKY7sNTrXNDsQUIZpm7tbBmMkoWuE6BXTitN/56TI2SVpo7TEQ/ef4c11fnrnCkpremZl4qPCCQcXD/47gMTSbSIydZCFQ584PE64pAwwn7UxloSen059tKKYF1BtGmBaqj97mHAL8izh3wsDoG8GuMRo2GhKopHnZTm";

        var data = {
            "body": {
                "incomingProperty1": "incomingValue1",
                "incomingProperty2": "incomingValue2"
            },
            "attachments": {
                "incomingAttachment2": "incomingAttachment2Content",
                "incomingAttachment1": "incomingAttachment1Content"
            }
        };

        expect(cipher.decryptMessageContent(javaResult)).toEqual(data);
    });
});
