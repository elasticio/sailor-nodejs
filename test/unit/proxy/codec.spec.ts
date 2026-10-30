import { expect } from 'chai';
import { Encryptor } from '../../../src/crypto/index.ts';
import { decodeMessage, extractMessageMetadata } from '../../../src/proxy/codec.ts';
import { CRYPTO_IV, CRYPTO_PASSWORD } from './helpers.ts';

describe('proxy codec', () => {
    const encryptor = new Encryptor(CRYPTO_PASSWORD, CRYPTO_IV);

    describe('extractMessageMetadata', () => {
        it('throws when the header is missing', () => {
            expect(() => extractMessageMetadata({})).to.throw('Missing metadata in message stream response');
        });

        it('throws on invalid JSON', () => {
            expect(() => extractMessageMetadata({ 'message-metadata': '{' })).to.throw('Failed to parse metadata JSON');
        });

        it('picks known fields and lower-cases x-eio-meta-* headers', () => {
            const metadata = extractMessageMetadata({
                'message-metadata': JSON.stringify({
                    stepId: 's', threadId: 't', messageId: 'm', parentMessageId: 'p', protocolVersion: 2,
                    'X-EIO-META-Foo': 'bar', other: 'ignored', reply_to: 'r'
                })
            });
            expect(metadata).to.deep.equal({
                stepId: 's', 'x-eio-meta-foo': 'bar', threadId: 't', messageId: 'm', parentMessageId: 'p',
                protocolVersion: 2, reply_to: 'r'
            });
        });

        it('falls back to x-eio-meta-trace-id, then to a new uuid for threadId', () => {
            expect(extractMessageMetadata({ 'message-metadata': '{"x-eio-meta-trace-id":"trace"}' }).threadId)
                .to.equal('trace');
            expect(extractMessageMetadata({ 'message-metadata': '{}' }).threadId).to.match(/^[0-9a-f-]{36}$/);
        });
    });

    describe('decodeMessage', () => {
        const payload = { body: { a: 1 } };

        it('decodes protocol 1 (base64)', () => {
            const body = encryptor.encryptMessageContent(payload, 'base64');
            expect(decodeMessage(encryptor, body, { threadId: 't' }, 'default'))
                .to.deep.equal({ body: { a: 1 }, headers: {} });
        });

        it('decodes protocol 2 (raw) and adds reply_to to headers', () => {
            const body = encryptor.encryptMessageContent({ ...payload, headers: { x: 1 } });
            expect(decodeMessage(encryptor, body, { threadId: 't', protocolVersion: '2', reply_to: 'r' }, 'default'))
                .to.deep.equal({ body: { a: 1 }, headers: { x: 1, reply_to: 'r' } });
        });

        it('decodes INPUT_FORMAT=error bodies', () => {
            const body = Buffer.from(JSON.stringify({
                error: encryptor.encryptMessageContent({ message: 'boom' }, 'base64').toString(),
                errorInput: encryptor.encryptMessageContent(payload, 'base64').toString()
            }));
            expect(decodeMessage(encryptor, body, { threadId: 't', protocolVersion: 2 }, 'error')).to.deep.equal({
                error: { message: 'boom' }, errorInput: payload, headers: {}
            });
        });
    });
});
