import { EventEmitter } from 'node:events';
import restNode from 'elasticio-rest-node';
import logging, { createComponentLogger, type ComponentLogger } from '../logging/index.ts';
import { readServiceSettings, type Env, type ServiceSettings } from '../settings/index.ts';
import { ComponentReader } from '../component/reader.ts';
import { callComponentFunction } from '../component/compat.ts';
import type { RetryRequest } from '../hooks/hooks-data.ts';
import type { ApiClient } from '../execution/task-exec.ts';

export const SERVICE_METHODS = ['verifyCredentials', 'getMetaModel', 'selectModel'] as const;
export type ServiceMethod = typeof SERVICE_METHODS[number];

export interface ServiceResponse {
    status: 'success' | 'error';
    data: unknown;
}

export interface VerifyCredentialsResult {
    verified: boolean;
    reason?: string;
    [key: string]: unknown;
}

/**
 * The `this` of `verifyCredentials` and model methods. An `EventEmitter`: model methods may emit
 * `updateKeys`. `getConfig()` returns the typed service settings (B5).
 */
export class ServiceExec extends EventEmitter {
    readonly logger: ComponentLogger;
    readonly #apiClient: ApiClient;
    readonly #config: ServiceSettings;

    constructor(logger: ComponentLogger, apiClient: ApiClient, config: ServiceSettings) {
        super();
        this.logger = logger;
        this.#apiClient = apiClient;
        this.#config = config;
    }

    getApiClient(): ApiClient {
        return this.#apiClient;
    }

    getConfig(): ServiceSettings {
        return this.#config;
    }
}

export interface ServiceDeps {
    componentReader?: Pick<ComponentReader, 'init' | 'loadVerifyCredentials' | 'loadTriggerOrAction'>;
    createApiClient?: (settings: ServiceSettings) => ApiClient;
    /** `axiosReqWithRetryOnServerError` (injectable for tests). */
    request?: RetryRequest;
}

const defaultCreateApiClient = (settings: ServiceSettings): ApiClient =>
    restNode(settings.API_USERNAME, settings.API_KEY, {
        retryCount: settings.API_REQUEST_RETRY_ATTEMPTS,
        retryDelay: settings.API_REQUEST_RETRY_DELAY
    }) as ApiClient;

const defaultRequest: RetryRequest = (options, config) =>
    (restNode as unknown as { axiosReqWithRetryOnServerError: RetryRequest })
        .axiosReqWithRetryOnServerError(options, config);

function check(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function isServiceMethod(method: string): method is ServiceMethod {
    return (SERVICE_METHODS as readonly string[]).includes(method);
}

/**
 * Runs a `runService` method and POSTs `{status, data}` to `POST_RESULT_URL`. Resolves with the
 * posted body. Rejects (nothing posted) when `POST_RESULT_URL` is missing, the env is invalid,
 * or the POST does not answer 200.
 */
export async function processService(serviceMethod: string, env: Env, deps: ServiceDeps = {}):
    Promise<ServiceResponse> {
    if (!env.ELASTICIO_POST_RESULT_URL) {
        throw new Error('ELASTICIO_POST_RESULT_URL is not provided');
    }
    const settings = readServiceSettings(env);
    const postResultUrl = settings.POST_RESULT_URL!;
    const componentReader = deps.componentReader ?? new ComponentReader();
    const request = deps.request ?? defaultRequest;

    let response: ServiceResponse;
    try {
        const data = await execService(serviceMethod, settings, componentReader,
            deps.createApiClient ?? defaultCreateApiClient);
        response = { status: 'success', data };
    } catch (err) {
        logging.error(err, (err as Error).stack);
        response = { status: 'error', data: { message: (err as Error).message } };
    }

    await sendResponse(postResultUrl, response, settings, request);
    return response;
}

async function execService(serviceMethod: string, settings: ServiceSettings,
    componentReader: NonNullable<ServiceDeps['componentReader']>,
    createApiClient: NonNullable<ServiceDeps['createApiClient']>): Promise<unknown> {
    logging.trace('About to init');
    check(isServiceMethod(serviceMethod), `Unknown service method "${serviceMethod}"`);
    check(settings.CFG, 'ELASTICIO_CFG is not provided');
    check(settings.API_URI, 'ELASTICIO_API_URI is not provided');
    check(settings.API_USERNAME, 'ELASTICIO_API_USERNAME is not provided');
    check(settings.API_KEY, 'ELASTICIO_API_KEY is not provided');
    if (serviceMethod === 'getMetaModel' || serviceMethod === 'selectModel') {
        check(settings.ACTION_OR_TRIGGER, 'ELASTICIO_ACTION_OR_TRIGGER is not provided');
    }
    if (serviceMethod === 'selectModel') {
        check(settings.GET_MODEL_METHOD, 'ELASTICIO_GET_MODEL_METHOD is not provided');
    }

    let cfg: Record<string, unknown>;
    try {
        cfg = JSON.parse(settings.CFG) as Record<string, unknown>;
    } catch {
        throw new Error('Unable to parse CFG');
    }
    logging.trace({ cfg }, 'Config');

    const apiClient = createApiClient(settings);
    const createScope = () => new ServiceExec(createComponentLogger(), apiClient, settings);

    logging.trace('Init is complete. About to start execution.');
    await componentReader.init(settings.COMPONENT_PATH);

    switch (serviceMethod) {
        case 'verifyCredentials':
            return verifyCredentials(componentReader, cfg, createScope());
        case 'getMetaModel':
            return callModuleMethod(componentReader, settings.ACTION_OR_TRIGGER!, 'getMetaModel', cfg,
                createScope(), apiClient);
        case 'selectModel':
            return callModuleMethod(componentReader, settings.ACTION_OR_TRIGGER!, settings.GET_MODEL_METHOD!, cfg,
                createScope(), apiClient);
    }
}

/** A result without `verified` (including a promise resolving to anything) counts as verified. */
async function verifyCredentials(componentReader: Pick<ComponentReader, 'loadVerifyCredentials'>,
    cfg: Record<string, unknown>, scope: ServiceExec): Promise<VerifyCredentialsResult> {
    try {
        const verify = await componentReader.loadVerifyCredentials();
        const result = await callComponentFunction(verify, scope, cfg);
        if (result !== null && typeof result === 'object' && Object.hasOwn(result, 'verified')) {
            return result as VerifyCredentialsResult;
        }
        return { verified: true };
    } catch (err) {
        return { verified: false, reason: (err as Error).message };
    }
}

/**
 * Calls a model method. `updateKeys` emits update the account; the result is returned once all
 * of them have settled (failures are logged, not returned).
 */
async function callModuleMethod(componentReader: Pick<ComponentReader, 'loadTriggerOrAction'>,
    triggerOrAction: string, method: string, cfg: Record<string, unknown>, scope: ServiceExec,
    apiClient: ApiClient): Promise<unknown> {
    const updates: Promise<unknown>[] = [];
    scope.on('updateKeys', (keys: unknown) => {
        updates.push(apiClient.accounts.update(cfg._account, { keys }));
    });

    const module = await componentReader.loadTriggerOrAction(triggerOrAction) as Record<string, unknown>;
    const fn = module[method];
    check(typeof fn === 'function', `Method "${method}" is not found in "${triggerOrAction}" action or trigger`);
    const data = await callComponentFunction(fn as (...args: never[]) => unknown, scope, cfg);

    for (const result of await Promise.allSettled(updates)) {
        if (result.status === 'rejected') {
            logging.error(result.reason);
        }
    }
    return data;
}

/** POSTs the result. Credentials in the URL move to basic auth. Anything but 200 rejects. */
async function sendResponse(postResultUrl: string, body: ServiceResponse, settings: ServiceSettings,
    request: RetryRequest): Promise<void> {
    const options: Record<string, unknown> = {
        url: postResultUrl,
        method: 'POST',
        headers: { Connection: 'Keep-Alive' },
        data: body,
        validateStatus: (status: number) => status >= 200 && status < 500
    };
    const parsedUrl = new URL(postResultUrl);
    if (parsedUrl.username && parsedUrl.password) {
        options.auth = {
            username: decodeURIComponent(parsedUrl.username),
            password: decodeURIComponent(parsedUrl.password)
        };
        parsedUrl.username = '';
        parsedUrl.password = '';
        options.url = parsedUrl.toString();
    }

    logging.trace('About to send response back to the API');
    const response = await request(options, {
        retriesCount: settings.API_REQUEST_RETRY_ATTEMPTS,
        retryDelay: settings.API_REQUEST_RETRY_DELAY
    });
    if (response.statusCode !== 200) {
        logging.trace('Unable to reach API :(');
        throw new Error(`Failed to POST data to ${postResultUrl} (${response.statusCode}, ${
            String(response.body)})`);
    }
}
