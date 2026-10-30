import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** What a trigger/action/verifyCredentials module exports, after CJS `default` unwrapping. */
export type ComponentModule = Record<string, unknown> | ((...args: unknown[]) => unknown);

const require = createRequire(import.meta.url);

/**
 * Loads a component module with `import()` (ADR 0001). The path is resolved the CommonJS way
 * first, so `main` entries without an extension or pointing at a directory keep working.
 * Node caches the module, so its state survives between messages.
 *
 * CJS modules come back as `{ default: module.exports, ... }`: `default` is unwrapped, so
 * `module.exports = fn` and `exports.process = ...` both work. ESM modules give their default
 * export if they have one, otherwise the namespace (named exports).
 */
/** Resolves like `require.resolve`; `null` when the module itself does not exist. */
export function findModule(modulePath: string): string | null {
    try {
        return require.resolve(modulePath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
            return null;
        }
        throw err;
    }
}

export async function loadModule(modulePath: string): Promise<ComponentModule> {
    const resolved = require.resolve(modulePath);
    const ns = await import(pathToFileURL(resolved).href) as { default?: unknown };
    return (ns.default ?? ns) as ComponentModule;
}
