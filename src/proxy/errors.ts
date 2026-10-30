/** A failed proxy request. `isNetworkError` and 5xx statuses are retried. */
export class ProxyRequestError extends Error {
    readonly statusCode: number | undefined;
    readonly isNetworkError: boolean;

    constructor(message: string, options: { statusCode?: number; isNetworkError?: boolean; cause?: unknown } = {}) {
        super(message, { cause: options.cause });
        this.name = 'ProxyRequestError';
        this.statusCode = options.statusCode;
        this.isNetworkError = options.isNetworkError ?? false;
    }
}

/**
 * The proxy refused to hand back in-flight messages after a reconnect. Continuing would process
 * them twice, so this is fatal (B6: the entrypoint exits through criticalErrorAndExit).
 */
export class ResumeProcessingFailedError extends Error {
    readonly statusCode: number | undefined;
    readonly body: string;

    constructor(statusCode: number | undefined, body: string) {
        super(`Failed to resume processing, status code: ${statusCode}${body ? `, body: ${body}` : ''}`);
        this.name = 'ResumeProcessingFailedError';
        this.statusCode = statusCode;
        this.body = body;
    }
}

export function isRetryable(err: unknown): boolean {
    if (err instanceof ResumeProcessingFailedError) {
        return false;
    }
    const e = err as { isNetworkError?: boolean; statusCode?: number; code?: string } | null;
    return Boolean(e && (
        e.isNetworkError
        || (e.statusCode && e.statusCode >= 500)
        || e.code === 'ECONNRESET'
        || e.code === 'ETIMEDOUT'
    ));
}
