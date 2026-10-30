import type { ComponentLogger } from '../logging/index.ts';
import type { ComponentModule } from '../component/loader.ts';
import type { ApiClient } from '../execution/task-exec.ts';
import type { Settings } from '../settings/index.ts';
import _ from 'lodash';
import type { HooksData } from './hooks-data.ts';

export type HookName = 'startup' | 'init' | 'shutdown';

/** The `this` of `startup`/`init`/`shutdown` (B7). Hooks that ignore `this` keep working. */
export interface HookContext {
    readonly logger: ComponentLogger;
    getApiClient(): ApiClient;
    getConfig(): Settings;
}

export type Hook = (this: HookContext, cfg: Record<string, unknown>, data?: unknown) => unknown;

/** Sailor (bunyan) logger subset. */
export interface HooksLogger {
    debug(msg: string): unknown;
    trace(msg: string): unknown;
    warn(msg: string): unknown;
}

export interface LifecycleOptions {
    /** Loads the step's trigger/action (`ComponentReader#loadTriggerOrAction(FUNCTION)`). */
    loadModule(): Promise<ComponentModule>;
    /** The step config; called per hook, so it reflects step data fetched after construction. */
    getStepConfig(): Record<string, unknown> | undefined;
    hooksData: Pick<HooksData, 'create' | 'retrieve' | 'delete'>;
    context: HookContext;
    logger: HooksLogger;
}

/** Runs the component's `startup`, `init` and `shutdown` hooks. */
export class Lifecycle {
    readonly #options: LifecycleOptions;

    constructor(options: LifecycleOptions) {
        this.#options = options;
    }

    /** Runs `startup` and stores its result as startup data (`{}` when empty). 409 → delete, store again (B8). */
    async startup(): Promise<unknown> {
        const { hooksData, logger } = this.#options;
        logger.debug('Starting up component');
        const result = await this.invoke('startup');
        logger.trace('Startup data received');
        const state = _.isEmpty(result) ? {} : result;
        try {
            await hooksData.create(state);
        } catch (err) {
            if ((err as { statusCode?: number }).statusCode !== 409) {
                logger.warn('Component starting error');
                throw err;
            }
            logger.warn('Startup data already exists. Rewriting.');
            await hooksData.delete();
            await hooksData.create(state);
        }
        logger.debug('Component started up');
        return result;
    }

    async init(): Promise<unknown> {
        const { logger } = this.#options;
        logger.debug('About to initialize component for execution');
        const result = await this.invoke('init');
        logger.debug('Component execution initialized successfully');
        return result;
    }

    /** `HOOK_SHUTDOWN` mode: retrieve startup data → `shutdown(cfg, data)` → delete it. */
    async shutdown(): Promise<void> {
        const { hooksData, logger } = this.#options;
        logger.debug('About to shut down');
        const state = await hooksData.retrieve();
        await this.invoke('shutdown', state);
        await hooksData.delete();
        logger.debug('Shut down successfully');
    }

    /** Calls a hook with a deep copy of the step config. A missing hook warns and resolves to `undefined`. */
    async invoke(name: HookName, data?: unknown): Promise<unknown> {
        const { loadModule, getStepConfig, context, logger } = this.#options;
        const module = await loadModule() as Record<string, unknown>;
        const hook = module[name];
        if (typeof hook !== 'function') {
            logger.warn(`invokeModuleFunction – ${name} is not found`);
            return undefined;
        }
        const cfg = structuredClone(getStepConfig()) ?? {};
        return (hook as Hook).call(context, cfg, data);
    }
}
