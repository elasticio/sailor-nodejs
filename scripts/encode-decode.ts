/**
 * Encrypts/decrypts message content with the crypto settings from `config/local.json`.
 *
 * npm run encode                              # encode the default sample message
 * npm run encode -- '{"body":{"key":"value"}}' # encode a custom JSON message
 * npm run encode -- '{"body":{}}' 1           # encode with protocol version 1 or 2
 * npm run decode -- <base64-string> [1|2]     # decode an encoded message
 */
import config from '../config/local.json' with { type: 'json' };
import { Encryptor } from '../src/crypto/index.ts';

const DEFAULT_MESSAGE = {
    headers: {
        messageHeader1: 'headerValue1',
        messageHeader2: 'headerValue2'
    },
    body: {
        dataField1: 'dataValue1',
        dataField2: 'dataValue2'
    }
};

function createEncryptor(): Encryptor {
    return new Encryptor(config.ELASTICIO_MESSAGE_CRYPTO_PASSWORD, config.ELASTICIO_MESSAGE_CRYPTO_IV);
}

export function generateEncodedMessage(body: unknown, protocolVersion = 2): Buffer {
    return createEncryptor().encryptMessageContent(body, protocolVersion < 2 ? 'base64' : undefined);
}

export function decodeMessage(encoded: Buffer, protocolVersion = 2): unknown {
    return createEncryptor().decryptMessageContent(encoded, protocolVersion < 2 ? 'base64' : undefined);
}

function parseProtocolVersion(value: string | undefined): number {
    return value ? parseInt(value, 10) : 2;
}

if (import.meta.main) {
    const [,, command, ...args] = process.argv;

    if (command === 'encode') {
        const body = args[0] ? JSON.parse(args[0]) : DEFAULT_MESSAGE;
        const encoded = generateEncodedMessage(body, parseProtocolVersion(args[1]));
        console.log('Encoded Message (base64):', encoded.toString('base64'));
    } else if (command === 'decode') {
        if (!args[0]) {
            console.error('Usage: npm run decode -- <base64-encoded-message>');
            process.exit(1);
        }
        const decoded = decodeMessage(Buffer.from(args[0], 'base64'), parseProtocolVersion(args[1]));
        console.log('Decoded Message:', JSON.stringify(decoded, null, 2));
    } else {
        console.log('Usage:');
        console.log('  npm run encode                          # encode default sample message');
        console.log('  npm run encode -- \'{"body":{"k":"v"}}\'  # encode custom JSON message');
        console.log('  npm run decode -- <base64-string>       # decode an encoded message');
    }
}
