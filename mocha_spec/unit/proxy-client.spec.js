'use strict';

const http2 = require('http2');
const EventEmitter = require('events');
const chai = require('chai');
const sinon = require('sinon');
const { expect } = chai;
chai.use(require('sinon-chai'));
const uuid = require('uuid');

const { ProxyClient, MESSAGE_PROCESSING_STATUS } = require('../../lib/proxy-client');
const Encryptor = require('../../lib/encryptor');

const {
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_METHOD,
    HTTP2_HEADER_AUTHORIZATION,
    HTTP2_HEADER_STATUS,
    HTTP2_HEADER_CONTENT_LENGTH,
    NGHTTP2_NO_ERROR
} = http2.constants;

const MESSAGE_METADATA_HEADER = 'message-metadata';

function makeSettings(overrides = {}) {
    return {
        PROXY_CLIENT_ID: 'test-client-id',
        API_USERNAME: 'user@test.com',
        API_KEY: 'test-api-key',
        SAILOR_PROXY_JWT_SECRET: 'test-secret',
        SAILOR_PROXY_URI: 'http://localhost:9999',
        MESSAGE_CRYPTO_PASSWORD: 'testCryptoPassword',
        MESSAGE_CRYPTO_IV: 'iv=any16_symbols',
        STEP_ID: 'step-1',
        EXEC_ID: 'exec-1',
        CONTAINER_ID: 'container-1',
        WORKSPACE_ID: 'workspace-1',
        USER_ID: 'user-1',
        COMP_ID: 'comp-1',
        FLOW_ID: 'flow-1',
        FUNCTION: 'test-function',
        PROTOCOL_VERSION: 1,
        INPUT_FORMAT: 'default',
        PROXY_PREFETCH_SAILOR: 1,
        PROXY_PING_INTERVAL_MS: 1000,
        OUTGOING_MESSAGE_SIZE_LIMIT: 1024 * 1024,
        DATA_RATE_LIMIT: 100,
        ERROR_RATE_LIMIT: 100,
        SNAPSHOT_RATE_LIMIT: 100,
        RATE_INTERVAL: 100,
        PROXY_RECONNECT_MAX_RETRIES: 3,
        PROXY_RECONNECT_INITIAL_DELAY: 1000,
        PROXY_RECONNECT_MAX_DELAY: 30000,
        PROXY_RECONNECT_BACKOFF_MULTIPLIER: 2,
        PROXY_RECONNECT_JITTER_FACTOR: 0,
        PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS: 0,
        PROXY_OBJECT_REQUEST_RETRY_DELAY: 1,
        PROXY_OBJECT_REQUEST_MAX_RETRY_DELAY: 10,
        ...overrides
    };
}

function makeMockStream() {
    const stream = new EventEmitter();
    stream.respond = sinon.stub();
    stream.write = sinon.stub();
    stream.end = sinon.stub();
    stream.close = sinon.stub().callsFake((code, callback) => {
        stream.closed = true;
        if (callback) {
            callback();
        }
    });
    stream.destroy = sinon.stub().callsFake(() => {
        stream.destroyed = true;
    });
    stream.closed = false;
    stream.destroyed = false;
    stream.rstCode = NGHTTP2_NO_ERROR;
    return stream;
}

function makeMockSession(requestImpl) {
    const session = new EventEmitter();
    session.request = requestImpl
        ? sinon.stub().callsFake(requestImpl)
        : sinon.stub().returns(makeMockStream());
    session.close = sinon.stub().callsFake((callback) => {
        session.destroyed = true;
        if (callback) {
            callback();
        }
    });
    session.destroy = sinon.stub().callsFake(() => {
        session.destroyed = true;
    });
    session.destroyed = false;
    session.ping = sinon.stub().yields(null, 1, Buffer.alloc(8));
    return session;
}

async function expectRejected(promise, assertError) {
    try {
        await promise;
        expect.fail('Expected promise to reject');
    } catch (error) {
        assertError(error);
    }
}

describe('ProxyClient', () => {
    let sandbox;
    let settings;
    let encryptor;
    let clock;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        settings = makeSettings();
        encryptor = new Encryptor(settings.MESSAGE_CRYPTO_PASSWORD, settings.MESSAGE_CRYPTO_IV);
        clock = null;
    });

    afterEach(() => {
        if (clock) {
            clock.restore();
        }
        sandbox.restore();
    });

    describe('constructor', () => {
        it('throws when PROXY_CLIENT_ID is missing', () => {
            expect(() => new ProxyClient(makeSettings({ PROXY_CLIENT_ID: '' }))).to.throw(
                'PROXY_CLIENT_ID must be set to connect to Sailor Proxy'
            );
        });

        it('throws when API_USERNAME is missing', () => {
            expect(() => new ProxyClient(makeSettings({ API_USERNAME: '' }))).to.throw(
                'API_USERNAME and API_KEY must be set to connect to Sailor Proxy'
            );
        });

        it('throws when API_KEY is missing', () => {
            expect(() => new ProxyClient(makeSettings({ API_KEY: '' }))).to.throw(
                'API_USERNAME and API_KEY must be set to connect to Sailor Proxy'
            );
        });

        it('throws when SAILOR_PROXY_JWT_SECRET is missing', () => {
            expect(() => new ProxyClient(makeSettings({ SAILOR_PROXY_JWT_SECRET: '' }))).to.throw(
                'SAILOR_PROXY_JWT_SECRET must be set to connect to Sailor Proxy'
            );
        });

        it('initialises connection state and throttles', () => {
            const client = new ProxyClient(settings);

            expect(client.closed).to.be.true;
            expect(client.listeningForMessages).to.be.true;
            expect(client.clientSession).to.equal(null);
            expect(client.reconnecting).to.be.false;
            expect(client.reconnectAttempts).to.equal(0);
            expect(client.getMessageStreams.size).to.equal(0);
            expect(client.processingMessagesMetadata.size).to.equal(0);
            expect(client.authHeader).to.be.a('string');
            expect(client.throttles).to.have.keys(['data', 'error', 'snapshot']);
        });
    });

    describe('isConnected()', () => {
        it('returns false when closed', () => {
            const client = new ProxyClient(settings);
            client.clientSession = { destroyed: false };

            expect(client.isConnected()).to.equal(false);
        });

        it('returns a falsey value when session is missing', () => {
            const client = new ProxyClient(settings);
            client.closed = false;

            expect(client.isConnected()).to.equal(null);
        });

        it('returns false when session is destroyed', () => {
            const client = new ProxyClient(settings);
            client.closed = false;
            client.clientSession = { destroyed: true };

            expect(client.isConnected()).to.equal(false);
        });

        it('returns true only when not closed and session is active', () => {
            const client = new ProxyClient(settings);
            client.closed = false;
            client.clientSession = { destroyed: false };
            client.reconnecting = true;

            expect(client.isConnected()).to.equal(true);
        });
    });

    describe('isHealthy()', () => {
        it('returns true while reconnecting if client is not closed', () => {
            const client = new ProxyClient(settings);
            client.closed = false;
            client.reconnecting = true;
            client.clientSession = null;

            expect(client.isHealthy()).to.equal(true);
        });

        it('otherwise delegates to isConnected', () => {
            const client = new ProxyClient(settings);
            client.closed = false;
            client.clientSession = { destroyed: false };

            expect(client.isHealthy()).to.equal(true);

            client.clientSession.destroyed = true;
            expect(client.isHealthy()).to.equal(false);
        });
    });

    describe('connect()', () => {
        it('creates a session, waits for connect, and starts ping interval', async () => {
            const session = makeMockSession();
            sandbox.stub(http2, 'connect').returns(session);
            const client = new ProxyClient(settings);
            const startPingInterval = sandbox.stub(client, '_startPingInterval');

            const promise = client.connect();
            session.emit('connect');
            await promise;

            expect(http2.connect).to.have.been.calledOnceWith(
                settings.SAILOR_PROXY_URI,
                { maxSessionMemory: 10 }
            );
            expect(client.closed).to.equal(false);
            expect(client.reconnectAttempts).to.equal(0);
            expect(client.clientSession).to.equal(session);
            expect(startPingInterval).to.have.been.calledOnce;
        });

        it('rejects when session emits an error before connect', async () => {
            const session = makeMockSession();
            sandbox.stub(http2, 'connect').returns(session);
            const client = new ProxyClient(settings);
            sandbox.stub(client, '_handleDisconnection');
            sandbox.stub(client, '_startPingInterval');

            const promise = client.connect();
            session.emit('error', new Error('connection refused'));

            await expectRejected(promise, (error) => {
                expect(error.message).to.equal('connection refused');
            });
        });
    });

    describe('disconnect()', () => {
        it('stops pinging, aborts throttles, clears reconnect timer, and closes the session', async () => {
            const client = new ProxyClient(settings);
            const session = makeMockSession();
            client.closed = false;
            client.clientSession = session;
            client.reconnecting = true;
            const stopPingInterval = sandbox.stub(client, '_stopPingInterval');
            const clearTimeoutSpy = sandbox.spy(global, 'clearTimeout');
            const timer = setTimeout(() => {}, 60000);
            client.reconnectTimer = timer;
            client.throttles.data.abort = sandbox.stub();
            client.throttles.error.abort = sandbox.stub();
            client.throttles.snapshot.abort = sandbox.stub();

            await client.disconnect();

            expect(client.closed).to.equal(true);
            expect(client.reconnecting).to.equal(false);
            expect(stopPingInterval).to.have.been.calledOnce;
            expect(client.throttles.data.abort).to.have.been.calledOnce;
            expect(client.throttles.error.abort).to.have.been.calledOnce;
            expect(client.throttles.snapshot.abort).to.have.been.calledOnce;
            expect(clearTimeoutSpy).to.have.been.calledWith(timer);
            expect(client.reconnectTimer).to.equal(null);
            expect(session.close).to.have.been.calledOnce;
        });

        it('resolves immediately when session is missing or already destroyed', async () => {
            const client = new ProxyClient(settings);
            sandbox.stub(client, '_stopPingInterval');

            await client.disconnect();
            client.clientSession = { destroyed: true };
            await client.disconnect();
        });
    });

    describe('_handleDisconnection()', () => {
        it('starts reconnection flow and destroys the active session', () => {
            const client = new ProxyClient(settings);
            const session = makeMockSession();
            client.closed = false;
            client.clientSession = session;
            const stopPingInterval = sandbox.stub(client, '_stopPingInterval');
            const cleanup = sandbox.stub(client, '_cleanupMessageStreams');
            const scheduleReconnect = sandbox.stub(client, '_scheduleReconnect');

            client._handleDisconnection('error', new Error('boom'));

            expect(stopPingInterval).to.have.been.calledOnce;
            expect(cleanup).to.have.been.calledOnce;
            expect(session.destroy).to.have.been.calledOnce;
            expect(client.clientSession).to.equal(null);
            expect(client.reconnecting).to.equal(true);
            expect(scheduleReconnect).to.have.been.calledOnce;
        });

        it('does nothing when already reconnecting or closed', () => {
            const client = new ProxyClient(settings);
            const scheduleReconnect = sandbox.stub(client, '_scheduleReconnect');

            client.reconnecting = true;
            client._handleDisconnection('close');
            client.reconnecting = false;
            client.closed = true;
            client._handleDisconnection('close');

            expect(scheduleReconnect).not.to.have.been.called;
        });
    });

    describe('_scheduleReconnect()', () => {
        beforeEach(() => {
            clock = sinon.useFakeTimers();
        });

        it('skips scheduling when connection was intentionally closed', () => {
            const client = new ProxyClient(settings);
            client.closed = true;
            client.reconnecting = true;

            client._scheduleReconnect();

            expect(client.reconnecting).to.equal(false);
            expect(client.reconnectTimer).to.equal(null);
        });

        it('marks the client closed when max retries is reached', () => {
            const client = new ProxyClient(makeSettings({ PROXY_RECONNECT_MAX_RETRIES: 0 }));
            client.closed = false;
            client.reconnecting = true;
            client.reconnectAttempts = 0;

            client._scheduleReconnect();

            expect(client.closed).to.equal(true);
            expect(client.reconnecting).to.equal(false);
        });

        it('schedules reconnect, resumes processing, and clears reconnecting on success', async () => {
            const client = new ProxyClient(settings);
            client.closed = false;
            client.reconnecting = true;
            const reconnect = sandbox.stub(client, '_reconnect').resolves();
            const resumeProcessing = sandbox.stub(client, 'resumeProcessing').resolves();

            client._scheduleReconnect();
            expect(client.reconnectAttempts).to.equal(1);

            clock.tick(settings.PROXY_RECONNECT_INITIAL_DELAY);
            await Promise.resolve();
            await Promise.resolve();

            expect(reconnect).to.have.been.calledOnce;
            expect(resumeProcessing).to.have.been.calledOnce;
            expect(client.reconnecting).to.equal(false);
        });
    });

    describe('_startPingInterval() and _stopPingInterval()', () => {
        beforeEach(() => {
            clock = sinon.useFakeTimers();
        });

        it('pings on each interval and only creates one interval', () => {
            const client = new ProxyClient(settings);
            const session = makeMockSession();
            client.clientSession = session;

            client._startPingInterval();
            const firstInterval = client._pingInterval;
            client._startPingInterval();
            clock.tick(settings.PROXY_PING_INTERVAL_MS);

            expect(client._pingInterval).to.equal(firstInterval);
            expect(session.ping).to.have.been.calledOnce;
        });

        it('does not ping a destroyed session', () => {
            const client = new ProxyClient(settings);
            const session = makeMockSession();
            session.destroyed = true;
            client.clientSession = session;

            client._startPingInterval();
            clock.tick(settings.PROXY_PING_INTERVAL_MS);

            expect(session.ping).not.to.have.been.called;
        });

        it('handles ping errors only while the client is open', () => {
            const client = new ProxyClient(settings);
            const session = makeMockSession();
            session.ping = sandbox.stub().yields(new Error('ping failed'));
            client.clientSession = session;
            client.closed = false;
            const handleDisconnection = sandbox.stub(client, '_handleDisconnection');

            client._startPingInterval();
            clock.tick(settings.PROXY_PING_INTERVAL_MS);

            expect(handleDisconnection).to.have.been.calledOnce;
            expect(handleDisconnection).to.have.been.calledWith('ping_timeout');

            client._stopPingInterval();
            handleDisconnection.resetHistory();
            client.closed = true;
            client._startPingInterval();
            clock.tick(settings.PROXY_PING_INTERVAL_MS);

            expect(handleDisconnection).not.to.have.been.called;
        });

        it('stops the ping interval', () => {
            const client = new ProxyClient(settings);
            const session = makeMockSession();
            client.clientSession = session;

            client._startPingInterval();
            client._stopPingInterval();
            clock.tick(settings.PROXY_PING_INTERVAL_MS * 2);

            expect(client._pingInterval).to.equal(null);
            expect(session.ping).not.to.have.been.called;
        });
    });

    describe('_cleanupMessageStreams()', () => {
        it('destroys open streams and clears the set', () => {
            const client = new ProxyClient(settings);
            const openStream = makeMockStream();
            const closedStream = makeMockStream();
            closedStream.closed = true;
            const destroyedStream = makeMockStream();
            destroyedStream.destroyed = true;
            client.getMessageStreams.add(openStream);
            client.getMessageStreams.add(closedStream);
            client.getMessageStreams.add(destroyedStream);

            client._cleanupMessageStreams();

            expect(openStream.destroy).to.have.been.calledOnce;
            expect(closedStream.destroy).not.to.have.been.called;
            expect(destroyedStream.destroy).not.to.have.been.called;
            expect(client.getMessageStreams.size).to.equal(0);
        });
    });

    describe('listenForMessages()', () => {
        it('decodes a received message and passes it to the handler', async () => {
            const client = new ProxyClient(settings);
            const metadata = {
                messageId: uuid.v4(),
                threadId: uuid.v4(),
                protocolVersion: 1
            };
            const payload = { body: { hello: 'world' }, headers: { a: 'b' } };
            const encryptedPayload = encryptor.encryptMessageContent(payload, 'base64');
            let stream;
            const session = makeMockSession(() => {
                stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('response', {
                        [HTTP2_HEADER_STATUS]: 200,
                        [MESSAGE_METADATA_HEADER]: JSON.stringify(metadata)
                    });
                    stream.emit('data', encryptedPayload);
                    stream.emit('end');
                });
                return stream;
            });
            client.closed = false;
            client.clientSession = session;
            const handler = sandbox.stub().callsFake(async (messageMetadata, message) => {
                expect(messageMetadata.messageId).to.equal(metadata.messageId);
                expect(message.body).to.deep.equal(payload.body);
                expect(message.headers).to.deep.equal(payload.headers);
                client.listeningForMessages = false;
            });

            await client.listenForMessages(handler);

            expect(handler).to.have.been.calledOnce;
            expect(client.processingMessagesMetadata.size).to.equal(1);
            expect(stream.destroy).to.have.been.calledOnce;
            expect(client.getMessageStreams.size).to.equal(0);
        });

        it('handles 204 streams by closing them and not invoking the handler', async () => {
            const client = new ProxyClient(settings);
            let stream;
            const session = makeMockSession(() => {
                stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('response', { [HTTP2_HEADER_STATUS]: 204 });
                    client.listeningForMessages = false;
                    stream.emit('close');
                });
                return stream;
            });
            client.closed = false;
            client.clientSession = session;
            const handler = sandbox.stub();

            await client.listenForMessages(handler);

            expect(stream.close).to.have.been.calledOnceWith(NGHTTP2_NO_ERROR);
            expect(handler).not.to.have.been.called;
        });

        it('treats disconnected close as a recoverable network problem', async () => {
            const client = new ProxyClient(settings);
            let stream;
            const cleanup = sandbox.spy(client, '_cleanupMessageStreams');
            const session = makeMockSession(() => {
                stream = makeMockStream();
                setImmediate(() => {
                    client.closed = true;
                    client.listeningForMessages = false;
                    stream.emit('close');
                });
                return stream;
            });
            client.closed = false;
            client.clientSession = session;

            await client.listenForMessages(sandbox.stub());

            expect(cleanup).to.have.been.called;
            expect(client.getMessageStreams.size).to.equal(0);
        });

        it('treats non-zero rstCode close as an error while still connected', async () => {
            const client = new ProxyClient(settings);
            let stream;
            const cleanup = sandbox.spy(client, '_cleanupMessageStreams');
            const session = makeMockSession(() => {
                stream = makeMockStream();
                stream.rstCode = 2;
                setImmediate(() => {
                    client.listeningForMessages = false;
                    stream.emit('close');
                });
                return stream;
            });
            client.closed = false;
            client.clientSession = session;

            await client.listenForMessages(sandbox.stub());

            expect(cleanup).to.have.been.called;
        });

        it('treats no-error close as an empty stream result', async () => {
            const client = new ProxyClient(settings);
            const session = makeMockSession(() => {
                const stream = makeMockStream();
                setImmediate(() => {
                    client.listeningForMessages = false;
                    stream.emit('close');
                });
                return stream;
            });
            client.closed = false;
            client.clientSession = session;
            const handler = sandbox.stub();

            await client.listenForMessages(handler);

            expect(handler).not.to.have.been.called;
        });
    });

    describe('sendMessage()', () => {
        let client;

        beforeEach(() => {
            client = new ProxyClient(settings);
            client.closed = false;
        });

        it('posts encrypted data with metadata and content length', async () => {
            let stream;
            const session = makeMockSession((headers) => {
                stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('response', { [HTTP2_HEADER_STATUS]: 200 });
                    stream.emit('end');
                });
                return stream;
            });
            client.clientSession = session;
            const data = { body: { hello: 'world' }, headers: { 'X-Test': '1' } };
            const metadata = { taskId: 'task-1' };

            await client.sendMessage({
                incomingMessageId: 'incoming-1',
                type: 'data',
                data,
                metadata
            });

            const requestHeaders = session.request.firstCall.args[0];
            expect(requestHeaders[HTTP2_HEADER_PATH]).to.include('/message?');
            expect(requestHeaders[HTTP2_HEADER_PATH]).to.include('incomingMessageId=incoming-1');
            expect(requestHeaders[HTTP2_HEADER_PATH]).to.include('type=data');
            expect(requestHeaders[HTTP2_HEADER_METHOD]).to.equal('POST');
            expect(requestHeaders[HTTP2_HEADER_AUTHORIZATION]).to.equal(client.authHeader);
            expect(JSON.parse(requestHeaders[MESSAGE_METADATA_HEADER])).to.deep.include({
                taskId: 'task-1',
                protocolVersion: settings.PROTOCOL_VERSION
            });
            expect(requestHeaders[HTTP2_HEADER_CONTENT_LENGTH]).to.equal(stream.write.firstCall.args[0].length);
            const decrypted = encryptor.decryptMessageContent(stream.write.firstCall.args[0], 'base64');
            expect(decrypted).to.deep.equal({ body: { hello: 'world' }, headers: { 'X-Test': '1' } });
            expect(stream.end).to.have.been.calledOnce;
        });

        it('adds customRoutingKey to the request path', async () => {
            const session = makeMockSession(() => {
                const stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('response', { [HTTP2_HEADER_STATUS]: 200 });
                    stream.emit('end');
                });
                return stream;
            });
            client.clientSession = session;

            await client.sendMessage({
                incomingMessageId: 'incoming-2',
                type: 'data',
                data: { body: {}, headers: { 'X-EIO-Routing-Key': 'custom.route' } },
                metadata: {}
            });

            expect(session.request.firstCall.args[0][HTTP2_HEADER_PATH]).to.include('customRoutingKey=custom.route');
        });

        it('rejects when outgoing payload exceeds the size limit', async () => {
            client = new ProxyClient(makeSettings({ OUTGOING_MESSAGE_SIZE_LIMIT: 5 }));
            client.closed = false;
            client.clientSession = makeMockSession();

            await expectRejected(client.sendMessage({
                incomingMessageId: 'incoming-3',
                type: 'snapshot',
                data: '123456',
                metadata: {}
            }), (error) => {
                expect(error.message).to.match(/Outgoing message size/);
            });
        });

        it('rejects on stream error and marks it as a network error', async () => {
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('error', new Error('ECONNRESET'));
                });
                return stream;
            });

            await expectRejected(client.sendMessage({
                incomingMessageId: 'incoming-4',
                type: 'data',
                data: { body: {} },
                metadata: {}
            }), (error) => {
                expect(error.message).to.equal('ECONNRESET');
                expect(error.isNetworkError).to.equal(true);
            });
        });

        it('rejects when close happens after connection loss', async () => {
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                setImmediate(() => {
                    client.closed = true;
                    stream.emit('close');
                });
                return stream;
            });

            await expectRejected(client.sendMessage({
                incomingMessageId: 'incoming-5',
                type: 'data',
                data: { body: {} },
                metadata: {}
            }), (error) => {
                expect(error.message).to.equal('Send message stream closed due to lost connection');
                expect(error.isNetworkError).to.equal(true);
            });
        });

        it('rejects when close has a non-zero rstCode while still connected', async () => {
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                stream.rstCode = 7;
                setImmediate(() => {
                    stream.emit('close');
                });
                return stream;
            });

            await expectRejected(client.sendMessage({
                incomingMessageId: 'incoming-6',
                type: 'data',
                data: { body: {} },
                metadata: {}
            }), (error) => {
                expect(error.message).to.equal('Send message stream closed with error, rstCode: 7');
                expect(error.isNetworkError).to.equal(false);
            });
        });

        it('resolves when close has NGHTTP2_NO_ERROR', async () => {
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('close');
                });
                return stream;
            });

            await client.sendMessage({
                incomingMessageId: 'incoming-7',
                type: 'data',
                data: { body: {} },
                metadata: {}
            });
        });
    });

    describe('finishProcessing()', () => {
        let client;

        beforeEach(() => {
            client = new ProxyClient(settings);
            client.closed = false;
        });

        it('rejects invalid statuses', async () => {
            await expectRejected(
                client.finishProcessing({ messageId: 'msg-1' }, 'invalid'),
                (error) => {
                    expect(error.message).to.equal('Invalid message processing status: invalid');
                }
            );
        });

        it('posts expected query params and removes processed metadata', async () => {
            let stream;
            const metadata = { messageId: 'msg-2' };
            client.processingMessagesMetadata.add(metadata);
            client.clientSession = makeMockSession(() => {
                stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('response', { [HTTP2_HEADER_STATUS]: 200 });
                    stream.emit('end');
                });
                return stream;
            });

            await client.finishProcessing(metadata, MESSAGE_PROCESSING_STATUS.SUCCESS);

            const path = client.clientSession.request.firstCall.args[0][HTTP2_HEADER_PATH];
            expect(path).to.include('/finish-processing?');
            expect(path).to.include('incomingMessageId=msg-2');
            expect(path).to.include('status=success');
            expect(path).not.to.include('clientId=');
            expect(stream.end).to.have.been.calledOnce;
            expect(client.processingMessagesMetadata.has(metadata)).to.equal(false);
        });

        it('rejects on server error responses', async () => {
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('response', { [HTTP2_HEADER_STATUS]: 500 });
                    stream.emit('data', Buffer.from('finish failed'));
                    stream.emit('end');
                });
                return stream;
            });

            await expectRejected(
                client.finishProcessing({ messageId: 'msg-3' }, MESSAGE_PROCESSING_STATUS.ERROR),
                (error) => {
                    expect(error.message).to.equal('finish failed');
                    expect(error.statusCode).to.equal(500);
                }
            );
        });

        it('rejects when close happens after connection loss', async () => {
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                setImmediate(() => {
                    client.closed = true;
                    stream.emit('close');
                });
                return stream;
            });

            await expectRejected(
                client.finishProcessing({ messageId: 'msg-4' }, MESSAGE_PROCESSING_STATUS.SUCCESS),
                (error) => {
                    expect(error.message).to.equal('Finish processing stream closed due to lost connection');
                    expect(error.isNetworkError).to.equal(true);
                }
            );
        });

        it('rejects when close has a non-zero rstCode while still connected', async () => {
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                stream.rstCode = 9;
                setImmediate(() => {
                    stream.emit('close');
                });
                return stream;
            });

            await expectRejected(
                client.finishProcessing({ messageId: 'msg-5' }, MESSAGE_PROCESSING_STATUS.SUCCESS),
                (error) => {
                    expect(error.message).to.equal('Finish processing stream closed with error, rstCode: 9');
                    expect(error.isNetworkError).to.equal(false);
                }
            );
        });

        it('resolves when close has NGHTTP2_NO_ERROR', async () => {
            const metadata = { messageId: 'msg-6' };
            client.processingMessagesMetadata.add(metadata);
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('close');
                });
                return stream;
            });

            await client.finishProcessing(metadata, MESSAGE_PROCESSING_STATUS.SUCCESS);
            expect(client.processingMessagesMetadata.has(metadata)).to.equal(false);
        });
    });

    describe('resumeProcessing()', () => {
        let client;

        beforeEach(() => {
            client = new ProxyClient(settings);
            client.closed = false;
        });

        it('returns early when there are no in-flight messages', async () => {
            client.clientSession = makeMockSession();

            await client.resumeProcessing();

            expect(client.clientSession.request).not.to.have.been.called;
        });

        it('posts in-flight message metadata to /resume-processing', async () => {
            let stream;
            const metadata = { messageId: 'msg-7' };
            client.processingMessagesMetadata.add(metadata);
            client.clientSession = makeMockSession(() => {
                stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('response', { [HTTP2_HEADER_STATUS]: 200 });
                    stream.emit('end');
                });
                return stream;
            });

            await client.resumeProcessing();

            const requestHeaders = client.clientSession.request.firstCall.args[0];
            expect(requestHeaders[HTTP2_HEADER_PATH]).to.equal('/resume-processing');
            expect(requestHeaders[HTTP2_HEADER_METHOD]).to.equal('POST');
            expect(JSON.parse(stream.write.firstCall.args[0])).to.deep.equal([{
                messageId: 'msg-7',
                stepId: settings.STEP_ID,
                taskId: settings.FLOW_ID
            }]);
            expect(stream.end).to.have.been.calledOnce;
        });

        it('rejects when close happens after connection loss', async () => {
            client.processingMessagesMetadata.add({ messageId: 'msg-8' });
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                setImmediate(() => {
                    client.closed = true;
                    stream.emit('close');
                });
                return stream;
            });

            await expectRejected(client.resumeProcessing(), (error) => {
                expect(error.message).to.equal('Resume processing stream closed due to lost connection');
                expect(error.isNetworkError).to.equal(true);
            });
        });

        it('rejects when close has a non-zero rstCode while still connected', async () => {
            client.processingMessagesMetadata.add({ messageId: 'msg-9' });
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                stream.rstCode = 4;
                setImmediate(() => {
                    stream.emit('close');
                });
                return stream;
            });

            await expectRejected(client.resumeProcessing(), (error) => {
                expect(error.message).to.equal('Resume processing stream closed with error, rstCode: 4');
            });
        });

        it('resolves when close has NGHTTP2_NO_ERROR', async () => {
            client.processingMessagesMetadata.add({ messageId: 'msg-10' });
            client.clientSession = makeMockSession(() => {
                const stream = makeMockStream();
                setImmediate(() => {
                    stream.emit('close');
                });
                return stream;
            });

            await client.resumeProcessing();
        });
    });

    describe('_prepareData()', () => {
        let client;

        beforeEach(() => {
            client = new ProxyClient(settings);
        });

        it('encrypts data messages and stores the configured protocolVersion', () => {
            const data = { body: { a: 1 }, headers: {} };
            const metadata = { taskId: 'task-1' };

            const { preparedData, preparedMetadata } = client._prepareData(data, metadata, 'data');

            expect(preparedMetadata.protocolVersion).to.equal(settings.PROTOCOL_VERSION);
            expect(encryptor.decryptMessageContent(preparedData, 'base64')).to.deep.equal(data);
        });

        it('uses protocolVersion 1 for http-reply and strips routing key headers case-insensitively', () => {
            const data = {
                body: { ok: true },
                headers: {
                    'X-EIO-Routing-Key': 'custom.route',
                    'X-Other': 'keep-me'
                }
            };

            const { preparedData, preparedMetadata } = client._prepareData(data, {}, 'http-reply');
            const decrypted = encryptor.decryptMessageContent(preparedData, 'base64');

            expect(preparedMetadata.protocolVersion).to.equal(1);
            expect(decrypted.headers).to.deep.equal({ 'X-Other': 'keep-me' });
        });

        it('supports forceProtocolVersion and leaves snapshots unencrypted', () => {
            const forced = client._prepareData({ body: { forced: true } }, {}, 'data', 2);
            expect(forced.preparedMetadata.protocolVersion).to.equal(2);
            expect(encryptor.decryptMessageContent(forced.preparedData)).to.deep.equal({ body: { forced: true } });

            const snapshot = client._prepareData('snapshot-payload', { protocolVersion: 99 }, 'snapshot');
            expect(snapshot.preparedData).to.equal('snapshot-payload');
            expect(snapshot.preparedMetadata).not.to.have.property('protocolVersion');
        });
    });

    describe('encryptMessageContent()', () => {
        let client;

        beforeEach(() => {
            client = new ProxyClient(settings);
        });

        it('encrypts protocol version 1 payloads as base64', () => {
            const encrypted = client.encryptMessageContent({ hello: 'v1' }, 1);

            expect(encryptor.decryptMessageContent(encrypted, 'base64')).to.deep.equal({ hello: 'v1' });
        });

        it('encrypts protocol version 2 payloads without base64 wrapper', () => {
            const encrypted = client.encryptMessageContent({ hello: 'v2' }, 2);

            expect(encryptor.decryptMessageContent(encrypted)).to.deep.equal({ hello: 'v2' });
        });
    });

    describe('_decodeMessage()', () => {
        it('decodes default messages and adds reply_to into headers', () => {
            const client = new ProxyClient(settings);
            const payload = { body: { hello: 'world' }, headers: {} };
            const encrypted = encryptor.encryptMessageContent(payload, 'base64');

            const message = client._decodeMessage(encrypted, { protocolVersion: 1, reply_to: 'reply-queue' });

            expect(message.body).to.deep.equal(payload.body);
            expect(message.headers.reply_to).to.equal('reply-queue');
        });

        it('decodes error-format messages', () => {
            const client = new ProxyClient(makeSettings({ INPUT_FORMAT: 'error' }));
            const originalMessage = { body: { input: true } };
            const payload = JSON.stringify({
                error: encryptor.encryptMessageContent({ name: 'Error', message: 'boom' }, 'base64').toString(),
                errorInput: encryptor.encryptMessageContent(originalMessage, 'base64').toString()
            });

            const message = client._decodeMessage(Buffer.from(payload), {});

            expect(message.error.message).to.equal('boom');
            expect(message.errorInput).to.deep.equal(originalMessage);
        });
    });

    describe('_extractMessageMetadata()', () => {
        let client;

        beforeEach(() => {
            client = new ProxyClient(settings);
        });

        it('extracts standard fields and lowercases x-eio-meta-* keys', () => {
            const headers = {
                [MESSAGE_METADATA_HEADER]: JSON.stringify({
                    stepId: 'step-2',
                    messageId: 'message-1',
                    threadId: 'thread-1',
                    parentMessageId: 'parent-1',
                    protocolVersion: 2,
                    'X-EIO-META-Trace-Id': 'trace-1'
                })
            };

            const metadata = client._extractMessageMetadata(headers);

            expect(metadata).to.deep.include({
                stepId: 'step-2',
                messageId: 'message-1',
                threadId: 'thread-1',
                parentMessageId: 'parent-1',
                protocolVersion: 2,
                'x-eio-meta-trace-id': 'trace-1'
            });
        });

        it('falls back to x-eio-meta-trace-id and preserves reply_to', () => {
            const headers = {
                [MESSAGE_METADATA_HEADER]: JSON.stringify({
                    messageId: 'message-2',
                    reply_to: 'reply-queue',
                    'x-eio-meta-trace-id': 'trace-2'
                })
            };

            const metadata = client._extractMessageMetadata(headers);

            expect(metadata.threadId).to.equal('trace-2');
            expect(metadata.reply_to).to.equal('reply-queue');
        });

        it('generates a threadId when one is not provided', () => {
            const headers = {
                [MESSAGE_METADATA_HEADER]: JSON.stringify({
                    messageId: 'message-3'
                })
            };

            const metadata = client._extractMessageMetadata(headers);

            expect(metadata.threadId).to.be.a('string');
            expect(metadata.threadId).to.have.lengthOf(36);
        });

        it('throws for missing or invalid metadata header', () => {
            expect(() => client._extractMessageMetadata({})).to.throw(
                'Missing metadata in message stream response'
            );
            expect(() => client._extractMessageMetadata({
                [MESSAGE_METADATA_HEADER]: 'not-json'
            })).to.throw('Failed to parse metadata JSON');
        });
    });

    describe('sendError()', () => {
        it('sends encrypted error payload with original input when provided', async () => {
            const client = new ProxyClient(settings);
            const sendMessage = sandbox.stub(client, 'sendMessage').resolves();
            const err = new Error('boom');
            const originalMessage = { body: { original: true } };

            await client.sendError(err, { taskId: 'task-1' }, originalMessage, {
                messageId: 'incoming-8',
                protocolVersion: 1
            });

            const args = sendMessage.firstCall.args[0];
            expect(args.type).to.equal('error');
            expect(args.incomingMessageId).to.equal('incoming-8');
            const payload = JSON.parse(args.data);
            expect(encryptor.decryptMessageContent(Buffer.from(payload.error), 'base64')).to.deep.include({
                name: 'Error',
                message: 'boom'
            });
            expect(encryptor.decryptMessageContent(Buffer.from(payload.errorInput), 'base64')).to.deep.equal(originalMessage);
        });
    });

    describe('sendRebound()', () => {
        it('sends rebound metadata with reason and end timestamp', async () => {
            const client = new ProxyClient(settings);
            const sendMessage = sandbox.stub(client, 'sendMessage').resolves();
            const outgoingMetadata = { taskId: 'task-1' };

            await client.sendRebound(new Error('Too busy'), { messageId: 'incoming-9' }, outgoingMetadata);

            const args = sendMessage.firstCall.args[0];
            expect(args.type).to.equal('rebound');
            expect(args.incomingMessageId).to.equal('incoming-9');
            expect(args.metadata.reboundReason).to.equal('Too busy');
            expect(args.metadata.end).to.be.a('number');
        });
    });

    describe('sendSnapshot()', () => {
        it('stringifies payloads and forwards them as snapshot messages', async () => {
            const client = new ProxyClient(settings);
            const sendMessage = sandbox.stub(client, 'sendMessage').resolves();
            const snapshot = { state: 'ok' };

            await client.sendSnapshot(snapshot, { taskId: 'task-2' });

            expect(sendMessage).to.have.been.calledOnceWith({
                type: 'snapshot',
                data: JSON.stringify(snapshot),
                metadata: { taskId: 'task-2' }
            });
        });
    });

    describe('MESSAGE_PROCESSING_STATUS', () => {
        it('exports the expected status constants', () => {
            expect(MESSAGE_PROCESSING_STATUS).to.deep.equal({
                SUCCESS: 'success',
                ERROR: 'error'
            });
        });
    });
});
