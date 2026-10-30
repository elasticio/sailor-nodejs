import { expect } from 'chai';
import sinon from 'sinon';
import logging from '../../../src/logging/index.ts';
import { main } from '../../../src/entrypoints/run-service.ts';

describe('entrypoints/run-service', () => {
    let handlers: Record<string, (arg?: unknown) => void>;
    let exit: sinon.SinonStub;
    let processExit: sinon.SinonStub;
    const env = process.env;

    beforeEach(() => {
        handlers = {};
        sinon.stub(process, 'on').callsFake(((event: string, fn: (arg?: unknown) => void) => {
            handlers[event] = fn;
            return process;
        }) as never);
        exit = sinon.stub(logging, 'criticalErrorAndExit');
        processExit = sinon.stub(process, 'exit');
    });

    afterEach(() => {
        process.env = env;
        sinon.restore();
    });

    it('a failing service method goes through criticalErrorAndExit', async () => {
        process.env = {};
        await main('verifyCredentials');
        expect(exit).to.have.been.calledOnceWith('processService.catch',
            sinon.match({ message: 'ELASTICIO_POST_RESULT_URL is not provided' }));
        sinon.assert.callOrder(exit, processExit);
    });

    it('uncaughtException → criticalErrorAndExit; unhandledRejection is only logged', async () => {
        process.env = {};
        await main('verifyCredentials');
        exit.resetHistory();
        const logError = sinon.stub(logging, 'error');
        const err = new Error('oops');
        handlers.uncaughtException!(err);
        expect(exit).to.have.been.calledOnceWith('process.uncaughtException', err);
        handlers.unhandledRejection!(err);
        expect(logError).to.have.been.calledOnceWith(err, 'process.unhandledRejection');
    });
});
