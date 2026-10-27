import bunyan from 'bunyan';
import { PROXY_CLIENT_ID, type Env } from '../settings/index.ts';

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
type Level = typeof LEVELS[number];

/** Env vars copied into the context of every log line (only those that are set). */
export const CONTEXT_ENV_VARS = [
    'ELASTICIO_API_USERNAME',
    'ELASTICIO_COMP_ID',
    'ELASTICIO_COMP_NAME',
    'ELASTICIO_CONTAINER_ID',
    'ELASTICIO_CONTRACT_ID',
    'ELASTICIO_EXEC_ID',
    'ELASTICIO_EXEC_TYPE',
    'ELASTICIO_EXECUTION_RESULT_ID',
    'ELASTICIO_FLOW_ID',
    'ELASTICIO_FLOW_VERSION',
    'ELASTICIO_FUNCTION',
    'ELASTICIO_STEP_ID',
    'ELASTICIO_TASK_USER_EMAIL',
    'ELASTICIO_TENANT_ID',
    'ELASTICIO_USER_ID',
    'ELASTICIO_WORKSPACE_ID'
] as const;

export function resolveLevel(env: Env): bunyan.LogLevel {
    if (env.LOG_LEVEL) {
        return env.LOG_LEVEL as bunyan.LogLevel;
    }
    // Logging is off by default under tests.
    return env.NODE_ENV === 'test' ? bunyan.FATAL + 1 : 'info';
}

export function buildContext(env: Env): Record<string, string | undefined> {
    const context: Record<string, string | undefined> = {};
    for (const name of CONTEXT_ENV_VARS) {
        if (name in env) {
            context[name] = env[name];
        }
    }
    context.tag = env.ELASTICIO_FLOW_ID;
    context.PROXY_CLIENT_ID = PROXY_CLIENT_ID;
    return context;
}

/** Sailor logger plus the fatal-exit helper (one object so tests can stub it). */
export type SailorLogger = bunyan & {
    criticalErrorAndExit(reason: string, err: unknown): never;
};

export function createSailorLogger(env: Env = process.env): SailorLogger {
    const log = bunyan.createLogger({
        name: 'sailor',
        level: resolveLevel(env),
        serializers: bunyan.stdSerializers
    }).child(buildContext(env)) as SailorLogger;

    // Bound so they can be passed around as bare functions.
    for (const level of LEVELS) {
        log[level] = log[level].bind(log) as never;
    }

    log.criticalErrorAndExit = function criticalErrorAndExit(reason: string, err: unknown): never {
        if (err instanceof Error) {
            log.fatal(err, reason);
        } else {
            log.fatal({ err, reason }, 'Error happened');
        }
        process.exit(1);
    };

    return log;
}

type LogMethod = (...args: unknown[]) => boolean | void;

/** The `this.logger` given to components. A non-string first argument is turned into a string. */
export type ComponentLogger = { [L in Level]: LogMethod } & {
    child(options: object): ComponentLogger;
};

function decorate(logger: bunyan): ComponentLogger {
    const target = logger as unknown as Record<string, unknown>;
    for (const level of LEVELS) {
        const original = logger[level] as unknown as LogMethod;
        target[level] = (...args: unknown[]) => {
            if (args.length && typeof args[0] !== 'string') {
                args[0] = String(args[0]);
            }
            return original.apply(logger, args);
        };
    }
    const originalChild = logger.child;
    target.child = (options: object) => decorate(originalChild.call(logger, options));
    return logger as unknown as ComponentLogger;
}

export function createComponentLogger(options: object = {}, env: Env = process.env): ComponentLogger {
    return decorate(bunyan.createLogger({
        name: 'component',
        level: resolveLevel(env),
        serializers: bunyan.stdSerializers
    }).child(buildContext(env)).child(options));
}

const logging = createSailorLogger();
export default logging;
