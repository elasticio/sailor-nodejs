import type bunyan from 'bunyan';
import type { Settings } from '../settings/index.ts';
import type { MessageMetadata } from '../proxy/codec.ts';
import { OBJECT_ID_HEADER, type MessageStorage } from '../storage/index.ts';
import type { StepData } from './task-exec.ts';
import { isEmpty, omit } from './utils.ts';

export interface PassthroughEntry {
    body?: unknown;
    headers?: Record<string, unknown>;
    [key: string]: unknown;
}

export type Passthrough = Record<string, PassthroughEntry>;

/** A decoded incoming message. */
export interface IncomingPayload {
    body?: unknown;
    headers: Record<string, unknown>;
    passthrough?: Passthrough;
    [key: string]: unknown;
}

/** What a component emits as `data`. Mutated in place on the way out, as before. */
export interface OutgoingDataMessage {
    id?: string;
    body?: unknown;
    headers?: Record<string, unknown>;
    passthrough?: Passthrough;
    [key: string]: unknown;
}

export type BodyStorage = Pick<MessageStorage, 'fetchMessageBody' | 'uploadMessageBody'>;

export interface OutgoingContext {
    settings: Settings;
    storage: BodyStorage;
    stepData: StepData;
    metadata: MessageMetadata;
    payload: IncomingPayload;
    /** Deep copy of the incoming passthrough, taken before `process` ran. */
    origPassthrough: Passthrough;
    logger: bunyan;
}

function toBuffer(body: unknown): Buffer {
    return Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf-8');
}

/**
 * The `data` pipeline before sending: passthrough (incl. `NO_SELF_PASSTHROUGH`), then either
 * uploading big bodies to Maester (`EMIT_LIGHTWEIGHT_MESSAGE`) or downloading lightweight
 * passthrough bodies. Throws the error to report as `error`.
 */
export async function prepareOutgoingData(data: OutgoingDataMessage, ctx: OutgoingContext): Promise<void> {
    const { settings, storage, stepData, metadata, payload, origPassthrough, logger } = ctx;

    if (stepData.is_passthrough === true) {
        data.passthrough = { ...origPassthrough };
        if (settings.NO_SELF_PASSTHROUGH) {
            const { stepId } = metadata;
            if (stepId) {
                data.passthrough = { ...origPassthrough, [stepId]: { ...omit(payload, 'passthrough') } };
            }
        }
    }

    data.headers = data.headers || {};
    const { body, passthrough = {} } = data;

    if (settings.EMIT_LIGHTWEIGHT_MESSAGE) {
        await uploadIfAboveThreshold(data, body, passthrough, ctx);
    } else {
        logger.trace('Outgoing lightweight is disabled, going to download all bodies.');
        await Promise.all(Object.keys(passthrough).map(async stepId => {
            logger.trace('Going to check if passthrough for step is lightweight.', { stepId });
            // A non-empty body was downloaded before processing, no need to download again.
            if (!isEmpty(data.passthrough![stepId]!.body)) {
                logger.trace('Body is not empty.', { stepId });
                return;
            }
            data.passthrough![stepId]!.body = await storage.fetchMessageBody(passthrough[stepId]!, logger);
        }));
    }

    if (stepData.is_passthrough === true && !settings.NO_SELF_PASSTHROUGH) {
        data.passthrough = { ...origPassthrough, [settings.STEP_ID]: { ...omit(data, 'passthrough') } };
    }
}

async function uploadIfAboveThreshold(
    data: OutgoingDataMessage, body: unknown, passthrough: Passthrough, ctx: OutgoingContext
): Promise<void> {
    const { settings, storage, logger } = ctx;
    const threshold = settings.OBJECT_STORAGE_SIZE_THRESHOLD;

    logger.trace('Outgoing lightweight is enabled, going to check size.');
    const bodyBuf = toBuffer(body);
    const passthroughBufs = Object.keys(passthrough).map(stepId => ({
        stepId,
        body: toBuffer(passthrough[stepId]!.body),
        id: passthrough[stepId]!.headers?.[OBJECT_ID_HEADER] as string | undefined
    }));
    const totalLength = passthroughBufs.reduce((len, { body }) => len + body.length, bodyBuf.length);

    if (totalLength <= threshold) {
        logger.trace('Message size is below threshold.', { totalLength, OBJECT_STORAGE_SIZE_THRESHOLD: threshold });
        return;
    }
    logger.debug('Message size is above threshold, going to upload',
        { totalLength, OBJECT_STORAGE_SIZE_THRESHOLD: threshold });

    let bodyId: string;
    let passthroughIds: { stepId: string; bodyId: string }[];
    try {
        [bodyId, ...passthroughIds] = await Promise.all([
            storage.uploadMessageBody(bodyBuf),
            ...passthroughBufs.map(async ({ stepId, body, id }) => ({
                stepId,
                bodyId: id || await storage.uploadMessageBody(body)
            }))
        ]) as [string, ...{ stepId: string; bodyId: string }[]];
    } catch (e) {
        logger.error(e, 'Error during message/passthrough body upload');
        throw new Error('Lightweight message/passthrough body upload error');
    }

    logger.debug({ id: bodyId }, 'Message body uploaded');
    data.body = {};
    data.headers = { ...data.headers, [OBJECT_ID_HEADER]: bodyId };

    for (const { stepId, bodyId: id } of passthroughIds) {
        logger.debug('Passthrough Message body uploaded', { stepId, id });
        const { headers } = passthrough[stepId]!;
        data.passthrough![stepId]!.body = {};
        data.passthrough![stepId]!.headers = { ...headers, [OBJECT_ID_HEADER]: id };
    }
}
