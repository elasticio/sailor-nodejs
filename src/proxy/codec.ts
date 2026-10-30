import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http2';
import logging from '../logging/index.ts';
import type { Encryptor } from '../crypto/index.ts';

export const MESSAGE_METADATA_HEADER = 'message-metadata';
export const HEADER_ROUTING_KEY = 'x-eio-routing-key';
const AMQP_HEADER_META_PREFIX = 'x-eio-meta-';

/** Metadata of an incoming message, taken from the `message-metadata` response header. */
export interface MessageMetadata {
    stepId?: string;
    threadId: string;
    messageId?: string;
    parentMessageId?: string;
    protocolVersion?: number | string;
    reply_to?: string;
    /** `x-eio-meta-*` headers, lower-cased. */
    [metaHeader: `x-eio-meta-${string}`]: unknown;
}

export interface DecodedMessage {
    headers: Record<string, unknown>;
    [key: string]: unknown;
}

export function lowerCaseKeys<T>(obj: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
}

export function extractMessageMetadata(headers: IncomingHttpHeaders): MessageMetadata {
    logging.trace({ headers }, 'Extracting message metadata');
    const raw = headers[MESSAGE_METADATA_HEADER];
    if (!raw) {
        logging.error({ headers }, 'Missing metadata in message stream response');
        throw new Error('Missing metadata in message stream response');
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(String(raw));
    } catch {
        logging.error({ messageMetadata: raw }, 'Failed to parse metadata JSON');
        throw new Error('Failed to parse metadata JSON');
    }
    logging.debug({ parsedMessageMetadata: parsed }, 'Parsed metadata from header');

    const metaHeaders = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => key.toLowerCase().startsWith(AMQP_HEADER_META_PREFIX))
    );

    const result = {
        stepId: parsed.stepId,
        ...lowerCaseKeys(metaHeaders),
        threadId: parsed.threadId || metaHeaders['x-eio-meta-trace-id'],
        messageId: parsed.messageId,
        parentMessageId: parsed.parentMessageId,
        protocolVersion: parsed.protocolVersion
    } as MessageMetadata;
    if (!result.threadId) {
        result.threadId = randomUUID();
        logging.debug({ threadId: result.threadId }, 'Initiate new thread as it is not started ATM');
    }
    if (parsed.reply_to) {
        result.reply_to = parsed.reply_to as string;
    }
    logging.debug({ result }, 'Extracted message metadata');
    return result;
}

export function protocolVersionOf(metadata: { protocolVersion?: number | string } | undefined): number {
    return Number(metadata?.protocolVersion || 1);
}

/** Protocol < 2 is base64 on the wire, protocol 2 is raw ciphertext. */
export function encodingFor(protocolVersion: number): 'base64' | undefined {
    return protocolVersion < 2 ? 'base64' : undefined;
}

/**
 * Decodes an incoming message body. With INPUT_FORMAT=error the body is JSON whose `error` and
 * `errorInput` are base64 ciphertext regardless of the protocol version.
 */
export function decodeMessage(
    encryptor: Encryptor, body: Buffer, metadata: MessageMetadata, inputFormat: string
): DecodedMessage {
    logging.trace('Message received');
    const message = (inputFormat === 'error'
        ? decodeErrorMessage(encryptor, body)
        : decodeDefaultMessage(encryptor, body, metadata)) as DecodedMessage;
    message.headers = message.headers || {};
    if (metadata.reply_to) {
        message.headers.reply_to = metadata.reply_to;
    }
    return message;
}

function decodeDefaultMessage(encryptor: Encryptor, body: Buffer, metadata: MessageMetadata): unknown {
    const protocolVersion = protocolVersionOf(metadata);
    logging.debug({ metadata, protocolVersion }, 'Decoding message with protocol version');
    return encryptor.decryptMessageContent(body, encodingFor(protocolVersion));
}

function decodeErrorMessage(encryptor: Encryptor, body: Buffer): unknown {
    const errorBody = JSON.parse(body.toString());
    if (errorBody.error) {
        errorBody.error = encryptor.decryptMessageContent(Buffer.from(errorBody.error), 'base64');
    }
    if (errorBody.errorInput) {
        errorBody.errorInput = encryptor.decryptMessageContent(Buffer.from(errorBody.errorInput), 'base64');
    }
    return errorBody;
}
