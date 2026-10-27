import type bunyan from 'bunyan';
import logging from '../logging/index.ts';
import type { MessageMetadata } from '../proxy/codec.ts';
import { MESSAGE_PROCESSING_STATUS, type OutgoingMetadata, type ProxyClient } from '../proxy/client.ts';
import { prepareOutgoingData, type OutgoingContext, type OutgoingDataMessage } from './outgoing.ts';
import type { ApiClient, TaskExec } from './task-exec.ts';
import { isPlainObject } from './utils.ts';

export type ProxyPort = Pick<ProxyClient,
    'sendMessage' | 'sendError' | 'sendRebound' | 'sendSnapshot' | 'finishProcessing'>;

/** State shared between messages: the step snapshot and the in-flight message count. */
export interface ExecutionState {
    snapshot: Record<string, unknown>;
    messagesCount: number;
}

export interface HandlerContext extends OutgoingContext {
    proxyClient: ProxyPort;
    apiClient: ApiClient;
    outgoingMetadata: OutgoingMetadata;
    cfg: Record<string, unknown>;
    timeStart: number;
    state: ExecutionState;
    taskExec: TaskExec;
    logger: bunyan;
}

export interface FormattedError {
    message: string;
    stack: string;
    name: string;
}

export function formatError(err: unknown): FormattedError {
    if (err instanceof Error || (typeof err === 'object' && err !== null && Object.hasOwn(err, 'message'))) {
        const e = err as Partial<Error>;
        return { message: e.message!, stack: e.stack || 'Not Available', name: e.name || 'Error' };
    }
    return { message: (err || 'Not Available') as string, stack: 'Not Available', name: 'Error' };
}

interface CustomTypeEvent {
    type: Parameters<ProxyClient['sendMessage']>[0]['type'];
    payload?: Parameters<ProxyClient['sendMessage']>[0]['data'];
    protocolVersion?: number;
}

/**
 * Listeners for every event a component can emit while processing one message.
 * `end` (first one only) finishes processing and calls `onFinished`.
 */
export function createHandlers(ctx: HandlerContext, onFinished: () => void) {
    const { proxyClient, metadata, outgoingMetadata, payload, timeStart, state, taskExec, logger } = ctx;
    let endWasEmitted = false;
    const metadataCopy = (): OutgoingMetadata => ({ ...outgoingMetadata });

    async function onData(data: OutgoingDataMessage): Promise<void> {
        const metadataToSend = metadataCopy();
        if (data.id) {
            metadataToSend.messageId = data.id;
        }
        logger.trace({ messagesCount: state.messagesCount, messageProcessingTime: Date.now() - timeStart },
            'processMessage emit data');
        metadataToSend.end = Date.now();

        try {
            await prepareOutgoingData(data, ctx);
            logging.trace('Going to send outgoing message');
            await proxyClient.sendMessage({
                incomingMessageId: metadata.messageId,
                data,
                metadata: metadataToSend,
                type: 'data'
            });
            logging.trace('Outgoing message sent');
        } catch (err) {
            return onError(err);
        }
    }

    async function onHttpReply(reply: OutgoingDataMessage): Promise<void> {
        logger.trace({ messageProcessingTime: Date.now() - timeStart }, 'processMessage emit HttpReply');
        return proxyClient.sendMessage({
            incomingMessageId: metadata.messageId,
            data: reply,
            metadata: metadataCopy(),
            type: 'http-reply'
        });
    }

    async function onError(error: unknown): Promise<void> {
        const metadataToSend = metadataCopy();
        const err = formatError(error);
        taskExec.errorCount++;
        logger.trace({ err, messagesCount: state.messagesCount, messageProcessingTime: Date.now() - timeStart },
            'processMessage emit error');
        metadataToSend.end = Date.now();
        return proxyClient.sendError(err as Error, metadataToSend, payload, metadata);
    }

    async function onRebound(error: unknown): Promise<void> {
        const err = formatError(error);
        logger.trace({ err, messagesCount: state.messagesCount, messageProcessingTime: Date.now() - timeStart },
            'processMessage emit rebound');
        return proxyClient.sendRebound(err as Error, metadata, metadataCopy());
    }

    async function onSnapshot(data: Record<string, unknown>): Promise<void> {
        const metadataToSend = metadataCopy();
        metadataToSend.snapshotEvent = 'snapshot';
        state.snapshot = data; // replaces the local snapshot
        return proxyClient.sendSnapshot(data, metadataToSend);
    }

    async function onUpdateSnapshot(data: unknown): Promise<void> {
        const metadataToSend = metadataCopy();
        metadataToSend.snapshotEvent = 'updateSnapshot';
        if (!isPlainObject(data)) {
            logging.error('You should pass an object to the `updateSnapshot` event');
            return;
        }
        if (data.$set) {
            logging.warn('ERROR: $set is not supported any more in `updateSnapshot` event');
            return;
        }
        Object.assign(state.snapshot, data); // updates the local snapshot
        return proxyClient.sendSnapshot(data, metadataToSend);
    }

    async function onUpdateKeys(keys: unknown): Promise<void> {
        logger.trace({ messageProcessingTime: Date.now() - timeStart }, 'processMessage emit updateKeys');
        try {
            await ctx.apiClient.accounts.update(ctx.cfg._account, { keys });
            logger.debug({ messageId: metadata.messageId }, 'Successfully updated keys');
        } catch (error) {
            logger.debug({ messageId: metadata.messageId }, 'Failed to update keys');
            await onError(error);
        }
    }

    async function onEnd(): Promise<void> {
        if (endWasEmitted) {
            logger.warn({
                messagesCount: state.messagesCount,
                errorCount: taskExec.errorCount,
                messageProcessingTime: Date.now() - timeStart
            }, 'processMessage emit end was called more than once');
            return;
        }
        endWasEmitted = true;

        await proxyClient.finishProcessing(metadata as MessageMetadata,
            taskExec.errorCount > 0 ? MESSAGE_PROCESSING_STATUS.ERROR : MESSAGE_PROCESSING_STATUS.SUCCESS);
        state.messagesCount -= 1;
        logger.trace({
            messagesCount: state.messagesCount,
            errorCount: taskExec.errorCount,
            messageProcessingTime: Date.now() - timeStart
        }, 'processMessage emit end');
        onFinished();
    }

    async function onCustomType({ type, payload: data, protocolVersion = 2 }: CustomTypeEvent): Promise<void> {
        logger.trace({ type, messageProcessingTime: Date.now() - timeStart }, 'processMessage emit customType');
        return proxyClient.sendMessage({
            incomingMessageId: metadata.messageId,
            data,
            metadata: metadataCopy(),
            type,
            forceProtocolVersion: protocolVersion
        });
    }

    return {
        data: onData,
        error: onError,
        rebound: onRebound,
        snapshot: onSnapshot,
        updateSnapshot: onUpdateSnapshot,
        updateKeys: onUpdateKeys,
        httpReply: onHttpReply,
        customType: onCustomType,
        end: onEnd
    };
}
