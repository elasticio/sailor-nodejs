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
    HTTP2_HEADER_STATUS,
    NGHTTP2_NO_ERROR
} = http2.constants;

const MESSAGE_METADATA_HEADER = 'message-metadata';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSettings(overrides = {}) {
    return {
        PROXY_CLIENT_ID: 'test-client-id',
        API_USERNAME: 'user@test.com',
        API_KEY: 'testapikey',
        SAILOR_PROXY_JWT_SECRET: 'testsecret',
        SAILOR_PROXY_URI: 'http://localhost:9999',
        MESSAGE_CRYPTO_PASSWORD: 'testCryptoPassword',
        MESSAGE_CRYPTO_IV: 'iv=any16_symbols',
        STEP_ID: 'step_1',
        EXEC_ID: 'exec-1',
        CONTAINER_ID: 'container-1',
        WORKSPACE_ID: 'workspace-1',
        USER_ID: 'user-1',
        COMP_ID: 'comp-1',
        FLOW_ID: 'flow-1',
        FUNCTION: 'test_fn',
        PROTOCOL_VERSION: 1,
        INPUT_FORMAT: 'default',
        PROXY_PREFETCH_SAILOR: 1,
        DATA_RATE_LIMIT: 100,
        ERROR_RATE_LIMIT: 100,
        SNAPSHOT_RATE_LIMIT: 100,
        RATE_INTERVAL: 100,
        PROXY_RECONNECT_MAX_RETRIES: Infinity,
        PROXY_RECONNECT_INITIAL_DELAY: 1000,
        PROXY_RECONNECT_MAX_DELAY: 30000,
        PROXY_RECONNECT_BACKOFF_MULTIPLIER: 2,
        PROXY_RECONNECT_JITTER_FACTOR: 0,
        PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS: 0,
        PROXY_OBJECT_REQUEST_RETRY_DELAY: 0,
        PROXY_OBJECT_REQUEST_MAX_RETRY_DELAY: 0,
        ...overrides
    };
}

/**
 * Build a mock HTTP/2 stream with event-emitter behaviour.
 * Calling respond() / end() / write() is recorded for assertions.
 */
function makeMockStream() {
    const stream = new EventEmitter();
    stream.respond = sinon.stub();
    stream.write = sinon.stub();
    stream.end = sinon.stub();
    stream.close = sinon.stub().callsFake((code, cb) => {
        if (cb) {
            cb();
        }
    });
    stream.destroy = sinon.stub();
    stream.closed = false;
    stream.destroyed = false;
    stream.rstCode = NGHTTP2_NO_ERROR;
    return stream;
}

/**
 * Build a mock HTTP/2 client session.
 * `request()` returns the provided stream (or a fresh one each call).
 */
function makeMockSession(stream) {
    const session = new EventEmitter();
    session.request = sinon.stub().returns(stream || makeMockStream());
    session.close = sinon.stub().callsFake((cb) => {
        if (cb) {
            cb();
        }
    });
    session.destroy = sinon.stub();
    session.destroyed = false;
    return session;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ProxyClient', () => {
    let settings;
    let sandbox;
    let encryptor;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        settings = makeSettings();
        encryptor = new Encryptor(settings.MESSAGE_CRYPTO_PASSWORD, settings.MESSAGE_CRYPTO_IV);
    });

    afterEach(() => {
        sandbox.restore();
    });

    // ── constructor ──────────────────────────────────────────────────────────

    describe('constructor', () => {
        it('should throw if PROXY_CLIENT_ID is missing', () => {
            expect(() => new ProxyClient(makeSettings({ PROXY_CLIENT_ID: '' }))).to.throw(
                'PROXY_CLIENT_ID must be set to connect to Sailor Proxy'
            );
        });

        it('should throw if API_USERNAME is missing', () => {
            expect(() => new ProxyClient(makeSettings({ API_USERNAME: '' }))).to.throw(
                'API_USERNAME and API_KEY must be set to connect to Sailor Proxy'
            );
        });

        it('should throw if API_KEY is missing', () => {
            expect(() => new ProxyClient(makeSettings({ API_KEY: '' }))).to.throw(
                'API_USERNAME and API_KEY must be set to connect to Sailor Proxy'
            );
        });

        it('should throw if SAILOR_PROXY_JWT_SECRET is missing', () => {
            expect(() => new ProxyClient(makeSettings({ SAILOR_PROXY_JWT_SECRET: '' }))).to.throw(
                'SAILOR_PROXY_JWT_SECRET must be set to connect to Sailor Proxy'
            );
        });

        it('should construct and start in closed state', () => {
            const client = new ProxyClient(settings);
            expect(client.closed).to.be.true;
            expect(client.clientSession).to.be.null;
        });

        it('should set authHeader starting with Bearer', () => {
            const client = new ProxyClient(settings);
            expect(client.authHeader).to.match(/^Bearer /);
        });
    });

    // ── isConnected ──────────────────────────────────────────────────────────

    describe('isConnected()', () => {
        it('should return false when closed', () => {
            const client = new ProxyClient(settings);
            expect(client.isConnected()).to.be.false;
        });

        it('should return true when session is open and not destroyed', () => {
            const client = new ProxyClient(settings);
            client.closed = false;
            client.clientSession = { destroyed: false };
            expect(client.isConnected()).to.be.true;
        });

        it('should return false when session is destroyed', () => {
            const client = new ProxyClient(settings);
            client.closed = false;
            client.clientSession = { destroyed: true };
            expect(client.isConnected()).to.be.false;
        });

        it('should return true while reconnecting (not closed)', () => {
            const client = new ProxyClient(settings);
            client.closed = false;
            client.reconnecting = true;
            client.clientSession = null;
            expect(client.isConnected()).to.be.true;
        });
    });

    // ── connect / disconnect ─────────────────────────────────────────────────

    describe('connect()', () => {
        it('should create a session and set closed=false on success', async () => {
            const mockSession = makeMockSession();
            sandbox.stub(http2, 'connect').returns(mockSession);

            const client = new ProxyClient(settings);
            const connectPromise = client.connect();
            mockSession.emit('connect');
            await connectPromise;

            expect(http2.connect).to.have.been.calledOnceWith(settings.SAILOR_PROXY_URI);
            expect(client.closed).to.be.false;
            expect(client.clientSession).to.equal(mockSession);
        });

        it('should throw and remain unusable if connect event never fires (simulated error)', async () => {
            const mockSession = makeMockSession();
            sandbox.stub(http2, 'connect').returns(mockSession);

            const client = new ProxyClient(settings);
            const connectPromise = client.connect();
            // Emit error instead of connect — event-to-promise rejects on 'error'
            const err = new Error('connection refused');
            mockSession.emit('error', err);

            try {
                await connectPromise;
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e.message).to.include('connection refused');
            }
        });
    });

    describe('disconnect()', () => {
        it('should set closed=true and call session.close()', async () => {
            const mockSession = makeMockSession();
            sandbox.stub(http2, 'connect').returns(mockSession);

            const client = new ProxyClient(settings);
            const connectP = client.connect();
            mockSession.emit('connect');
            await connectP;

            await client.disconnect();

            expect(client.closed).to.be.true;
            expect(mockSession.close).to.have.been.calledOnce;
        });

        it('should resolve immediately if session is already destroyed', async () => {
            const client = new ProxyClient(settings);
            client.clientSession = { destroyed: true };
            const result = await client.disconnect();
            expect(result).to.be.undefined;
            expect(client.closed).to.be.true;
        });

        it('should resolve immediately if session is null', async () => {
            const client = new ProxyClient(settings);
            client.clientSession = null;
            const result = await client.disconnect();
            expect(result).to.be.undefined;
        });

        it('should clear a pending reconnect timer', async () => {
            const client = new ProxyClient(settings);
            client.clientSession = null;
            const clearSpy = sandbox.spy(global, 'clearTimeout');
            const timer = setTimeout(() => {}, 60000);
            client.reconnectTimer = timer;
            await client.disconnect();
            expect(clearSpy).to.have.been.calledWith(timer);
            expect(client.reconnectTimer).to.be.null;
        });
    });

    // ── _prepareData ─────────────────────────────────────────────────────────

    describe('_prepareData()', () => {
        let client;
        beforeEach(() => {
            client = new ProxyClient(settings);
        });

        it('should encrypt data and set protocolVersion for type=data', () => {
            const data = { body: { foo: 'bar' }, headers: {} };
            const meta = { taskId: 'task-1' };
            const { preparedData, preparedMetadata } = client._prepareData(data, meta, 'data');
            expect(Buffer.isBuffer(preparedData)).to.be.true;
            expect(preparedMetadata.protocolVersion).to.equal(settings.PROTOCOL_VERSION);
            const decrypted = encryptor.decryptMessageContent(preparedData, 'base64');
            expect(decrypted).to.deep.equal(data);
        });

        it('should always use protocolVersion=1 for type=http-reply', () => {
            const data = { statusCode: 200, body: 'Ok', headers: {} };
            const meta = {};
            const { preparedMetadata } = client._prepareData(data, meta, 'http-reply');
            expect(preparedMetadata.protocolVersion).to.equal(1);
        });

        it('should strip x-eio-routing-key from data.headers', () => {
            const data = {
                body: {},
                headers: {
                    'x-eio-routing-key': 'custom.key',
                    'x-other': 'keep'
                }
            };
            const { preparedData } = client._prepareData(data, {}, 'data');
            const decrypted = encryptor.decryptMessageContent(preparedData, 'base64');
            expect(decrypted.headers).to.not.have.property('x-eio-routing-key');
            expect(decrypted.headers).to.have.property('x-other', 'keep');
        });

        it('should use forceProtocolVersion when provided', () => {
            const data = { body: {} };
            const { preparedMetadata } = client._prepareData(data, {}, 'data', 2);
            expect(preparedMetadata.protocolVersion).to.equal(2);
        });

        it('should not encrypt and delete protocolVersion for type=snapshot (no protocolVersion)', () => {
            const data = 'raw snapshot payload';
            const meta = { protocolVersion: 3 };
            const { preparedData, preparedMetadata } = client._prepareData(data, meta, 'snapshot');
            expect(preparedData).to.equal(data);
            expect(preparedMetadata).to.not.have.property('protocolVersion');
        });
    });

    // ── encryptMessageContent ────────────────────────────────────────────────

    describe('encryptMessageContent()', () => {
        let client;
        beforeEach(() => {
            client = new ProxyClient(settings);
        });

        it('should encrypt with base64 for protocolVersion < 2', () => {
            const payload = { test: 1 };
            const result = client.encryptMessageContent(payload, 1);
            expect(Buffer.isBuffer(result)).to.be.true;
            const decoded = encryptor.decryptMessageContent(result, 'base64');
            expect(decoded).to.deep.equal(payload);
        });

        it('should encrypt without base64 for protocolVersion >= 2', () => {
            const payload = { test: 2 };
            const result = client.encryptMessageContent(payload, 2);
            expect(Buffer.isBuffer(result)).to.be.true;
            const decoded = encryptor.decryptMessageContent(result);
            expect(decoded).to.deep.equal(payload);
        });

        it('should default to protocolVersion 1', () => {
            const payload = { defaultVersion: true };
            const result = client.encryptMessageContent(payload);
            const decoded = encryptor.decryptMessageContent(result, 'base64');
            expect(decoded).to.deep.equal(payload);
        });
    });

    // ── _decodeMessage / _decodeDefaultMessage / _decodeErrorMessage ─────────

    describe('_decodeMessage()', () => {
        let client;
        beforeEach(() => {
            client = new ProxyClient(settings);
        });

        it('should decode a default (data) message with protocolVersion 1', () => {
            const payload = { body: { hello: 'world' }, headers: {} };
            const encrypted = encryptor.encryptMessageContent(payload, 'base64');
            const metadata = { protocolVersion: 1 };
            const result = client._decodeMessage(encrypted, metadata);
            expect(result.body).to.deep.equal(payload.body);
        });

        it('should decode a default (data) message with protocolVersion 2', () => {
            const payload = { body: { hello: 'v2' }, headers: {} };
            const encrypted = encryptor.encryptMessageContent(payload);
            const metadata = { protocolVersion: 2 };
            const result = client._decodeMessage(encrypted, metadata);
            expect(result.body).to.deep.equal(payload.body);
        });

        it('should add reply_to from metadata to message headers', () => {
            const payload = { body: {}, headers: {} };
            const encrypted = encryptor.encryptMessageContent(payload, 'base64');
            const metadata = { protocolVersion: 1, reply_to: 'my-reply-queue' };
            const result = client._decodeMessage(encrypted, metadata);
            expect(result.headers.reply_to).to.equal('my-reply-queue');
        });

        it('should decode an error message when INPUT_FORMAT=error', () => {
            const clientErr = new ProxyClient(makeSettings({ INPUT_FORMAT: 'error' }));
            const errorContent = encryptor.encryptMessageContent({ message: 'err!', name: 'Error' }, 'base64');
            const rawPayload = JSON.stringify({
                error: errorContent.toString()
            });
            const result = clientErr._decodeMessage(Buffer.from(rawPayload), {});
            expect(result.error.message).to.equal('err!');
        });
    });

    // ── _extractMessageMetadata ──────────────────────────────────────────────

    describe('_extractMessageMetadata()', () => {
        let client;
        beforeEach(() => {
            client = new ProxyClient(settings);
        });

        it('should extract all standard fields', () => {
            const msgId = uuid.v4();
            const threadId = uuid.v4();
            const parentId = uuid.v4();
            const headers = {
                [MESSAGE_METADATA_HEADER]: JSON.stringify({
                    messageId: msgId,
                    threadId,
                    parentMessageId: parentId,
                    stepId: 'step_2',
                    protocolVersion: 2
                })
            };
            const result = client._extractMessageMetadata(headers);
            expect(result.messageId).to.equal(msgId);
            expect(result.threadId).to.equal(threadId);
            expect(result.parentMessageId).to.equal(parentId);
            expect(result.stepId).to.equal('step_2');
            expect(result.protocolVersion).to.equal(2);
        });

        it('should copy and lowercase x-eio-meta- headers', () => {
            const headers = {
                [MESSAGE_METADATA_HEADER]: JSON.stringify({
                    messageId: uuid.v4(),
                    threadId: uuid.v4(),
                    'x-eio-meta-trace-id': 'trace-123',
                    'X-EIO-META-CUSTOM': 'custom-value'
                })
            };
            const result = client._extractMessageMetadata(headers);
            expect(result['x-eio-meta-trace-id']).to.equal('trace-123');
            expect(result['x-eio-meta-custom']).to.equal('custom-value');
        });

        it('should fall back to x-eio-meta-trace-id as threadId when threadId is absent', () => {
            const traceId = uuid.v4();
            const headers = {
                [MESSAGE_METADATA_HEADER]: JSON.stringify({
                    messageId: uuid.v4(),
                    'x-eio-meta-trace-id': traceId
                })
            };
            const result = client._extractMessageMetadata(headers);
            expect(result.threadId).to.equal(traceId);
        });

        it('should generate a new threadId when neither threadId nor trace-id is present', () => {
            const headers = {
                [MESSAGE_METADATA_HEADER]: JSON.stringify({ messageId: uuid.v4() })
            };
            const result = client._extractMessageMetadata(headers);
            expect(result.threadId).to.be.a('string').and.have.lengthOf(36); // UUID
        });

        it('should include reply_to when present', () => {
            const headers = {
                [MESSAGE_METADATA_HEADER]: JSON.stringify({
                    messageId: uuid.v4(),
                    threadId: uuid.v4(),
                    reply_to: 'reply-queue'
                })
            };
            const result = client._extractMessageMetadata(headers);
            expect(result.reply_to).to.equal('reply-queue');
        });

        it('should throw when message-metadata header is missing', () => {
            expect(() => client._extractMessageMetadata({})).to.throw(
                'Missing metadata in message stream response'
            );
        });

        it('should throw when message-metadata header is invalid JSON', () => {
            expect(() => client._extractMessageMetadata({
                [MESSAGE_METADATA_HEADER]: 'not-json'
            })).to.throw('Failed to parse metadata JSON');
        });
    });

    // ── finishProcessing ─────────────────────────────────────────────────────

    describe('finishProcessing()', () => {
        let client;
        let mockStream;
        let mockSession;

        function makeRequestStub(statusCode, body) {
            return sinon.stub().callsFake(() => {
                setImmediate(() => {
                    mockStream.emit('response', { [HTTP2_HEADER_STATUS]: statusCode });
                    if (body) {
                        mockStream.emit('data', Buffer.from(body));
                    }
                    mockStream.emit('end');
                });
                return mockStream;
            });
        }

        beforeEach(() => {
            client = new ProxyClient(settings);
            mockStream = makeMockStream();
            mockSession = new EventEmitter();
            mockSession.request = makeRequestStub(200);
            mockSession.close = sinon.stub().callsFake((cb) => {
                if (cb) {
                    cb();
                }
            });
            mockSession.destroy = sinon.stub();
            mockSession.destroyed = false;
            client.closed = false;
            client.clientSession = mockSession;
        });

        it('should throw for an invalid status', async () => {
            const metadata = { messageId: uuid.v4() };
            try {
                await client.finishProcessing(metadata, 'invalid');
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e.message).to.equal('Invalid message processing status: invalid');
            }
        });

        it('should POST to /finish-processing with correct query params on success', async () => {
            const metadata = { messageId: 'msg-123' };
            client.processingMessagesMetadata.add(metadata);

            await client.finishProcessing(metadata, MESSAGE_PROCESSING_STATUS.SUCCESS);

            const callPath = mockSession.request.firstCall.args[0][':path'];
            expect(callPath).to.include('/finish-processing');
            expect(callPath).to.include('incomingMessageId=msg-123');
            expect(callPath).to.include('status=success');
            expect(callPath).to.include(`clientId=${settings.PROXY_CLIENT_ID}`);
        });

        it('should remove metadata from processingMessagesMetadata on success', async () => {
            const metadata = { messageId: 'msg-456' };
            client.processingMessagesMetadata.add(metadata);

            await client.finishProcessing(metadata, MESSAGE_PROCESSING_STATUS.SUCCESS);

            expect(client.processingMessagesMetadata.has(metadata)).to.be.false;
        });

        it('should reject with error when server returns non-200', async () => {
            mockSession.request = makeRequestStub(500, 'Internal Server Error');
            const metadata = { messageId: 'msg-789' };

            try {
                await client.finishProcessing(metadata, MESSAGE_PROCESSING_STATUS.ERROR);
                expect.fail('Should have rejected');
            } catch (e) {
                expect(e.message).to.equal('Internal Server Error');
            }
        });
    });

    // ── sendMessage ──────────────────────────────────────────────────────────

    describe('sendMessage()', () => {
        let client;
        let mockStream;
        let mockSession;

        beforeEach(() => {
            client = new ProxyClient(settings);
            mockStream = makeMockStream();
            mockSession = new EventEmitter();
            // Emit events INSIDE the request stub so they fire after listeners are attached
            mockSession.request = sinon.stub().callsFake(() => {
                setImmediate(() => {
                    mockStream.emit('response', { [HTTP2_HEADER_STATUS]: 200 });
                    mockStream.emit('end');
                });
                return mockStream;
            });
            mockSession.close = sinon.stub().callsFake((cb) => {
                if (cb) {
                    cb();
                }
            });
            mockSession.destroy = sinon.stub();
            mockSession.destroyed = false;
            client.closed = false;
            client.clientSession = mockSession;
        });

        it('should POST to /message with correct metadata header and encrypted body', async () => {
            const data = { body: { hello: 'world' }, headers: {} };
            const metadata = { taskId: 'task-1', stepId: 'step_1' };
            const incomingMessageId = uuid.v4();

            await client.sendMessage({ incomingMessageId, type: 'data', data, metadata });

            const reqHeaders = mockSession.request.firstCall.args[0];
            expect(reqHeaders[':path']).to.include('/message');
            expect(reqHeaders[':path']).to.include(`incomingMessageId=${incomingMessageId}`);
            expect(reqHeaders[':path']).to.include('type=data');

            const sentMeta = JSON.parse(reqHeaders[MESSAGE_METADATA_HEADER]);
            expect(sentMeta.taskId).to.equal('task-1');
            expect(sentMeta.protocolVersion).to.equal(settings.PROTOCOL_VERSION);

            expect(mockStream.write).to.have.been.calledOnce; // encrypted body was written
        });

        it('should include customRoutingKey in query params when present in data.headers', async () => {
            const data = { body: {}, headers: { 'x-eio-routing-key': 'custom.route' } };
            await client.sendMessage({ incomingMessageId: 'id-1', type: 'data', data, metadata: {} });

            const path = mockSession.request.firstCall.args[0][':path'];
            expect(path).to.include('customRoutingKey=custom.route');
        });

        it('should reject with error on non-200 response', async () => {
            mockSession.request = sinon.stub().callsFake(() => {
                setImmediate(() => {
                    mockStream.emit('response', { [HTTP2_HEADER_STATUS]: 500 });
                    mockStream.emit('data', Buffer.from('server error'));
                    mockStream.emit('end');
                });
                return mockStream;
            });
            try {
                await client.sendMessage({
                    incomingMessageId: 'id-1',
                    type: 'data',
                    data: { body: {} },
                    metadata: {}
                });
                expect.fail('Should have rejected');
            } catch (e) {
                expect(e.message).to.equal('server error');
            }
        });

        it('should reject and mark error as isNetworkError on stream error', async () => {
            mockSession.request = sinon.stub().callsFake(() => {
                setImmediate(() => {
                    mockStream.emit('error', new Error('ECONNRESET'));
                });
                return mockStream;
            });
            try {
                await client.sendMessage({
                    incomingMessageId: 'id-1',
                    type: 'data',
                    data: { body: {} },
                    metadata: {}
                });
                expect.fail('Should have rejected');
            } catch (e) {
                expect(e.message).to.equal('ECONNRESET');
            }
        });
    });

    // ── sendError ────────────────────────────────────────────────────────────

    describe('sendError()', () => {
        let client;
        let sendMessageStub;

        beforeEach(() => {
            client = new ProxyClient(settings);
            sendMessageStub = sandbox.stub(client, 'sendMessage').resolves();
        });

        it('should call sendMessage with type=error and encrypted error payload', async () => {
            const err = { name: 'TestError', message: 'boom', stack: 'at line 1' };
            const outgoingMetadata = { stepId: 'step_1' };
            const incomingMetadata = { messageId: 'msg-1', protocolVersion: 1 };

            await client.sendError(err, outgoingMetadata, null, incomingMetadata);

            expect(sendMessageStub).to.have.been.calledOnce;
            const args = sendMessageStub.firstCall.args[0];
            expect(args.type).to.equal('error');
            expect(args.incomingMessageId).to.equal('msg-1');

            const payload = JSON.parse(args.data);
            expect(payload).to.have.property('error');
            // error is: encryptMessageContent({...}, 'base64').toString()
            // so it's a base64 string that itself is base64-encoded ciphertext
            const decryptedError = encryptor.decryptMessageContent(payload.error, 'base64');
            expect(decryptedError.message).to.equal('boom');
        });

        it('should include errorInput for protocolVersion 1', async () => {
            const err = { name: 'E', message: 'msg', stack: '' };
            const originalMsg = { body: { original: true } };
            const incomingMeta = { messageId: 'id-1', protocolVersion: 1 };

            await client.sendError(err, {}, originalMsg, incomingMeta);

            const payload = JSON.parse(sendMessageStub.firstCall.args[0].data);
            expect(payload).to.have.property('errorInput');
        });

        it('should include errorInput for protocolVersion 2', async () => {
            const err = { name: 'E', message: 'msg', stack: '' };
            const originalMsg = { body: { original: true } };
            const incomingMeta = { messageId: 'id-1', protocolVersion: 2 };

            await client.sendError(err, {}, originalMsg, incomingMeta);

            const payload = JSON.parse(sendMessageStub.firstCall.args[0].data);
            expect(payload).to.have.property('errorInput');
        });

        it('should omit errorInput when originalMessage is not provided', async () => {
            const err = { name: 'E', message: 'no-input', stack: '' };
            await client.sendError(err, {}, null, { messageId: 'id-1' });

            const payload = JSON.parse(sendMessageStub.firstCall.args[0].data);
            expect(payload).to.not.have.property('errorInput');
        });
    });

    // ── sendRebound ──────────────────────────────────────────────────────────

    describe('sendRebound()', () => {
        let client;
        let sendMessageStub;

        beforeEach(() => {
            client = new ProxyClient(settings);
            sendMessageStub = sandbox.stub(client, 'sendMessage').resolves();
        });

        it('should call sendMessage with type=rebound and reboundReason', async () => {
            const reboundError = new Error('Too busy');
            const metadata = { messageId: 'msg-1' };
            const outgoingMetadata = { stepId: 'step_1' };

            await client.sendRebound(reboundError, metadata, outgoingMetadata);

            expect(sendMessageStub).to.have.been.calledOnce;
            const args = sendMessageStub.firstCall.args[0];
            expect(args.type).to.equal('rebound');
            expect(args.incomingMessageId).to.equal('msg-1');
            expect(args.metadata.reboundReason).to.equal('Too busy');
            expect(args.metadata.end).to.be.a('number');
        });
    });

    // ── sendSnapshot ─────────────────────────────────────────────────────────

    describe('sendSnapshot()', () => {
        let client;
        let sendMessageStub;

        beforeEach(() => {
            client = new ProxyClient(settings);
            sendMessageStub = sandbox.stub(client, 'sendMessage').resolves();
        });

        it('should call sendMessage with type=snapshot and JSON-stringified data', async () => {
            const snapData = { lastModified: 12345 };
            const meta = { stepId: 'step_1' };

            await client.sendSnapshot(snapData, meta);

            expect(sendMessageStub).to.have.been.calledOnce;
            const args = sendMessageStub.firstCall.args[0];
            expect(args.type).to.equal('snapshot');
            expect(args.data).to.equal(JSON.stringify(snapData));
            expect(args.metadata).to.equal(meta);
        });
    });

    // ── fetchMessageBody ─────────────────────────────────────────────────────

    describe('fetchMessageBody()', () => {
        const OBJECT_ID_HEADER = 'x-ipaas-object-storage-id';
        let client;
        let mockStream;
        let mockSession;
        const logger = { debug: () => {}, trace: () => {}, error: () => {} };

        function makeRequestStub(statusCode, body) {
            return sinon.stub().callsFake(() => {
                setImmediate(() => {
                    mockStream.emit('response', { [HTTP2_HEADER_STATUS]: statusCode });
                    if (body) {
                        mockStream.emit('data', body);
                    }
                    mockStream.emit('end');
                });
                return mockStream;
            });
        }

        beforeEach(() => {
            client = new ProxyClient(settings);
            mockStream = makeMockStream();
            mockSession = new EventEmitter();
            mockSession.request = makeRequestStub(200);
            mockSession.close = sinon.stub().callsFake((cb) => {
                if (cb) {
                    cb();
                }
            });
            mockSession.destroy = sinon.stub();
            mockSession.destroyed = false;
            client.closed = false;
            client.clientSession = mockSession;
        });

        it('should return body as-is when headers are absent', async () => {
            const msg = { body: { raw: true }, headers: null };
            const result = await client.fetchMessageBody(msg, logger);
            expect(result).to.deep.equal(msg.body);
            expect(mockSession.request).not.to.have.been.called;
        });

        it('should return body as-is when OBJECT_ID_HEADER is not set', async () => {
            const msg = { body: { raw: true }, headers: {} };
            const result = await client.fetchMessageBody(msg, logger);
            expect(result).to.deep.equal(msg.body);
            expect(mockSession.request).not.to.have.been.called;
        });

        it('should GET /object/:id and return decrypted body on success', async () => {
            const objectId = 'obj-abc';
            const payload = { fetched: 'data' };
            const encrypted = encryptor.encryptMessageContent(payload);
            const msg = {
                body: {},
                headers: { [OBJECT_ID_HEADER]: objectId }
            };

            mockSession.request = makeRequestStub(200, encrypted);
            const result = await client.fetchMessageBody(msg, logger);

            expect(result).to.deep.equal(payload);
            const path = mockSession.request.firstCall.args[0][':path'];
            expect(path).to.equal(`/object/${objectId}`);
        });

        it('should reject on non-200 response with statusCode on the error', async () => {
            const msg = { body: {}, headers: { [OBJECT_ID_HEADER]: 'obj-missing' } };
            mockSession.request = makeRequestStub(404, Buffer.from('Not Found'));
            const err = await client.fetchMessageBody(msg, logger).catch(e => e);
            expect(err.message).to.equal('Not Found');
            expect(err.statusCode).to.equal(404);
        });
    });

    // ── uploadMessageBody ────────────────────────────────────────────────────

    describe('uploadMessageBody()', () => {
        let client;
        let mockStream;
        let mockSession;

        function makeRequestStub(statusCode, body) {
            return sinon.stub().callsFake(() => {
                setImmediate(() => {
                    mockStream.emit('response', { [HTTP2_HEADER_STATUS]: statusCode });
                    if (body) {
                        mockStream.emit('data', Buffer.from(body));
                    }
                    mockStream.emit('end');
                });
                return mockStream;
            });
        }

        beforeEach(() => {
            client = new ProxyClient(settings);
            mockStream = makeMockStream();
            mockSession = new EventEmitter();
            mockSession.request = makeRequestStub(200, JSON.stringify({ objectId: 'default-id' }));
            mockSession.close = sinon.stub().callsFake((cb) => {
                if (cb) {
                    cb();
                }
            });
            mockSession.destroy = sinon.stub();
            mockSession.destroyed = false;
            client.closed = false;
            client.clientSession = mockSession;
        });

        it('should POST to /object and return the objectId on success', async () => {
            const payload = { data: 'to-store' };
            const objectId = 'new-object-id';
            mockSession.request = makeRequestStub(200, JSON.stringify({ objectId }));

            const result = await client.uploadMessageBody(payload);

            expect(result).to.equal(objectId);
            const path = mockSession.request.firstCall.args[0][':path'];
            expect(path).to.equal('/object');
            expect(mockStream.write).to.have.been.calledOnce; // encrypted body written
        });

        it('should reject on non-200 response', async () => {
            mockSession.request = makeRequestStub(500, 'upload failed');
            try {
                await client.uploadMessageBody({ data: 'x' });
                expect.fail('Should have rejected');
            } catch (e) {
                expect(e.message).to.equal('upload failed');
            }
        });
    });

    // ── _handleDisconnection ─────────────────────────────────────────────────

    describe('_handleDisconnection()', () => {
        it('should set reconnecting=true, destroy session, and schedule reconnect', () => {
            const client = new ProxyClient(settings);
            const mockSession = makeMockSession();
            client.closed = false;
            client.clientSession = mockSession;
            client._cleanupMessageStreams = sinon.stub();
            client._scheduleReconnect = sinon.stub();

            client._handleDisconnection('error', new Error('net'));

            expect(client.reconnecting).to.be.true;
            expect(mockSession.destroy).to.have.been.calledOnce;
            expect(client.clientSession).to.be.null;
            expect(client._scheduleReconnect).to.have.been.calledOnce;
        });

        it('should be a no-op if already closed', () => {
            const client = new ProxyClient(settings);
            client.closed = true;
            client._scheduleReconnect = sinon.stub();
            client._handleDisconnection('close');
            expect(client._scheduleReconnect).not.to.have.been.called;
        });

        it('should be a no-op if already reconnecting', () => {
            const client = new ProxyClient(settings);
            client.closed = false;
            client.reconnecting = true;
            client._scheduleReconnect = sinon.stub();
            client._handleDisconnection('close');
            expect(client._scheduleReconnect).not.to.have.been.called;
        });
    });

    // ── _scheduleReconnect ───────────────────────────────────────────────────

    describe('_scheduleReconnect()', () => {
        it('should set closed=true when max retries is reached', () => {
            const client = new ProxyClient(makeSettings({ PROXY_RECONNECT_MAX_RETRIES: 0 }));
            client.closed = false;
            client.reconnecting = true;
            client.reconnectAttempts = 0;

            client._scheduleReconnect();

            expect(client.closed).to.be.true;
            expect(client.reconnecting).to.be.false;
        });

        it('should skip reconnection if intentionally closed', () => {
            const client = new ProxyClient(settings);
            client.closed = true;
            client._reconnect = sinon.stub();

            client._scheduleReconnect();

            expect(client.reconnecting).to.be.false;
            expect(client._reconnect).not.to.have.been.called;
        });
    });

    // ── MESSAGE_PROCESSING_STATUS exports ────────────────────────────────────

    describe('MESSAGE_PROCESSING_STATUS', () => {
        it('should export SUCCESS = "success"', () => {
            expect(MESSAGE_PROCESSING_STATUS.SUCCESS).to.equal('success');
        });

        it('should export ERROR = "error"', () => {
            expect(MESSAGE_PROCESSING_STATUS.ERROR).to.equal('error');
        });
    });

    // ── Ping keepalive ───────────────────────────────────────────────────────

    describe('_startPingInterval() / _stopPingInterval()', () => {
        let clock;

        beforeEach(() => {
            clock = sinon.useFakeTimers();
        });

        afterEach(() => {
            clock.restore();
        });

        it('should send a ping on every interval tick', () => {
            const client = new ProxyClient(settings);
            const mockSession = makeMockSession();
            mockSession.ping = sinon.stub().yields(null, 5, Buffer.alloc(8));
            client.clientSession = mockSession;

            client._startPingInterval();
            clock.tick(settings.PROXY_PING_INTERVAL_MS);

            expect(mockSession.ping).to.have.been.calledOnce;
        });

        it('should not start a second interval if already running', () => {
            const client = new ProxyClient(settings);
            const mockSession = makeMockSession();
            mockSession.ping = sinon.stub().yields(null, 5, Buffer.alloc(8));
            client.clientSession = mockSession;

            client._startPingInterval();
            const first = client._pingInterval;
            client._startPingInterval();

            expect(client._pingInterval).to.equal(first);
        });

        it('should call _handleDisconnection if ping errors', () => {
            const client = new ProxyClient(settings);
            const mockSession = makeMockSession();
            const pingErr = new Error('ping timeout');
            mockSession.ping = sinon.stub().yields(pingErr, 0, Buffer.alloc(8));
            client.clientSession = mockSession;
            client.closed = false;
            client._handleDisconnection = sinon.stub();

            client._startPingInterval();
            clock.tick(settings.PROXY_PING_INTERVAL_MS);

            expect(client._handleDisconnection).to.have.been.calledOnce;
            expect(client._handleDisconnection.firstCall.args[0]).to.equal('ping_timeout');
        });

        it('should not call _handleDisconnection on ping error if closed', () => {
            const client = new ProxyClient(settings);
            const mockSession = makeMockSession();
            mockSession.ping = sinon.stub().yields(new Error('x'), 0, Buffer.alloc(8));
            client.clientSession = mockSession;
            client.closed = true;
            client._handleDisconnection = sinon.stub();

            client._startPingInterval();
            clock.tick(settings.PROXY_PING_INTERVAL_MS);

            expect(client._handleDisconnection).not.to.have.been.called;
        });

        it('_stopPingInterval should clear the interval', () => {
            const client = new ProxyClient(settings);
            const mockSession = makeMockSession();
            mockSession.ping = sinon.stub().yields(null, 5, Buffer.alloc(8));
            client.clientSession = mockSession;

            client._startPingInterval();
            expect(client._pingInterval).to.not.be.null;
            client._stopPingInterval();
            expect(client._pingInterval).to.be.null;

            clock.tick(settings.PROXY_PING_INTERVAL_MS * 2);
            expect(mockSession.ping).not.to.have.been.called;
        });

        it('should skip ping if session is destroyed', () => {
            const client = new ProxyClient(settings);
            const mockSession = makeMockSession();
            mockSession.ping = sinon.stub();
            mockSession.destroyed = true;
            client.clientSession = mockSession;

            client._startPingInterval();
            clock.tick(settings.PROXY_PING_INTERVAL_MS);

            expect(mockSession.ping).not.to.have.been.called;
        });
    });
});
