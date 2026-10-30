import { randomUUID } from 'node:crypto';

export const PREFIX = 'ELASTICIO_';

/** One random id per process, shared by settings and the logger. */
export const PROXY_CLIENT_ID: string = randomUUID();

export type Env = Readonly<Record<string, string | undefined>>;

interface NumberSpec {
    readonly default: number;
    /** Smallest accepted value (inclusive). */
    readonly min: number;
    /** Largest accepted value (inclusive). */
    readonly max?: number;
    readonly integer: boolean;
}

const int = (def: number, min = 0, max?: number): NumberSpec => ({ default: def, min, max, integer: true });
const float = (def: number, min = 0): NumberSpec => ({ default: def, min, integer: false });

const OPTIONAL_NUMBERS = {
    PROXY_PREFETCH_SAILOR: int(1, 1),
    API_REQUEST_RETRY_ATTEMPTS: int(3),
    API_REQUEST_RETRY_DELAY: int(100),
    PROXY_RECONNECT_MAX_RETRIES: int(Infinity),
    PROXY_RECONNECT_INITIAL_DELAY: int(1000),
    PROXY_RECONNECT_MAX_DELAY: int(30 * 1000), // 30 seconds
    PROXY_RECONNECT_BACKOFF_MULTIPLIER: float(2, 1),
    PROXY_RECONNECT_JITTER_FACTOR: float(0.3),
    PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS: int(Infinity),
    PROXY_OBJECT_REQUEST_RETRY_DELAY: int(100),
    PROXY_OBJECT_REQUEST_MAX_RETRY_DELAY: int(5 * 60 * 1000), // 5 mins
    PROXY_PING_INTERVAL_MS: int(10000, 1), // 10s between HTTP/2 PING frames

    DATA_RATE_LIMIT: int(10, 1), // 10 data events every 100ms
    ERROR_RATE_LIMIT: int(2, 1), // 2 errors every 100ms
    SNAPSHOT_RATE_LIMIT: int(2, 1), // 2 Snapshots every 100ms
    RATE_INTERVAL: int(100, 1), // 100ms

    OBJECT_STORAGE_SIZE_THRESHOLD: int(1048576),
    // Passed to maester-client as retryOptions; ranges and defaults are maester-client's own.
    OBJECT_STORAGE_RETRY_ATTEMPTS: int(2, 0, 4),
    OBJECT_STORAGE_REQUEST_TIMEOUT: int(10000, 500, 20000), // 10s
    PROTOCOL_VERSION: int(1, 1)
} as const satisfies Record<string, NumberSpec>;

const OPTIONAL_BOOLEANS = {
    STARTUP_REQUIRED: false,
    HOOK_SHUTDOWN: false,
    NO_SELF_PASSTHROUGH: false,
    EMIT_LIGHTWEIGHT_MESSAGE: false
} as const satisfies Record<string, boolean>;

const OPTIONAL_STRINGS = {
    COMPONENT_PATH: '',
    INPUT_FORMAT: 'default'
} as const satisfies Record<string, string>;

const OPTIONAL_NULLABLE_STRINGS = ['OBJECT_STORAGE_URI', 'OBJECT_STORAGE_TOKEN'] as const;

const MANDATORY_ALWAYS = [
    'FLOW_ID',
    'EXEC_ID',
    'STEP_ID',
    'CONTAINER_ID',
    'WORKSPACE_ID',

    'USER_ID',
    'COMP_ID',
    'FUNCTION',

    'API_URI',
    'API_USERNAME',
    'API_KEY',
    'SAILOR_PROXY_JWT_SECRET'
] as const;

const MANDATORY_NUMBERS = ['OUTGOING_MESSAGE_SIZE_LIMIT'] as const;

/** Not needed when the container only runs the shutdown hook. */
const MANDATORY_FOR_MESSAGE_PROCESSING = [
    'SAILOR_PROXY_URI',
    'MESSAGE_CRYPTO_PASSWORD',
    'MESSAGE_CRYPTO_IV'
] as const;

type Keys<T extends readonly string[]> = T[number];

export type Settings =
    & { readonly [K in Keys<typeof MANDATORY_ALWAYS>]: string }
    & { readonly [K in Keys<typeof MANDATORY_NUMBERS>]: number }
    // Empty strings when HOOK_SHUTDOWN is set and the vars are absent.
    & { readonly [K in Keys<typeof MANDATORY_FOR_MESSAGE_PROCESSING>]: string }
    & { readonly [K in keyof typeof OPTIONAL_NUMBERS]: number }
    & { readonly [K in keyof typeof OPTIONAL_BOOLEANS]: boolean }
    & { readonly [K in keyof typeof OPTIONAL_STRINGS]: string }
    & { readonly [K in Keys<typeof OPTIONAL_NULLABLE_STRINGS>]: string | null }
    & {
        readonly additionalVars: Readonly<Record<string, string | undefined>> | undefined;
        readonly PROXY_CLIENT_ID: string;
    };

/** Settings available to `runService` (verifyCredentials, select models). */
export interface ServiceSettings {
    readonly POST_RESULT_URL: string | null;
    readonly CFG: string | null;
    readonly ACTION_OR_TRIGGER: string | null;
    readonly GET_MODEL_METHOD: string | null;
    readonly COMPONENT_PATH: string;
    readonly API_URI: string | null;
    readonly API_USERNAME: string | null;
    readonly API_KEY: string | null;
    readonly API_REQUEST_RETRY_ATTEMPTS: number;
    readonly API_REQUEST_RETRY_DELAY: number;
    readonly PROXY_CLIENT_ID: string;
}

function raw(env: Env, key: string): string | undefined {
    const value: unknown = env[PREFIX + key];
    // Coerced: callers (and old specs) sometimes pass numbers/booleans in a plain env object.
    return value === undefined || value === null || value === '' ? undefined : String(value);
}

export function parseNumber(env: Env, key: string, spec: NumberSpec): number {
    const value = raw(env, key);
    if (value === undefined) {
        return spec.default;
    }
    const trimmed = value.trim();
    const parsed = trimmed === 'Infinity' ? Infinity : trimmed === '' ? NaN : Number(trimmed);
    if (Number.isNaN(parsed)) {
        throw new Error(`${PREFIX}${key} must be a number`);
    }
    if (spec.integer && Number.isFinite(parsed) && !Number.isInteger(parsed)) {
        throw new Error(`${PREFIX}${key} must be an integer`);
    }
    if (parsed < spec.min) {
        throw new Error(`${PREFIX}${key} must be >= ${spec.min}`);
    }
    if (spec.max !== undefined && parsed > spec.max) {
        throw new Error(`${PREFIX}${key} must be <= ${spec.max}`);
    }
    return parsed;
}

export function parseBoolean(env: Env, key: string, def: boolean): boolean {
    const value = raw(env, key);
    if (value === undefined) {
        return def;
    }
    switch (value.trim().toLowerCase()) {
        case 'true':
        case '1':
            return true;
        case 'false':
        case '0':
            return false;
        default:
            throw new Error(`${PREFIX}${key} must be one of true, false, 1, 0`);
    }
}

function mandatory(env: Env, key: string): string {
    const value = raw(env, key);
    if (value === undefined) {
        throw new Error(`${PREFIX}${key} is missing`);
    }
    return value;
}

function getAdditionalVars(env: Env): Record<string, string | undefined> | undefined {
    const list = env[`${PREFIX}ADDITIONAL_VARS_FOR_HEADERS`];
    if (!list) {
        return undefined;
    }
    const vars: Record<string, string | undefined> = {};
    for (const name of list.split(',').map(v => v.trim())) {
        const key = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
        vars[key] = env[name];
    }
    return vars;
}

/** Reads and validates the sailor settings. Throws on a missing or malformed value. */
export function readFrom(env: Env): Settings {
    const result: Record<string, unknown> = {};

    for (const [key, spec] of Object.entries(OPTIONAL_NUMBERS)) {
        result[key] = parseNumber(env, key, spec);
    }
    for (const [key, def] of Object.entries(OPTIONAL_BOOLEANS)) {
        result[key] = parseBoolean(env, key, def);
    }
    for (const [key, def] of Object.entries(OPTIONAL_STRINGS)) {
        result[key] = raw(env, key) ?? def;
    }
    for (const key of OPTIONAL_NULLABLE_STRINGS) {
        result[key] = raw(env, key) ?? null;
    }

    for (const key of MANDATORY_ALWAYS) {
        result[key] = mandatory(env, key);
    }
    for (const key of MANDATORY_NUMBERS) {
        mandatory(env, key);
        result[key] = parseNumber(env, key, int(0, 1));
    }
    for (const key of MANDATORY_FOR_MESSAGE_PROCESSING) {
        result[key] = result.HOOK_SHUTDOWN ? raw(env, key) ?? '' : mandatory(env, key);
    }

    result.additionalVars = getAdditionalVars(env);
    result.PROXY_CLIENT_ID = PROXY_CLIENT_ID;
    return result as Settings;
}

/**
 * Reads the `runService` settings. Nothing is mandatory here: the service reports missing
 * values itself (a missing POST_RESULT_URL cannot be reported back), but malformed values throw.
 */
export function readServiceSettings(env: Env): ServiceSettings {
    return {
        POST_RESULT_URL: raw(env, 'POST_RESULT_URL') ?? null,
        CFG: raw(env, 'CFG') ?? null,
        ACTION_OR_TRIGGER: raw(env, 'ACTION_OR_TRIGGER') ?? null,
        GET_MODEL_METHOD: raw(env, 'GET_MODEL_METHOD') ?? null,
        COMPONENT_PATH: raw(env, 'COMPONENT_PATH') ?? OPTIONAL_STRINGS.COMPONENT_PATH,
        API_URI: raw(env, 'API_URI') ?? null,
        API_USERNAME: raw(env, 'API_USERNAME') ?? null,
        API_KEY: raw(env, 'API_KEY') ?? null,
        API_REQUEST_RETRY_ATTEMPTS: parseNumber(env, 'API_REQUEST_RETRY_ATTEMPTS',
            OPTIONAL_NUMBERS.API_REQUEST_RETRY_ATTEMPTS),
        API_REQUEST_RETRY_DELAY: parseNumber(env, 'API_REQUEST_RETRY_DELAY', OPTIONAL_NUMBERS.API_REQUEST_RETRY_DELAY),
        PROXY_CLIENT_ID
    };
}
