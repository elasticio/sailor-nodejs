import { expect } from 'chai';
import sinon from 'sinon';
import logging from '../../../src/logging/index.ts';
import { Sailor } from '../../../src/sailor.ts';
import { IPC, run, __test__ } from '../../../src/entrypoints/run.ts';
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
});
