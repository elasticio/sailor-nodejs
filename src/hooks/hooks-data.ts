import restNode from 'elasticio-rest-node';
import type { Settings } from '../settings/index.ts';

// Mirrors `src/types/elasticio-rest-node.d.ts`, which is not emitted: kept here so published `.d.ts` files
// don't import the untyped package.
export interface RetryRequestConfig {
    retriesCount?: number;
    requestTimeout?: number;
    retryDelay?: number;
}

export interface RetryResponse {
    statusCode: number;
    body: unknown;
    headers: Record<string, unknown>;
}

/** `axiosReqWithRetryOnServerError` signature (injectable for tests). */
export type RetryRequest = (options: Record<string, unknown>, config: RetryRequestConfig) => Promise<RetryResponse>;

export type HooksDataSettings = Pick<Settings,
    'FLOW_ID' | 'API_URI' | 'API_USERNAME' | 'API_KEY' | 'API_REQUEST_RETRY_ATTEMPTS' | 'API_REQUEST_RETRY_DELAY'>;

/** HTTP error from the startup data API (status >= 400). */
export class HooksDataError extends Error {
    readonly statusCode: number;

    constructor(message: string, statusCode: number) {
        super(message);
        this.name = 'HooksDataError';
        this.statusCode = statusCode;
    }
}

// elasticio-rest-node is CJS: the named export is only reachable via the default (module.exports).
const defaultRequest: RetryRequest = (options, config) =>
    (restNode as unknown as { axiosReqWithRetryOnServerError: RetryRequest })
        .axiosReqWithRetryOnServerError(options, config);

/**
 * Startup data API: `{API_URI}/sailor-support/hooks/task/{FLOW_ID}/startup/data`.
 * Basic auth, network/5xx errors retried (`API_REQUEST_RETRY_*`), status >= 400 throws `HooksDataError`.
 */
export class HooksData {
    // TODO: fix taskId for Retry flows
    readonly #url: string;
    readonly #auth: { username: string; password: string };
    readonly #config: RetryRequestConfig;
    readonly #request: RetryRequest;

    constructor(settings: HooksDataSettings, request: RetryRequest = defaultRequest) {
        this.#url = `${settings.API_URI}/sailor-support/hooks/task/${settings.FLOW_ID}/startup/data`;
        this.#auth = { username: settings.API_USERNAME, password: settings.API_KEY };
        this.#config = {
            retriesCount: settings.API_REQUEST_RETRY_ATTEMPTS,
            retryDelay: settings.API_REQUEST_RETRY_DELAY
        };
        this.#request = request;
    }

    async #send(method: 'GET' | 'POST' | 'DELETE', data?: unknown): Promise<unknown> {
        const { statusCode, body } = await this.#request({
            url: this.#url,
            method,
            auth: this.#auth,
            headers: { Connection: 'Keep-Alive' },
            data,
            validateStatus: (status: number) => status >= 200 && status < 500
        }, this.#config);

        if (statusCode >= 400) {
            throw new HooksDataError((body as { error?: string } | undefined)?.error ?? '', statusCode);
        }
        return body;
    }

    create(data: unknown): Promise<unknown> {
        return this.#send('POST', data);
    }

    retrieve(): Promise<unknown> {
        return this.#send('GET');
    }

    delete(): Promise<unknown> {
        return this.#send('DELETE');
    }
}
