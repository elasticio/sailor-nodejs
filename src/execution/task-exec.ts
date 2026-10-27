import { createComponentLogger, type ComponentLogger } from '../logging/index.ts';
import type { Settings } from '../settings/index.ts';
import { AwaitableEmitter } from './emitter.ts';

/** `elasticio-rest-node` client. Only what sailor itself calls is typed. */
export interface ApiClient {
    accounts: { update(accountId: unknown, body: { keys: unknown }): Promise<unknown> };
    tasks: { retrieveStep(flowId: string, stepId: string): Promise<StepData> };
    [resource: string]: unknown;
}

/** Step data from the API (`tasks.retrieveStep`). */
export interface StepData {
    config?: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
    variables?: Record<string, string>;
    is_passthrough?: boolean;
    [key: string]: unknown;
}

export interface TaskExecServices {
    apiClient: ApiClient;
    config: Settings;
}

export interface TaskExecOptions {
    loggerOptions?: Record<string, unknown>;
    variables?: Record<string, string>;
    services: TaskExecServices;
}

/** A loaded trigger or action. */
export interface TriggerOrAction {
    process?: (this: TaskExec, msg: unknown, cfg: unknown, snapshot: unknown) => unknown;
    [key: string]: unknown;
}

/** The `this` of a component's `process`: an awaitable emitter plus logger, services and flow variables. */
export class TaskExec extends AwaitableEmitter {
    errorCount = 0;
    readonly logger: ComponentLogger;
    readonly #variables: Record<string, string>;
    readonly #services: TaskExecServices;

    constructor({ loggerOptions, variables, services }: TaskExecOptions) {
        super();
        if (!services?.apiClient || !services.config) {
            throw new Error('TaskExec should be created with services (apiClient and config)');
        }
        this.logger = createComponentLogger(loggerOptions);
        // Copied to protect from outside changes.
        this.#variables = { ...variables };
        this.#services = services;
    }

    /**
     * Runs `process`. A truthy return value (or what a returned promise resolves to) is emitted
     * as `data`, then `end`. A throw or rejection becomes `error` + `end`. A falsy return means
     * the component emits `end` itself.
     */
    async process(triggerOrAction: TriggerOrAction, payload: unknown, cfg: unknown, snapshot: unknown): Promise<void> {
        const onError = async (err: unknown) => {
            this.logger.error('Error occurred during trigger or action processing');
            await this.emit('error', err);
            await this.emit('end');
        };

        const processFn = triggerOrAction.process;
        if (typeof processFn !== 'function') {
            return onError(new Error('Process function is not found'));
        }

        try {
            try {
                const data = await new Promise(resolve => {
                    const result = processFn.call(this, payload, cfg, snapshot);
                    if (result) {
                        resolve(result);
                    }
                });
                if (data) {
                    this.logger.debug('Process function is a Promise/generator/etc');
                    await this.emit('data', data);
                }
                await this.emit('end');
            } catch (err) {
                await onError(err);
            }
        } catch (err) {
            this.logger.error(err as Error, 'TaskExec: error handler failed, processing chain aborted');
        }
    }

    getApiClient(): ApiClient {
        return this.#services.apiClient;
    }

    getConfig(): Settings {
        return this.#services.config;
    }

    /** Flow variables, or an empty object. */
    getFlowVariables(): Record<string, string> {
        return this.#variables;
    }
}
