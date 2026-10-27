declare module 'elasticio-rest-node' {
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

    /** axios request retried on network errors and 5xx; resolves for statuses accepted by `validateStatus`. */
    export function axiosReqWithRetryOnServerError(
        requestOptions: Record<string, unknown>,
        config?: RetryRequestConfig
    ): Promise<RetryResponse>;

    const client: (...args: unknown[]) => unknown;
    export default client;
}
