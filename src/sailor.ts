import assert from 'node:assert';
import restNode from 'elasticio-rest-node';
import logging, { createComponentLogger } from './logging/index.ts';
import type { Settings } from './settings/index.ts';
import { Encryptor } from './crypto/index.ts';
import { ProxyClient, type MessageHandler, type ProxyClientOptions } from './proxy/client.ts';
import type { MessageMetadata } from './proxy/codec.ts';
import { ComponentReader } from './component/reader.ts';
import { MessageStorage } from './storage/index.ts';
import { MessageProcessor } from './execution/message-processor.ts';
import { stepMetadata } from './execution/metadata.ts';
import type { IncomingPayload } from './execution/outgoing.ts';
import type { ApiClient } from './execution/task-exec.ts';
import { HooksData } from './hooks/hooks-data.ts';
import { Lifecycle } from './hooks/lifecycle.ts';

export type SailorProxyPort = Pick<ProxyClient,
    'connect' | 'disconnect' | 'isHealthy' | 'listenForMessages' | 'stopListeningForMessages' | 'sendError'>;

export type SailorProcessorPort = Pick<MessageProcessor, 'setStepData' | 'processMessage' | 'messagesCount'>;

export type SailorLifecyclePort = Pick<Lifecycle, 'startup' | 'init' | 'shutdown'>;

export interface SailorDeps {
    settings: Settings;
    proxyClient: SailorProxyPort;
    componentReader: Pick<ComponentReader, 'init'>;
    apiClient: Pick<ApiClient, 'tasks'>;
    processor: SailorProcessorPort;
    lifecycle: SailorLifecyclePort;
}

/**
 * Orchestration: connect, prepare (step data + component), hooks, listen, graceful shutdown,
 * disconnect, report errors. Message processing is `MessageProcessor`'s, hooks are `Lifecycle`'s.
 */
export class Sailor {
    readonly #deps: SailorDeps;
    #shutdown: PromiseWithResolvers<void> | null = null;

    constructor(deps: SailorDeps) {
        this.#deps = deps;
    }

    get messagesCount(): number {
        return this.#deps.processor.messagesCount;
    }

    connect(): Promise<void> {
        return this.#deps.proxyClient.connect();
    }

    isConnected(): boolean {
        return this.#deps.proxyClient.isHealthy();
    }

    async prepare(): Promise<void> {
        logging.trace('prepare sailor');
        // TODO: check if retry flow works with actual retry flow id, not the original flow id
        const { settings: { COMPONENT_PATH, FLOW_ID, STEP_ID }, apiClient, processor, componentReader } = this.#deps;

        const stepData = await apiClient.tasks.retrieveStep(FLOW_ID, STEP_ID);
        logging.debug('Received step data');
        assert(stepData);
        processor.setStepData(stepData);

        await componentReader.init(COMPONENT_PATH);
    }

    disconnect(): Promise<void> {
        logging.debug('Disconnecting, %s messages in processing', this.messagesCount);
        return this.#deps.proxyClient.disconnect();
    }

    reportError(err: Error): Promise<void> {
        return this.#deps.proxyClient.sendError(err, stepMetadata(this.#deps.settings));
    }

    startup(): Promise<unknown> {
        return this.#deps.lifecycle.startup();
    }

    runHookInit(): Promise<unknown> {
        return this.#deps.lifecycle.init();
    }

    runHookShutdown(): Promise<void> {
        return this.#deps.lifecycle.shutdown();
    }

    run(): Promise<void> {
        logging.debug('Start listening for messages');
        const handler: MessageHandler = (metadata, message) =>
            this.processMessageAndMaybeShutdownCallback(metadata, message as IncomingPayload);
        return this.#deps.proxyClient.listenForMessages(handler);
    }

    async processMessageAndMaybeShutdownCallback(metadata: MessageMetadata, payload: IncomingPayload): Promise<void> {
        try {
            await this.#deps.processor.processMessage(metadata, payload);
        } catch (e) {
            logging.error(e, 'Something very bad happened during message processing');
        } finally {
            logging.debug({ messagesCount: this.messagesCount },
                'Finished processing message, checking if shutdown should be resolved');
            this.#maybeResolveShutdown();
        }
    }

    /**
     * Stops listening and resolves once no message is in flight. Idempotent (B11): every call
     * returns the same promise, so every caller is released. Rejects if stopping to listen fails.
     */
    scheduleShutdown(): Promise<void> {
        if (this.#shutdown) {
            logging.debug('scheduleShutdown – shutdown is already scheduled');
            return this.#shutdown.promise;
        }
        const shutdown = Promise.withResolvers<void>();
        this.#shutdown = shutdown;
        this.#deps.proxyClient.stopListeningForMessages().then(
            // Re-checked after the await: a message may have finished meanwhile.
            () => this.#maybeResolveShutdown(),
            (err: unknown) => shutdown.reject(err)
        );
        return shutdown.promise;
    }

    #maybeResolveShutdown(): void {
        if (!this.#shutdown) {
            return;
        }
        if (this.messagesCount === 0) {
            // Resolving twice is a no-op.
            logging.debug('Resolving scheduled shutdown');
            this.#shutdown.resolve();
        } else {
            logging.debug('Shutdown scheduled, %s messages still in processing', this.messagesCount);
        }
    }
}

export interface CreateSailorOptions {
    proxyClientOptions?: ProxyClientOptions;
}

/** Wires the real collaborators. */
export function createSailor(settings: Settings, options: CreateSailorOptions = {}): Sailor {
    const encryptor = new Encryptor(settings.MESSAGE_CRYPTO_PASSWORD, settings.MESSAGE_CRYPTO_IV);
    const proxyClient = new ProxyClient(settings, { encryptor, ...options.proxyClientOptions });
    const componentReader = new ComponentReader();
    const apiClient = restNode(settings.API_USERNAME, settings.API_KEY, {
        retryCount: settings.API_REQUEST_RETRY_ATTEMPTS,
        retryDelay: settings.API_REQUEST_RETRY_DELAY
    }) as ApiClient;
    const storage = MessageStorage.create(settings, encryptor);
    const processor = new MessageProcessor({ settings, proxyClient, componentReader, storage, apiClient });
    const lifecycle = new Lifecycle({
        loadModule: () => componentReader.loadTriggerOrAction(settings.FUNCTION),
        getStepConfig: () => processor.stepData.config,
        hooksData: new HooksData(settings),
        context: {
            logger: createComponentLogger(),
            getApiClient: () => apiClient,
            getConfig: () => settings
        },
        logger: logging
    });
    return new Sailor({ settings, proxyClient, componentReader, apiClient, processor, lifecycle });
}
