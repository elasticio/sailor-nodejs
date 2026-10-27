import http from 'node:http';
import https from 'node:https';
import { expect } from 'chai';
import sinon from 'sinon';
import logging from '../../../src/logging/index.ts';
import { Sailor } from '../../../src/sailor.ts';
import { IPC, run, addProcessListeners, __test__ } from '../../../src/entrypoints/run.ts';
import { makeSettings } from '../proxy/helpers.ts';

describe('entrypoints/run', () => {
    let ipc: IPC & { send: sinon.SinonStub };
    let exit: sinon.SinonStub;

    beforeEach(() => {
        ipc = { send: sinon.stub() } as unknown as IPC & { send: sinon.SinonStub };
        exit = sinon.stub(logging, 'criticalErrorAndExit');
        for (const m of ['connect', 'prepare', 'startup', 'runHookInit', 'runHookShutdown', 'run'] as const) {
            sinon.stub(Sailor.prototype, m).resolves();
        }
    });

    afterEach(() => sinon.restore());

    it('connect → prepare → init → listen, with IPC init events', async () => {
        await run(makeSettings('http://proxy'), ipc);
        const p = Sailor.prototype as unknown as Record<string, sinon.SinonStub>;
        sinon.assert.callOrder(ipc.send.withArgs('init:started'), p.connect!, p.prepare!, p.runHookInit!,
            ipc.send.withArgs('init:ended'), p.run!);
        expect(p.startup).not.to.have.been.called;
        expect(p.runHookShutdown).not.to.have.been.called;
        expect(exit).not.to.have.been.called;
    });

    it('installs keep-alive global http/https agents', async () => {
        await run(makeSettings('http://proxy'), ipc);
        expect((http.globalAgent as http.Agent & { keepAlive: boolean }).keepAlive).to.equal(true);
        expect((https.globalAgent as https.Agent & { keepAlive: boolean }).keepAlive).to.equal(true);
    });

    it('runs startup when STARTUP_REQUIRED', async () => {
        await run(makeSettings('http://proxy', { ELASTICIO_STARTUP_REQUIRED: '1' }), ipc);
        const p = Sailor.prototype as unknown as Record<string, sinon.SinonStub>;
        sinon.assert.callOrder(p.prepare!, p.startup!, p.runHookInit!);
    });

    it('HOOK_SHUTDOWN: prepare + shutdown hook only, no connect, disconnectOnly is a no-op', async () => {
        await run(makeSettings('http://proxy', { ELASTICIO_HOOK_SHUTDOWN: '1' }), ipc);
        const p = Sailor.prototype as unknown as Record<string, sinon.SinonStub>;
        expect(p.connect).not.to.have.been.called;
        sinon.assert.callOrder(p.prepare!, p.runHookShutdown!);
        await __test__.disconnectOnly();
    });

    it('a failure is reported when connected, then criticalErrorAndExit', async () => {
        const error = new Error('init failed');
        (Sailor.prototype.runHookInit as sinon.SinonStub).rejects(error);
        sinon.stub(Sailor.prototype, 'isConnected').returns(true);
        const reportError = sinon.stub(Sailor.prototype, 'reportError').resolves();
        await run(makeSettings('http://proxy'), ipc);
        expect(reportError).to.have.been.calledOnceWith(error);
        expect(exit).to.have.been.calledOnceWith('putOutToSea.catch', error);
    });

    it('a failure is not reported when not connected', async () => {
        (Sailor.prototype.connect as sinon.SinonStub).rejects(new Error('no proxy'));
        sinon.stub(Sailor.prototype, 'isConnected').returns(false);
        const reportError = sinon.stub(Sailor.prototype, 'reportError').resolves();
        await run(makeSettings('http://proxy'), ipc);
        expect(reportError).not.to.have.been.called;
        expect(exit).to.have.been.calledOnce;
    });

    it('IPC.send is a no-op without a parent process', () => {
        expect(process.send).to.equal(undefined);
        new IPC().send('init:started');
    });

    describe('addProcessListeners', () => {
        let handlers: Record<string, (arg?: unknown) => void>;
        let processExit: sinon.SinonStub;
        let exited: Promise<number>;

        beforeEach(() => {
            handlers = {};
            sinon.stub(process, 'on').callsFake(((event: string, fn: (arg?: unknown) => void) => {
                handlers[event] = fn;
                return process;
            }) as never);
            let onExit: (code: number) => void;
            exited = new Promise(resolve => (onExit = resolve));
            processExit = sinon.stub(process, 'exit').callsFake(((code: number) => onExit(code)) as never);
            addProcessListeners();
        });

        const p = () => Sailor.prototype as unknown as Record<string, sinon.SinonStub>;

        for (const signal of ['SIGTERM', 'SIGINT']) {
            it(`${signal}: scheduleShutdown → disconnect → exit(0)`, async () => {
                const scheduleShutdown = sinon.stub(Sailor.prototype, 'scheduleShutdown').resolves();
                const disconnect = sinon.stub(Sailor.prototype, 'disconnect').resolves();
                await run(makeSettings('http://proxy'), ipc);
                handlers[signal]!();
                expect(await exited).to.equal(0);
                sinon.assert.callOrder(scheduleShutdown, disconnect, processExit);
            });
        }

        it('waits for the init hook before scheduling the shutdown', async () => {
            const init = Promise.withResolvers<void>();
            p().runHookInit!.returns(init.promise);
            const scheduleShutdown = sinon.stub(Sailor.prototype, 'scheduleShutdown').resolves();
            sinon.stub(Sailor.prototype, 'disconnect').resolves();
            const running = run(makeSettings('http://proxy'), ipc);
            await new Promise(resolve => setImmediate(resolve));
            handlers.SIGTERM!();
            await new Promise(resolve => setImmediate(resolve));
            expect(scheduleShutdown).not.to.have.been.called;
            init.resolve();
            expect(await exited).to.equal(0);
            expect(scheduleShutdown).to.have.been.calledOnce;
            await running;
        });

        it('B9: a shutdown failure exits 1', async () => {
            sinon.stub(Sailor.prototype, 'scheduleShutdown').rejects(new Error('stuck'));
            await run(makeSettings('http://proxy'), ipc);
            handlers.SIGTERM!();
            expect(await exited).to.equal(1);
        });

        it('is a no-op in HOOK_SHUTDOWN mode', async () => {
            const scheduleShutdown = sinon.stub(Sailor.prototype, 'scheduleShutdown').resolves();
            await run(makeSettings('http://proxy', { ELASTICIO_HOOK_SHUTDOWN: '1' }), ipc);
            handlers.SIGTERM!();
            await new Promise(resolve => setImmediate(resolve));
            expect(scheduleShutdown).not.to.have.been.called;
            expect(processExit).not.to.have.been.called;
        });

        it('uncaughtException → criticalErrorAndExit; unhandledRejection is only logged', () => {
            const logError = sinon.stub(logging, 'error');
            const err = new Error('oops');
            handlers.uncaughtException!(err);
            expect(exit).to.have.been.calledOnceWith('process.uncaughtException', err);
            handlers.unhandledRejection!(err);
            expect(logError).to.have.been.calledOnceWith(err, 'process.unhandledRejection');
            expect(exit).to.have.been.calledOnce;
        });
    });

    it('disconnectOnly disconnects after a normal run', async () => {
        const disconnect = sinon.stub(Sailor.prototype, 'disconnect').resolves();
        await run(makeSettings('http://proxy'), ipc);
        await __test__.disconnectOnly();
        expect(disconnect).to.have.been.calledOnce;
    });
});
