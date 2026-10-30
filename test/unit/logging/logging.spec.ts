import { expect } from 'chai';
import sinon from 'sinon';
import bunyan from 'bunyan';
import { PROXY_CLIENT_ID } from '../../../src/settings/index.ts';
import {
    buildContext, createComponentLogger, createSailorLogger, resolveLevel, type ComponentLogger
} from '../../../src/logging/index.ts';

function capture(logger: bunyan | ComponentLogger): Record<string, unknown>[] {
    const ring = new bunyan.RingBuffer({ limit: 100 });
    (logger as bunyan).addStream({ type: 'raw', stream: ring, level: 'trace' });
    return ring.records as Record<string, unknown>[];
}

describe('logging', () => {
    afterEach(() => sinon.restore());

    describe('resolveLevel', () => {
        it('uses LOG_LEVEL', () => {
            expect(resolveLevel({ LOG_LEVEL: 'debug', NODE_ENV: 'test' })).to.equal('debug');
        });
        it('defaults to info', () => {
            expect(resolveLevel({})).to.equal('info');
        });
        it('is silent under NODE_ENV=test', () => {
            expect(resolveLevel({ NODE_ENV: 'test' })).to.equal(bunyan.FATAL + 1);
        });
    });

    describe('buildContext', () => {
        it('copies only known ELASTICIO_* vars that are set, plus tag and PROXY_CLIENT_ID', () => {
            expect(buildContext({ ELASTICIO_FLOW_ID: 'flow', ELASTICIO_EXEC_ID: 'exec', ELASTICIO_API_KEY: 'k' }))
                .to.deep.equal({
                    ELASTICIO_FLOW_ID: 'flow',
                    ELASTICIO_EXEC_ID: 'exec',
                    tag: 'flow',
                    PROXY_CLIENT_ID
                });
        });
    });

    describe('sailor logger', () => {
        it('logs as "sailor" with context fields', () => {
            const log = createSailorLogger({ ELASTICIO_STEP_ID: 'step', NODE_ENV: 'test' });
            const records = capture(log);
            log.info('hello');
            expect(records[0]).to.include({ name: 'sailor', msg: 'hello', ELASTICIO_STEP_ID: 'step', PROXY_CLIENT_ID });
        });

        it('has bound log methods', () => {
            const log = createSailorLogger({ NODE_ENV: 'test' });
            const records = capture(log);
            const { warn } = log;
            warn('bare');
            expect(records[0]).to.include({ msg: 'bare' });
        });

        describe('criticalErrorAndExit', () => {
            it('logs an Error as fatal with the reason and exits 1', () => {
                const log = createSailorLogger({ NODE_ENV: 'test' });
                const exit = sinon.stub(process, 'exit');
                const fatal = sinon.stub(log, 'fatal');
                const err = new Error('boom');
                log.criticalErrorAndExit('why', err);
                expect(fatal).to.have.been.calledOnceWith(err, 'why');
                expect(exit).to.have.been.calledOnceWith(1);
            });

            it('logs a non-Error with "Error happened" and exits 1', () => {
                const log = createSailorLogger({ NODE_ENV: 'test' });
                const exit = sinon.stub(process, 'exit');
                const fatal = sinon.stub(log, 'fatal');
                log.criticalErrorAndExit('why', 'oops');
                expect(fatal).to.have.been.calledOnceWith({ err: 'oops', reason: 'why' }, 'Error happened');
                expect(exit).to.have.been.calledOnceWith(1);
            });
        });
    });

    describe('component logger', () => {
        it('logs as "component" with context and options', () => {
            const log = createComponentLogger({ threadId: 't1' }, { ELASTICIO_FLOW_ID: 'flow', NODE_ENV: 'test' });
            const records = capture(log);
            log.info('hi');
            expect(records[0]).to.include({ name: 'component', msg: 'hi', threadId: 't1', tag: 'flow' });
        });

        it('stringifies a non-string first argument', () => {
            const log = createComponentLogger({}, { NODE_ENV: 'test' });
            const records = capture(log);
            log.error({ a: 1 });
            log.warn(42, 'extra');
            expect(records[0]).to.include({ msg: '[object Object]' });
            expect(records[1]).to.include({ msg: '42 extra' });
        });

        it('child loggers are decorated too', () => {
            const parent = createComponentLogger({}, { NODE_ENV: 'test' });
            const records = capture(parent);
            const child = parent.child({ messageId: 'm' });
            child.info(7);
            expect(records[0]).to.include({ msg: '7', messageId: 'm' });
        });
    });
});
