/** Small replacements for the lodash helpers the old code used. */

export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
    const result = {} as Pick<T, K>;
    for (const key of keys) {
        if (key in obj) {
            result[key] = obj[key];
        }
    }
    return result;
}

export function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
    const rest = { ...obj };
    delete rest[key];
    return rest;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}

/** Like `_.isEmpty`: nullish, empty string/array/Map/Set, an object without own keys, or any other primitive. */
export function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === 'string' || Array.isArray(value)) {
        return value.length === 0;
    }
    if (value instanceof Map || value instanceof Set) {
        return value.size === 0;
    }
    if (typeof value === 'object') {
        return Object.keys(value).length === 0;
    }
    return true;
}

/** Like `_.snakeCase` for env-var-style names: `SECOND_ELASTICIO_ENV` → `second_elasticio_env`, `VAR1` → `var_1`. */
export function snakeCase(value: string): string {
    const words = value.match(/[A-Z]{2,}(?=[A-Z][a-z]+|\d|\b|_)|[A-Z]?[a-z]+|[A-Z]+|\d+/g) ?? [];
    return words.map(w => w.toLowerCase()).join('_');
}
