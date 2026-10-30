import { expect } from 'chai';
import sinon from 'sinon';
import { createComponentLogger } from '../../../src/logging/index.ts';
import { HooksDataError } from '../../../src/hooks/hooks-data.ts';
import { Lifecycle, type HookContext } from '../../../src/hooks/lifecycle.ts';

describe('Lifecycle', () => {
    function setup(module: Record<string, unknown>, config: Record<string, unknown> | null = { k: 1 }) {
        const hooksData = {
            create: sinon.stub().resolves(),
            retrieve: sinon.stub().resolves(),
            delete: sinon.stub().resolves()
        };
        const logger = { debug: sinon.stub(), trace: sinon.stub(), warn: sinon.stub() };
        const context: HookContext = {
            logger: createComponentLogger(),
            getApiClient: () => ({}) as never,
            getConfig: () => ({}) as never
        };
        const lifecycle = new Lifecycle({
            loadModule: async () => module,
            getStepConfig: () => config ?? undefined,
            hooksData,
            context,
            logger
        });
        return { lifecycle, hooksData, logger, context };
    }

    describe('invoke', () => {
        it('calls the hook with a copy of cfg, data and the hook context as this (B7)', async () => {
            const config = { k: { nested: 1 } };
            const hook = sinon.stub().callsFake((cfg: { k: { nested: number } }) => {
                cfg.k.nested = 2; return 'r'; 
            });
            const { lifecycle, context } = setup({ init: hook }, config);
            expect(await lifecycle.invoke('init', 'data')).to.equal('r');
            expect(hook).to.have.been.calledOn(context).and.calledWith({ k: { nested: 2 } }, 'data');
            expect(config.k.nested).to.equal(1);
        });

        it('passes {} when there is no step config', async () => {
            const hook = sinon.stub();
            await setup({ init: hook }, null).lifecycle.invoke('init');
            expect(hook.firstCall.args[0]).to.deep.equal({});
        });

        it('awaits a returned promise', async () => {
            const { lifecycle } = setup({ init: async () => 'async' });
            expect(await lifecycle.invoke('init')).to.equal('async');
        });

        it('warns and resolves undefined for a missing hook', async () => {
            const { lifecycle, logger } = setup({});
            expect(await lifecycle.invoke('init')).to.equal(undefined);
            expect(logger.warn).to.have.been.calledWith('invokeModuleFunction – init is not found');
        });

        it('rejects on a sync throw', async () => {
            const { lifecycle } = setup({ init: () => {
                throw new Error('boom'); 
            } });
            const err = await lifecycle.invoke('init').catch((e: Error) => e);
            expect((err as Error).message).to.equal('boom');
        });
    });

    describe('startup', () => {
        it('stores the result as startup data', async () => {
            const { lifecycle, hooksData } = setup({ startup: () => ({ s: 1 }) });
            expect(await lifecycle.startup()).to.deep.equal({ s: 1 });
            expect(hooksData.create).to.have.been.calledOnceWith({ s: 1 });
        });

        it('stores {} for an empty result', async () => {
            const { lifecycle, hooksData } = setup({ startup: () => undefined });
            await lifecycle.startup();
            expect(hooksData.create).to.have.been.calledOnceWith({});
        });

        it('on 409 deletes and re-creates with the normalised state (B8)', async () => {
            const { lifecycle, hooksData } = setup({});
            hooksData.create.onFirstCall().rejects(new HooksDataError('exists', 409));
            await lifecycle.startup();
            expect(hooksData.delete).to.have.been.calledOnce;
            expect(hooksData.create).to.have.been.calledTwice;
            expect(hooksData.create.secondCall.args[0]).to.deep.equal({});
            sinon.assert.callOrder(hooksData.create, hooksData.delete);
        });

        it('rethrows other errors', async () => {
            const { lifecycle, hooksData } = setup({});
            hooksData.create.rejects(new HooksDataError('nope', 500));
            const err = await lifecycle.startup().catch((e: unknown) => e);
            expect(err).to.include({ statusCode: 500 });
            expect(hooksData.delete).not.to.have.been.called;
        });
    });

    describe('shutdown', () => {
        it('retrieves startup data, passes it to shutdown, then deletes it', async () => {
            const hook = sinon.stub().resolves();
            const { lifecycle, hooksData } = setup({ shutdown: hook });
            hooksData.retrieve.resolves({ s: 1 });
            await lifecycle.shutdown();
            expect(hook).to.have.been.calledWith({ k: 1 }, { s: 1 });
            sinon.assert.callOrder(hooksData.retrieve, hook, hooksData.delete);
        });

        it('does not delete when the hook fails', async () => {
            const { lifecycle, hooksData } = setup({ shutdown: () => Promise.reject(new Error('x')) });
            await lifecycle.shutdown().catch(() => undefined);
            expect(hooksData.delete).not.to.have.been.called;
        });
    });

    it('init runs the init hook', async () => {
        expect(await setup({ init: () => 'i' }).lifecycle.init()).to.equal('i');
    });
});
