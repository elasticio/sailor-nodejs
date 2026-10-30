import fs from 'node:fs/promises';
import path from 'node:path';
import logging from '../logging/index.ts';
import { findModule, loadModule, type ComponentModule } from './loader.ts';

export interface TriggerOrActionDefinition {
    readonly main: string;
    readonly autoResolveObjectReferences: boolean;
    readonly [key: string]: unknown;
}

export interface ComponentJson {
    readonly triggers?: Record<string, Partial<TriggerOrActionDefinition>>;
    readonly actions?: Record<string, Partial<TriggerOrActionDefinition>>;
    readonly [key: string]: unknown;
}

export type VerifyCredentials = (this: unknown, cfg: unknown, cb: (err?: unknown, result?: unknown) => void) => unknown;

/** Used when the component has no `verifyCredentials` module. */
const verifyStub: VerifyCredentials = (_cfg, cb) => cb(null, { verified: true });

function isModuleNotFound(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
}

/** Reads `component.json` and loads the trigger/action and `verifyCredentials` modules it points at. */
export class ComponentReader {
    componentPath: string | null = null;
    componentJson: ComponentJson | null = null;

    /** `componentPath` is relative to the working directory (`COMPONENT_PATH`). */
    async init(componentPath?: string): Promise<void> {
        this.componentPath = path.join(process.cwd(), componentPath || '');
        logging.debug('Component path is: %s', this.componentPath);
        logging.trace('Root files: %j', await fs.readdir(this.componentPath));

        const componentJsonPath = path.join(this.componentPath, 'component.json');
        try {
            this.componentJson = JSON.parse(await fs.readFile(componentJsonPath, 'utf-8')) as ComponentJson;
        } catch {
            throw new Error(`Failed to load component.json from ${this.componentPath}`);
        }
        logging.debug('Successfully loaded %s', componentJsonPath);
        logging.debug('Triggers: %j', Object.keys(this.componentJson.triggers ?? {}));
        logging.debug('Actions: %j', Object.keys(this.componentJson.actions ?? {}));
    }

    findTriggerOrActionDefinition(name: string): TriggerOrActionDefinition {
        if (this.componentJson === null) {
            throw new Error('Component.json was not loaded');
        }
        const { triggers, actions } = this.componentJson;
        const def = triggers?.[name] ?? actions?.[name];
        if (!def) {
            throw new Error(`Trigger or action "${name}" is not found in component.json!`);
        }
        return { autoResolveObjectReferences: true, ...def } as TriggerOrActionDefinition;
    }

    findTriggerOrAction(name: string): string {
        return this.findTriggerOrActionDefinition(name).main;
    }

    async loadTriggerOrAction(name: string): Promise<ComponentModule> {
        let filename: string;
        let modulePath: string;
        try {
            filename = this.findTriggerOrAction(name);
            modulePath = path.join(this.componentPath!, filename);
        } catch (err) {
            logging.trace(err);
            throw err;
        }

        try {
            logging.trace('Trying to find module at: %s', modulePath);
            return await loadModule(modulePath);
        } catch (err) {
            const e = err as NodeJS.ErrnoException;
            if (isModuleNotFound(e)) {
                e.code = 'MODULE_NOT_FOUND';
                e.message = `Failed to load file '${filename}': ${e.message}`;
            } else {
                e.message = `Trigger or action '${name}' is found, but can not be loaded. `
                    + `Please check if the file '${filename}' is correct.`;
            }
            logging.trace(e);
            throw e;
        }
    }

    /**
     * Falls back to a stub that always verifies only when the component has no `verifyCredentials`.
     * A module that exists but fails to load (syntax error, missing dependency) rejects.
     */
    async loadVerifyCredentials(): Promise<VerifyCredentials> {
        const modulePath = path.join(this.componentPath!, 'verifyCredentials');
        logging.trace('Trying to find verifyCredentials.js at: %s', modulePath);
        const resolved = findModule(modulePath);
        if (!resolved) {
            logging.trace('verifyCredentials not found, using the stub');
            return verifyStub;
        }
        return await loadModule(resolved) as VerifyCredentials;
    }
}
