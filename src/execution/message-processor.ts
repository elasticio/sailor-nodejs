import type bunyan from 'bunyan';
import logging from '../logging/index.ts';
import type { Settings } from '../settings/index.ts';
import type { MessageMetadata } from '../proxy/codec.ts';
import { MESSAGE_PROCESSING_STATUS, type OutgoingMetadata } from '../proxy/client.ts';
import type { ComponentReader } from '../component/reader.ts';
import type { ComponentModule } from '../component/loader.ts';
import { createHandlers, type ExecutionState, type ProxyPort } from './handlers.ts';
import { outgoingMetadataFor } from './metadata.ts';
import type { BodyStorage, IncomingPayload, Passthrough } from './outgoing.ts';
import { TaskExec, type ApiClient, type StepData, type TriggerOrAction } from './task-exec.ts';
import { pick } from './utils.ts';

export type ReaderPort = Pick<ComponentReader, 'loadTriggerOrAction' | 'findTriggerOrActionDefinition'>;

export interface MessageProcessorDeps {
    settings: Settings;
    proxyClient: ProxyPort;
    componentReader: ReaderPort;
    storage: BodyStorage;
    apiClient: ApiClient;
}

/** Processes one incoming message: load the trigger/action, resolve lightweight bodies, run `process`. */
export class MessageProcessor implements ExecutionState {
    readonly #deps: MessageProcessorDeps;
    snapshot: Record<string, unknown> = {};
    stepData: StepData = {};
    messagesCount = 0;

    constructor(deps: MessageProcessorDeps) {
        this.#deps = deps;
    }

    /** Called after `tasks.retrieveStep`. */
    setStepData(stepData: StepData): void {
        this.stepData = stepData;
        this.snapshot = stepData.snapshot || {};
    }

    async processMessage(metadata: MessageMetadata, payload: IncomingPayload): Promise<void> {
        const { settings, proxyClient, componentReader, storage } = this.#deps;
        this.messagesCount += 1;
        const timeStart = Date.now();

        const logger = logging.child({
            threadId: metadata.threadId || 'unknown',
            messageId: metadata.messageId || 'unknown',
            parentMessageId: metadata.parentMessageId || 'unknown'
        });
        logger.trace({ messagesCount: this.messagesCount }, 'processMessage received');
        logging.debug('Trigger or action: %s', settings.FUNCTION);

        const stepData = this.stepData;
        const outgoingMetadata = outgoingMetadataFor(settings, metadata);

        const failEarly = async (e: unknown) => {
            outgoingMetadata.end = Date.now();
            try {
                await proxyClient.sendError(e as Error, outgoingMetadata, payload, metadata);
                await proxyClient.finishProcessing(metadata, MESSAGE_PROCESSING_STATUS.ERROR);
            } finally {
                this.messagesCount -= 1;
            }
        };

        let module: ComponentModule;
        try {
            module = await componentReader.loadTriggerOrAction(settings.FUNCTION);
        } catch (e) {
            logging.error(e);
            return failEarly(e);
        }

        const definition = componentReader.findTriggerOrActionDefinition(settings.FUNCTION);
        if (definition.autoResolveObjectReferences) {
            const { passthrough } = payload;
            try {
                await Promise.all([
                    (async () => {
                        logger.trace('Going to check if incoming message body is lightweight.');
                        payload.body = await storage.fetchMessageBody(payload, logger);
                    })(),
                    ...Object.keys(passthrough ?? {}).map(async stepId => {
                        logger.trace('Going to check if passthrough for step is lightweight.', { stepId });
                        passthrough![stepId]!.body = await storage.fetchMessageBody(passthrough![stepId]!, logger);
                    })
                ]);
            } catch (e) {
                logger.error(e);
                return failEarly(e);
            }
        }

        await this.runExec(module as TriggerOrAction, payload, metadata, outgoingMetadata, stepData, timeStart, logger);
    }

    async runExec(module: TriggerOrAction, payload: IncomingPayload, metadata: MessageMetadata,
        outgoingMetadata: OutgoingMetadata, stepData: StepData, timeStart: number,
        logger: bunyan): Promise<void> {
        logging.debug({ metadata }, 'runExec started');
        const { settings, proxyClient, storage, apiClient } = this.#deps;
        const origPassthrough: Passthrough = structuredClone(payload.passthrough) || {};
        const cfg: Record<string, unknown> = structuredClone(stepData.config) || {};
        const snapshot = structuredClone(this.snapshot);

        await new Promise<void>(resolve => {
            const taskExec = new TaskExec({
                loggerOptions: pick(metadata, ['threadId', 'messageId', 'parentMessageId']),
                variables: stepData.variables,
                services: { apiClient, config: settings }
            });
            const handlers = createHandlers({
                settings, proxyClient, storage, apiClient, stepData, metadata, payload, origPassthrough,
                outgoingMetadata, cfg, timeStart, state: this, taskExec, logger
            }, resolve);
            for (const [event, handler] of Object.entries(handlers)) {
                taskExec.on(event, handler);
            }
            void taskExec.process(module, payload, cfg, snapshot);
        });
    }
}
