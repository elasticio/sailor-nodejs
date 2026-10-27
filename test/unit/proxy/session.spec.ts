import { EventEmitter } from 'node:events';
import type { ClientHttp2Session } from 'node:http2';
import { expect } from 'chai';
import sinon from 'sinon';
import logging from '../../../src/logging/index.ts';
import {
    ProxySession, getJitteredDelay, getMaxSessionMemory, type SessionSettings
} from '../../../src/proxy/session.ts';
import { ResumeProcessingFailedError } from '../../../src/proxy/errors.ts';
import { waitFor } from './helpers.ts';

describe('proxy session helpers', () => {
    it('getMaxSessionMemory: 1.2x the limit in MB, at least 10', () => {
        expect(getMaxSessionMemory(1000)).to.equal(10);
        expect(getMaxSessionMemory(100 * 1024 * 1024)).to.equal(120);
    });

    it('getJitteredDelay stays within ±factor', () => {
        for (let i = 0; i < 100; i++) {
            const d = getJitteredDelay(1000, 0.3);
            expect(d).to.be.within(700, 1300);
        }
        expect(getJitteredDelay(1000, 0)).to.equal(1000);
    });
});

class FakeSession extends EventEmitter {
    destroyed = false;
    ping = sinon.stub();
    request = sinon.stub().returns('stream');
    destroy(): void {
        this.destroyed = true;
    }
    close(cb?: () => void): void {
        this.destroyed = true;
        cb?.();
    }
}

describe('ProxySession', () => {
    const settings: SessionSettings = {
        SAILOR_PROXY_URI: 'http://proxy',
        OUTGOING_MESSAGE_SIZE_LIMIT: 100 * 1024 * 1024,
        PROXY_PING_INTERVAL_MS: 10000,
        PROXY_RECONNECT_MAX_RETRIES: Infinity,
        PROXY_RECONNECT_INITIAL_DELAY: 5,
        PROXY_RECONNECT_MAX_DELAY: 20,
        PROXY_RECONNECT_BACKOFF_MULTIPLIER: 2,
        PROXY_RECONNECT_JITTER_FACTOR: 0
    };
    let sessions: FakeSession[];
    let connect: sinon.SinonStub;
    /** Whether the next session answers `connect` (true) or `error` (false). */
    let reachable: boolean;
    /** When false, new sessions stay pending until the test emits `connect`. */
    let autoConnect: boolean;
    let session: ProxySession | undefined;

    const last = () => sessions.at(-1)!;
    const create = (extra: Partial<SessionSettings> = {}, hooks = {}) => {
        session = new ProxySession({ ...settings, ...extra }, hooks,
            connect as unknown as (a: string, o: object) => ClientHttp2Session);
        return session;
    };

    beforeEach(() => {
        sessions = [];
        reachable = true;
        autoConnect = true;
        connect = sinon.stub().callsFake(() => {
            const s = new FakeSession();
            sessions.push(s);
            const ok = reachable;
            if (!autoConnect) {
                return s;
            }
            setImmediate(() => (ok ? s.emit('connect') : s.emit('error', new Error('ECONNREFUSED'))));
            return s;
        });
    });

    afterEach(async () => {
        await session?.disconnect();
        session = undefined;
        sinon.restore();
    });

    it('connects with maxSessionMemory derived from OUTGOING_MESSAGE_SIZE_LIMIT', async () => {
        const s = create();
        expect(s.closed).to.equal(true);
        await s.connect();
        expect(connect).to.have.been.calledOnceWith('http://proxy', { maxSessionMemory: 120 });
        expect(s.closed).to.equal(false);
        expect(s.isConnected()).to.equal(true);
        expect(s.isHealthy()).to.equal(true);
        expect(s.request({ ':path': '/x' })).to.equal('stream');
    });

    it('rejects connect() when the session errors first', async () => {
        reachable = false;
        await expect(create().connect()).to.be.rejectedWith('ECONNREFUSED');
    });

    it('request() throws without a session', () => {
        expect(() => create().request({})).to.throw('No HTTP2 session');
    });

    it('disconnect() closes the session and does not reconnect', async () => {
        const s = create();
        await s.connect();
        await s.disconnect();
        last().emit('close');
        expect(s.closed).to.equal(true);
        expect(s.isConnected()).to.equal(false);
        expect(s.isHealthy()).to.equal(false);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(connect).to.have.been.calledOnce;
        await s.disconnect(); // already closed: no-op
    });

    for (const event of ['error', 'close', 'goaway', 'timeout']) {
        it(`reconnects on session "${event}": onDisconnect, destroy, reconnect, onReconnect`, async () => {
            const onDisconnect = sinon.stub();
            const onReconnect = sinon.stub().resolves();
            const s = create({}, { onDisconnect, onReconnect });
            await s.connect();
            const first = last();
            first.emit(event, event === 'error' ? new Error('boom') : undefined);

            expect(onDisconnect).to.have.been.calledOnce;
            expect(first.destroyed).to.equal(true);
            expect(s.reconnecting).to.equal(true);
            expect(s.isConnected()).to.equal(false);
            expect(s.isHealthy()).to.equal(true);

            await waitFor(() => onReconnect.called && !s.reconnecting);
            expect(connect).to.have.been.calledTwice;
            expect(s.isConnected()).to.equal(true);
        });
    }

    it('ignores further events while reconnecting', async () => {
        const onDisconnect = sinon.stub();
        const s = create({ PROXY_RECONNECT_INITIAL_DELAY: 50 }, { onDisconnect });
        await s.connect();
        last().emit('goaway', 0, 1);
        last().emit('close');
        last().emit('timeout');
        expect(onDisconnect).to.have.been.calledOnce;
    });

    it('backs off exponentially up to PROXY_RECONNECT_MAX_DELAY, then gives up after max retries', async () => {
        const setTimeoutSpy = sinon.spy(global, 'setTimeout');
        const s = create({ PROXY_RECONNECT_MAX_RETRIES: 4 });
        await s.connect();
        reachable = false;
        last().emit('close');

        await waitFor(() => s.closed);
        expect(s.reconnecting).to.equal(false);
        expect(s.isHealthy()).to.equal(false);
        expect(connect).to.have.callCount(5);
        const delays = setTimeoutSpy.getCalls()
            .filter(c => String(c.args[0]).includes('#reconnect'))
            .map(c => c.args[1]);
        expect(delays).to.deep.equal([5, 10, 20, 20]);
    });

    it('resets the attempt counter after a successful reconnect', async () => {
        const s = create({ PROXY_RECONNECT_MAX_RETRIES: 1 });
        await s.connect();
        for (let i = 0; i < 3; i++) {
            last().emit('close');
            await waitFor(() => !s.reconnecting);
            expect(s.isConnected()).to.equal(true);
        }
    });

    it('retries when onReconnect throws a regular error', async () => {
        const onReconnect = sinon.stub();
        onReconnect.onFirstCall().rejects(new Error('temporary'));
        onReconnect.resolves();
        const s = create({}, { onReconnect });
        await s.connect();
        last().emit('close');
        await waitFor(() => onReconnect.calledTwice && !s.reconnecting);
        expect(s.isConnected()).to.equal(true);
    });

    it('B6: ResumeProcessingFailedError goes to onFatalError, no further reconnects', async () => {
        const err = new ResumeProcessingFailedError(410, 'gone');
        const onFatalError = sinon.stub();
        const s = create({}, { onReconnect: sinon.stub().rejects(err), onFatalError });
        await s.connect();
        last().emit('close');
        await waitFor(() => onFatalError.called);
        expect(onFatalError).to.have.been.calledOnceWith(err);
        expect(s.reconnecting).to.equal(false);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(connect).to.have.been.calledTwice;
    });

    it('B6: without onFatalError, ResumeProcessingFailedError calls criticalErrorAndExit', async () => {
        const exit = sinon.stub(logging, 'criticalErrorAndExit');
        const err = new ResumeProcessingFailedError(500, '');
        const s = create({}, { onReconnect: sinon.stub().rejects(err) });
        await s.connect();
        last().emit('close');
        await waitFor(() => exit.called);
        expect(exit).to.have.been.calledWith('proxy.resumeProcessing', err);
    });

    it('disconnect() during the backoff cancels the reconnect', async () => {
        const s = create({ PROXY_RECONNECT_INITIAL_DELAY: 30 });
        await s.connect();
        last().emit('close');
        await s.disconnect();
        expect(s.reconnecting).to.equal(false);
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(connect).to.have.been.calledOnce;
    });

    it('disconnect() while a reconnect is connecting drops the new session', async () => {
        const onReconnect = sinon.stub().resolves();
        const s = create({}, { onReconnect });
        await s.connect();
        autoConnect = false;
        last().emit('close');
        await waitFor(() => connect.calledTwice);
        await s.disconnect();
        last().emit('connect');
        await new Promise(resolve => setImmediate(resolve));
        expect(onReconnect).not.to.have.been.called;
        expect(last().destroyed).to.equal(true);
        expect(s.isConnected()).to.equal(false);
    });

    describe('PING', () => {
        let clock: sinon.SinonFakeTimers;

        beforeEach(() => {
            clock = sinon.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        });

        it('pings every PROXY_PING_INTERVAL_MS and stops on disconnect', async () => {
            const s = create();
            await s.connect();
            clock.tick(10000);
            expect(last().ping).to.have.been.calledOnce;
            clock.tick(10000);
            expect(last().ping).to.have.been.calledTwice;
            await s.disconnect();
            clock.tick(30000);
            expect(last().ping).to.have.been.calledTwice;
        });

        it('a failed PING triggers a reconnect', async () => {
            const onDisconnect = sinon.stub();
            const s = create({}, { onDisconnect });
            await s.connect();
            last().ping.callsFake((cb: (err: Error | null, d: number) => void) => cb(new Error('timeout'), 0));
            clock.tick(10000);
            expect(onDisconnect).to.have.been.calledOnce;
            expect(s.reconnecting).to.equal(true);
        });
    });

    describe('ensureConnection', () => {
        it('resolves at once when connected', async () => {
            const s = create();
            await s.connect();
            await s.ensureConnection();
        });

        it('throws before connect()', async () => {
            await expect(create().ensureConnection()).to.be.rejectedWith('Connection is closed. Call connect() first.');
        });

        it('waits for an in-progress reconnect', async () => {
            const s = create({ PROXY_RECONNECT_INITIAL_DELAY: 50 });
            await s.connect();
            last().emit('close');
            await s.ensureConnection();
            expect(s.isConnected()).to.equal(true);
            expect(connect).to.have.been.calledTwice;
        });

        it('throws when the reconnect gives up while waiting', async () => {
            const s = create({ PROXY_RECONNECT_MAX_RETRIES: 1 });
            await s.connect();
            reachable = false;
            last().emit('close');
            await expect(s.ensureConnection())
                .to.be.rejectedWith('Failed to establish valid connection within timeout period');
        });
    });
});
