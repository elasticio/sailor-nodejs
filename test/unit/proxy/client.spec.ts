import { expect } from 'chai';
import sinon from 'sinon';
import jwt from 'jsonwebtoken';
import logging from '../../../src/logging/index.ts';
import { Encryptor } from '../../../src/crypto/index.ts';
import { ProxyClient, MESSAGE_PROCESSING_STATUS } from '../../../src/proxy/client.ts';
import { ResumeProcessingFailedError } from '../../../src/proxy/errors.ts';
import type { MessageMetadata } from '../../../src/proxy/codec.ts';
import { CRYPTO_IV, CRYPTO_PASSWORD, FakeProxy, JWT_SECRET, makeSettings, respond, waitFor } from './helpers.ts';
import type { Env } from '../../../src/settings/index.ts';

describe('ProxyClient', () => {
    const encryptor = new Encryptor(CRYPTO_PASSWORD, CRYPTO_IV);
    let proxy: FakeProxy;
    let client: ProxyClient | undefined;

    const createClient = (env: Env = {}, options = {}) => {
        client = new ProxyClient(makeSettings(proxy.uri, env), options);
        return client;
    };
    const ok = () => (_req: unknown, stream: Parameters<typeof respond>[0]) => respond(stream, 200);

    beforeEach(async () => {
        proxy = await new FakeProxy().start();
    });

    afterEach(async () => {
        sinon.restore();
        await client?.disconnect();
        client = undefined;
        await proxy.stop();
    });

    describe('constructor', () => {
        it('throws when SAILOR_PROXY_JWT_SECRET is missing', () => {
            const settings = { ...makeSettings('http://x'), SAILOR_PROXY_JWT_SECRET: '' };
            expect(() => new ProxyClient(settings)).to.throw('SAILOR_PROXY_JWT_SECRET must be set');
        });

        it('throws when PROXY_CLIENT_ID is missing', () => {
            const settings = { ...makeSettings('http://x'), PROXY_CLIENT_ID: '' };
            expect(() => new ProxyClient(settings)).to.throw('PROXY_CLIENT_ID must be set');
        });

        it('throws when API_KEY is missing', () => {
            const settings = { ...makeSettings('http://x'), API_KEY: '' };
            expect(() => new ProxyClient(settings)).to.throw('API_USERNAME and API_KEY must be set');
        });
    });

    describe('connect / health', () => {
        it('is not connected before connect() and after disconnect()', async () => {
            const c = createClient();
            expect(c.isConnected()).to.equal(false);
            expect(c.isHealthy()).to.equal(false);
            await c.connect();
            expect(c.isConnected()).to.equal(true);
            expect(c.isHealthy()).to.equal(true);
            await c.disconnect();
            expect(c.isConnected()).to.equal(false);
        });

        it('rejects when the proxy is unreachable', async () => {
            await proxy.stop();
            const c = createClient();
            await expect(c.connect()).to.be.rejected;
        });
    });

    describe('sendMessage', () => {
        it('POSTs encrypted data with JWT auth, metadata header and routing key query', async () => {
            proxy.routes.set('POST /message', ok());
            const c = createClient({ ELASTICIO_PROTOCOL_VERSION: '2' });
            await c.connect();
            const data = { body: { a: 1 }, headers: { 'X-EIO-Routing-Key': 'rk', other: 'h' } };
            await c.sendMessage({ incomingMessageId: 'in-1', type: 'data', data, metadata: { foo: 'bar' } });

            const [req] = proxy.requestsTo('POST', '/message');
            const query = new URLSearchParams(req!.path.split('?')[1]);
            expect(Object.fromEntries(query))
                .to.deep.equal({ incomingMessageId: 'in-1', type: 'data', customRoutingKey: 'rk' });
            expect(JSON.parse(String(req!.headers['message-metadata'])))
                .to.deep.equal({ foo: 'bar', protocolVersion: 2 });
            expect(Number(req!.headers['content-length'])).to.equal(req!.body.length);
            expect(encryptor.decryptMessageContent(req!.body))
                .to.deep.equal({ body: { a: 1 }, headers: { other: 'h' } });
            // The caller's object is not mutated.
            expect(data.headers).to.have.property('X-EIO-Routing-Key');

            const token = String(req!.headers.authorization).replace(/^Bearer /, '');
            expect(jwt.verify(token, JWT_SECRET)).to.include({
                username: 'task-1', password: 'key', stepId: 'step', clientId: makeSettings('x').PROXY_CLIENT_ID,
                execId: 'exec', containerId: 'container', workspaceId: 'workspace', userId: 'user',
                compId: 'comp', function: 'fn'
            });
            expect(jwt.decode(token, { complete: true })!.header.alg).to.equal('HS256');
        });

        it('sends http-reply with protocol 1, without routing key or incomingMessageId when not given', async () => {
            proxy.routes.set('POST /message', ok());
            const c = createClient({ ELASTICIO_PROTOCOL_VERSION: '2' });
            await c.connect();
            await c.sendMessage({ type: 'http-reply', data: { statusCode: 200, body: 'hi' }, metadata: {} });
            const [req] = proxy.requestsTo('POST', '/message');
            expect(req!.path).to.equal('/message?type=http-reply');
            expect(JSON.parse(String(req!.headers['message-metadata']))).to.deep.equal({ protocolVersion: 1 });
            expect(encryptor.decryptMessageContent(req!.body, 'base64')).to.deep.equal({ statusCode: 200, body: 'hi' });
        });

        it('forceProtocolVersion wins over the type default', async () => {
            proxy.routes.set('POST /message', ok());
            const c = createClient();
            await c.connect();
            await c.sendMessage({ type: 'pub-sub', data: { body: 1 }, metadata: {}, forceProtocolVersion: 2 });
            const [req] = proxy.requestsTo('POST', '/message');
            expect(JSON.parse(String(req!.headers['message-metadata']))).to.deep.equal({ protocolVersion: 2 });
            expect(encryptor.decryptMessageContent(req!.body)).to.deep.equal({ body: 1 });
        });

        it('sends other types without a protocol version as plain JSON', async () => {
            proxy.routes.set('POST /message', ok());
            const c = createClient();
            await c.connect();
            await c.sendMessage({ type: 'pub-sub', data: { body: 1 }, metadata: { protocolVersion: 2 } });
            const [req] = proxy.requestsTo('POST', '/message');
            expect(JSON.parse(String(req!.headers['message-metadata']))).to.deep.equal({});
            expect(JSON.parse(req!.body.toString())).to.deep.equal({ body: 1 });
        });

        it('uses base64 for protocol 1', async () => {
            proxy.routes.set('POST /message', ok());
            const c = createClient();
            await c.connect();
            await c.sendMessage({ type: 'data', data: { body: {} }, metadata: {} });
            const [req] = proxy.requestsTo('POST', '/message');
            expect(encryptor.decryptMessageContent(req!.body, 'base64')).to.deep.equal({ body: {} });
        });

        it('sends rebound without body and drops protocolVersion from metadata', async () => {
            proxy.routes.set('POST /message', ok());
            const c = createClient();
            await c.connect();
            const outgoing: Record<string, unknown> = { protocolVersion: 2 };
            await c.sendRebound(new Error('later'), { threadId: 't', messageId: 'm' }, outgoing);
            const [req] = proxy.requestsTo('POST', '/message');
            expect(req!.body.length).to.equal(0);
            const metadata = JSON.parse(String(req!.headers['message-metadata']));
            expect(metadata).to.include({ reboundReason: 'later' });
            expect(metadata).not.to.have.property('protocolVersion');
            expect(req!.path).to.contain('type=rebound').and.contain('incomingMessageId=m');
        });

        it('sends snapshots as plain JSON with a byte-accurate content-length', async () => {
            proxy.routes.set('POST /message', ok());
            const c = createClient();
            await c.connect();
            await c.sendSnapshot({ name: 'héllo ✓' }, {});
            const [req] = proxy.requestsTo('POST', '/message');
            expect(JSON.parse(req!.body.toString())).to.deep.equal({ name: 'héllo ✓' });
            expect(Number(req!.headers['content-length'])).to.equal(req!.body.length);
        });

        it('sends errors with base64 encrypted error and errorInput', async () => {
            proxy.routes.set('POST /message', ok());
            const c = createClient();
            await c.connect();
            await c.sendError(new Error('boom'), {}, { body: 1 },
                { threadId: 't', messageId: 'm', protocolVersion: 2 });
            const [req] = proxy.requestsTo('POST', '/message');
            const payload = JSON.parse(req!.body.toString());
            expect(encryptor.decryptMessageContent(Buffer.from(payload.error), 'base64'))
                .to.include({ message: 'boom' });
            expect(encryptor.decryptMessageContent(Buffer.from(payload.errorInput), 'base64'))
                .to.deep.equal({ body: 1 });
        });

        it('throws before sending when the message exceeds OUTGOING_MESSAGE_SIZE_LIMIT', async () => {
            const c = createClient();
            await c.connect();
            await expect(c.sendMessage({ type: 'data', data: { body: 'x'.repeat(2000) }, metadata: {} }))
                .to.be.rejectedWith(/exceeds limit of 1000/);
            expect(proxy.requests).to.have.length(0);
        });

        it('retries on 5xx and succeeds', async () => {
            let calls = 0;
            proxy.routes.set('POST /message', (_req, stream) => respond(stream, ++calls < 3 ? 503 : 200));
            const c = createClient();
            await c.connect();
            await c.sendMessage({ type: 'data', data: { body: {} }, metadata: {} });
            expect(calls).to.equal(3);
        });

        it('does not retry 4xx and rejects with the response body', async () => {
            proxy.routes.set('POST /message', (_req, stream) => respond(stream, 400, 'bad request'));
            const c = createClient();
            await c.connect();
            await expect(c.sendMessage({ type: 'data', data: { body: {} }, metadata: {} }))
                .to.be.rejectedWith('bad request');
            expect(proxy.requests).to.have.length(1);
        });

        it('gives up after PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS retries', async () => {
            proxy.routes.set('POST /message', (_req, stream) => respond(stream, 500));
            const c = createClient({ ELASTICIO_PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS: '2' });
            await c.connect();
            await expect(c.sendMessage({ type: 'data', data: { body: {} }, metadata: {} })).to.be.rejected;
            expect(proxy.requests).to.have.length(3);
        });

        it('throttles data sends to DATA_RATE_LIMIT per RATE_INTERVAL', async () => {
            proxy.routes.set('POST /message', ok());
            const c = createClient({ ELASTICIO_DATA_RATE_LIMIT: '2', ELASTICIO_RATE_INTERVAL: '100' });
            await c.connect();
            const start = Date.now();
            await Promise.all(Array.from({ length: 5 }, () =>
                c.sendMessage({ type: 'data', data: { body: {} }, metadata: {} })));
            expect(Date.now() - start).to.be.at.least(190);
        });

        it('rejects pending throttled sends on disconnect', async () => {
            proxy.routes.set('POST /message', ok());
            const c = createClient({ ELASTICIO_DATA_RATE_LIMIT: '1', ELASTICIO_RATE_INTERVAL: '1000' });
            await c.connect();
            await c.sendMessage({ type: 'data', data: { body: {} }, metadata: {} });
            const pending = c.sendMessage({ type: 'data', data: { body: {} }, metadata: {} });
            await c.disconnect();
            await expect(pending).to.be.rejected;
        });
    });

    describe('listenForMessages / finishProcessing', () => {
        const metadataHeader = (extra = {}) => JSON.stringify({ messageId: 'm1', threadId: 't1', ...extra });

        it('passes decoded messages to the handler and finishes processing', async () => {
            let delivered = false;
            proxy.routes.set('GET /message', (_req, stream) => {
                if (delivered) {
                    return; // hold the next GET open
                }
                delivered = true;
                respond(stream, 200, encryptor.encryptMessageContent({ body: { a: 1 } }, 'base64'),
                    { 'message-metadata': metadataHeader() });
            });
            proxy.routes.set('POST /finish-processing', ok());
            const c = createClient();
            await c.connect();

            const received: [MessageMetadata, unknown][] = [];
            const listening = c.listenForMessages(async (metadata, message) => {
                received.push([metadata, message]);
                await c.finishProcessing(metadata, MESSAGE_PROCESSING_STATUS.SUCCESS);
            });
            await waitFor(() => proxy.requestsTo('POST', '/finish-processing').length === 1);

            expect(received[0]![0]).to.include({ messageId: 'm1', threadId: 't1' });
            expect(received[0]![1]).to.deep.equal({ body: { a: 1 }, headers: {} });
            expect(proxy.requestsTo('GET', '/message')[0]!.path).to.equal('/message?prefetch=1');
            expect(proxy.requestsTo('POST', '/finish-processing')[0]!.path)
                .to.equal('/finish-processing?incomingMessageId=m1&status=success');

            await c.stopListeningForMessages();
            await c.disconnect();
            await listening;
        });

        it('opens PROXY_PREFETCH_SAILOR parallel GETs', async () => {
            proxy.routes.set('GET /message', () => undefined);
            const c = createClient({ ELASTICIO_PROXY_PREFETCH_SAILOR: '3' });
            await c.connect();
            const listening = c.listenForMessages(async () => undefined);
            await waitFor(() => proxy.requestsTo('GET', '/message').length === 3);
            expect(proxy.requests[0]!.path).to.equal('/message?prefetch=3');
            await c.stopListeningForMessages();
            await c.disconnect();
            await listening;
        });

        it('requests again after a 204 without calling the handler', async () => {
            proxy.routes.set('GET /message', (_req, stream) => {
                if (proxy.requestsTo('GET', '/message').length === 1) {
                    respond(stream, 204);
                }
            });
            const c = createClient();
            await c.connect();
            const handler = sinon.stub().resolves();
            const listening = c.listenForMessages(handler);
            await waitFor(() => proxy.requestsTo('GET', '/message').length === 2);
            expect(handler).not.to.have.been.called;
            await c.stopListeningForMessages();
            await c.disconnect();
            await listening;
        });

        it('warns when finishing an untracked message', async () => {
            proxy.routes.set('POST /finish-processing', ok());
            const warn = sinon.spy(logging, 'warn');
            const c = createClient();
            await c.connect();
            await c.finishProcessing({ threadId: 't', messageId: 'x' }, MESSAGE_PROCESSING_STATUS.ERROR);
            expect(proxy.requestsTo('POST', '/finish-processing')[0]!.path)
                .to.equal('/finish-processing?incomingMessageId=x&status=error');
            expect(warn).to.have.been.calledWithMatch(sinon.match.object,
                'Finished processing message that is not tracked as being processed');
        });

        it('a non-200 GET is an error; listening goes on', async () => {
            proxy.routes.set('GET /message', (_req, stream) => {
                if (proxy.requestsTo('GET', '/message').length === 1) {
                    respond(stream, 500, 'oops');
                }
            });
            const error = sinon.spy(logging, 'error');
            const c = createClient();
            await c.connect();
            const handler = sinon.stub().resolves();
            const listening = c.listenForMessages(handler);
            await waitFor(() => proxy.requestsTo('GET', '/message').length === 2);
            expect(handler).not.to.have.been.called;
            expect(error).to.have.been.calledWithMatch(sinon.match({ message: 'oops' }),
                'Error while listening for messages');
            await c.stopListeningForMessages();
            await c.disconnect();
            await listening;
        });

        it('stopListeningForMessages closes open GETs and ends the loop', async () => {
            proxy.routes.set('GET /message', () => undefined);
            const c = createClient();
            await c.connect();
            const listening = c.listenForMessages(async () => undefined);
            await waitFor(() => proxy.requestsTo('GET', '/message').length === 1);
            await c.stopListeningForMessages();
            await listening;
            expect(proxy.requestsTo('GET', '/message')).to.have.length(1);
            expect(c.isConnected()).to.equal(true);
        });

        it('rejects an invalid status', async () => {
            const c = createClient();
            await expect(c.finishProcessing({ threadId: 't' }, 'nope' as never))
                .to.be.rejectedWith('Invalid message processing status: nope');
        });
    });

    describe('reconnect', () => {
        it('reconnects after the proxy drops the connection and resumes in-flight messages', async () => {
            proxy.routes.set('GET /message', (_req, stream) => {
                if (proxy.requestsTo('GET', '/message').length === 1) {
                    respond(stream, 200, encryptor.encryptMessageContent({ body: {} }, 'base64'),
                        { 'message-metadata': JSON.stringify({ messageId: 'm1', threadId: 't' }) });
                }
            });
            proxy.routes.set('POST /resume-processing', ok());
            const c = createClient();
            await c.connect();
            let handled = false;
            void c.listenForMessages(async () => {
                handled = true;
                await new Promise(resolve => setTimeout(resolve, 10000)); // still processing
            });
            await waitFor(() => handled);

            proxy.dropConnections();
            await waitFor(() => !c.isConnected());
            expect(c.isHealthy()).to.equal(true);
            await waitFor(() => proxy.requestsTo('POST', '/resume-processing').length === 1);
            await waitFor(() => c.isConnected());

            const [req] = proxy.requestsTo('POST', '/resume-processing');
            expect(JSON.parse(req!.body.toString()))
                .to.deep.equal([{ messageId: 'm1', stepId: 'step', taskId: 'flow' }]);

            await c.disconnect();
        });

        it('B6: a non-200 /resume-processing calls onFatalError with ResumeProcessingFailedError', async () => {
            proxy.routes.set('GET /message', (_req, stream) => {
                if (proxy.requestsTo('GET', '/message').length === 1) {
                    respond(stream, 200, encryptor.encryptMessageContent({ body: {} }, 'base64'),
                        { 'message-metadata': JSON.stringify({ messageId: 'm1', threadId: 't' }) });
                }
            });
            proxy.routes.set('POST /resume-processing', (_req, stream) => respond(stream, 410, 'gone'));
            const onFatalError = sinon.stub();
            const c = createClient({}, { onFatalError });
            await c.connect();
            let handled = false;
            void c.listenForMessages(async () => {
                handled = true;
                await new Promise(resolve => setTimeout(resolve, 10000));
            });
            await waitFor(() => handled);

            proxy.dropConnections();
            await waitFor(() => onFatalError.called);
            const err = onFatalError.firstCall.args[0];
            expect(err).to.be.instanceOf(ResumeProcessingFailedError);
            expect(err).to.include({ statusCode: 410, body: 'gone' });
            expect(proxy.requestsTo('POST', '/resume-processing')).to.have.length(1);
        });

        it('gives up after PROXY_RECONNECT_MAX_RETRIES and reports unhealthy', async () => {
            const c = createClient({ ELASTICIO_PROXY_RECONNECT_MAX_RETRIES: '2' });
            await c.connect();
            await proxy.stop();
            await waitFor(() => !c.isHealthy(), 3000);
        });
    });
});
