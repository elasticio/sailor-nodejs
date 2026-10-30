import http2, { type Http2Server, type ServerHttp2Stream, type IncomingHttpHeaders } from 'node:http2';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { readFrom, type Env, type Settings } from '../../../src/settings/index.ts';

export const CRYPTO_PASSWORD = 'testCryptoPassword';
export const CRYPTO_IV = 'iv=any16_symbols';
export const JWT_SECRET = 'jwt-secret';

export function makeSettings(proxyUri: string, extra: Env = {}): Settings {
    return readFrom({
        ELASTICIO_FLOW_ID: 'flow',
        ELASTICIO_EXEC_ID: 'exec',
        ELASTICIO_STEP_ID: 'step',
        ELASTICIO_CONTAINER_ID: 'container',
        ELASTICIO_WORKSPACE_ID: 'workspace',
        ELASTICIO_USER_ID: 'user',
        ELASTICIO_COMP_ID: 'comp',
        ELASTICIO_FUNCTION: 'fn',
        ELASTICIO_API_URI: 'http://api',
        ELASTICIO_API_USERNAME: 'task-1',
        ELASTICIO_API_KEY: 'key',
        ELASTICIO_SAILOR_PROXY_JWT_SECRET: JWT_SECRET,
        ELASTICIO_OUTGOING_MESSAGE_SIZE_LIMIT: '1000',
        ELASTICIO_SAILOR_PROXY_URI: proxyUri,
        ELASTICIO_MESSAGE_CRYPTO_PASSWORD: CRYPTO_PASSWORD,
        ELASTICIO_MESSAGE_CRYPTO_IV: CRYPTO_IV,
        ELASTICIO_PROXY_RECONNECT_INITIAL_DELAY: '10',
        ELASTICIO_PROXY_RECONNECT_JITTER_FACTOR: '0',
        ELASTICIO_PROXY_OBJECT_REQUEST_RETRY_DELAY: '1',
        ELASTICIO_PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS: '3',
        ...extra
    });
}

export interface RecordedRequest {
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
    body: Buffer;
}

export type Route = (req: RecordedRequest, stream: ServerHttp2Stream) => void;

/** A minimal fake sailor proxy. `routes` maps "METHOD /path" to a handler. */
export class FakeProxy {
    readonly server: Http2Server = http2.createServer();
    readonly requests: RecordedRequest[] = [];
    readonly routes = new Map<string, Route>();
    readonly sessions = new Set<http2.ServerHttp2Session>();
    uri = '';

    async start(): Promise<this> {
        this.server.on('session', session => {
            this.sessions.add(session);
            session.on('close', () => this.sessions.delete(session));
        });
        this.server.on('stream', (stream, headers) => {
            const chunks: Buffer[] = [];
            stream.on('data', (c: Buffer) => chunks.push(c));
            stream.on('end', () => {
                const method = String(headers[':method']);
                const fullPath = String(headers[':path']);
                const req = { method, path: fullPath, headers, body: Buffer.concat(chunks) };
                this.requests.push(req);
                const route = this.routes.get(`${method} ${fullPath.split('?')[0]}`);
                if (route) {
                    route(req, stream);
                } else {
                    stream.respond({ ':status': 404 });
                    stream.end();
                }
            });
        });
        this.server.listen(0, '127.0.0.1');
        await once(this.server, 'listening');
        this.uri = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
        return this;
    }

    /** Drops every client connection, as a proxy restart would. */
    dropConnections(): void {
        for (const session of this.sessions) {
            session.destroy();
        }
    }

    async stop(): Promise<void> {
        this.dropConnections();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }

    requestsTo(method: string, path: string): RecordedRequest[] {
        return this.requests.filter(r => r.method === method && r.path.split('?')[0] === path);
    }
}

export function respond(stream: ServerHttp2Stream, status: number, body?: string | Buffer,
    headers: Record<string, string> = {}): void {
    stream.respond({ ':status': status, ...headers });
    stream.end(body);
}

export async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('waitFor timed out');
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}
