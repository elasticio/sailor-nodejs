import { expect } from 'chai';
import sinon from 'sinon';
import { Sailor, createSailor } from '../../src/sailor.ts';
import type { MessageMetadata } from '../../src/proxy/codec.ts';
import type { IncomingPayload } from '../../src/execution/outgoing.ts';
import { makeSettings } from './proxy/helpers.ts';

const META = { messageId: 'm' } as MessageMetadata;
const PAYLOAD = { body: {} } as IncomingPayload;

function setup(env: Record<string, string> = {}) {
    const settings = makeSettings('http://proxy', { ELASTICIO_COMPONENT_PATH: '/comp', ...env });
    const proxyClient = {
        connect: sinon.stub().resolves(),
        disconnect: sinon.stub().resolves(),
        isHealthy: sinon.stub().returns(true),
        listenForMessages: sinon.stub().resolves(),
        stopListeningForMessages: sinon.stub().resolves(),
        sendError: sinon.stub().resolves()
    };
    const componentReader = { init: sinon.stub().resolves() };
    const apiClient = { tasks: { retrieveStep: sinon.stub().resolves({ config: { a: 1 } }) } };
    const processor = {
        messagesCount: 0,
        setStepData: sinon.stub(),
        processMessage: sinon.stub().resolves()
    };
    const lifecycle = {
        startup: sinon.stub().resolves('s'),
        init: sinon.stub().resolves('i'),
        shutdown: sinon.stub().resolves()
    };
    const sailor = new Sailor({ settings, proxyClient, componentReader, apiClient, processor, lifecycle });
    return { sailor, settings, proxyClient, componentReader, apiClient, processor, lifecycle };
}

describe('Sailor', () => {
    it('connect / isConnected / disconnect delegate to the proxy client', async () => {
        const { sailor, proxyClient } = setup();
        await sailor.connect();
        expect(sailor.isConnected()).to.equal(true);
        await sailor.disconnect();
        expect(proxyClient.connect).to.have.been.calledOnce;
        expect(proxyClient.disconnect).to.have.been.calledOnce;
    });

    describe('prepare', () => {
        it('retrieves step data, hands it to the processor, then inits the component reader', async () => {
            const { sailor, apiClient, processor, componentReader } = setup();
            await sailor.prepare();
            expect(apiClient.tasks.retrieveStep).to.have.been.calledOnceWith('flow', 'step');
            expect(processor.setStepData).to.have.been.calledOnceWith({ config: { a: 1 } });
            expect(componentReader.init).to.have.been.calledOnceWith('/comp');
            sinon.assert.callOrder(apiClient.tasks.retrieveStep, processor.setStepData, componentReader.init);
        });

        it('fails when there is no step data', async () => {
            const { sailor, apiClient, componentReader } = setup();
            apiClient.tasks.retrieveStep.resolves(undefined);
            const err = await sailor.prepare().catch((e: unknown) => e);
            expect(err).to.be.instanceOf(Error);
            expect(componentReader.init).not.to.have.been.called;
        });
    });

    it('reportError sends the error with step metadata', async () => {
        const { sailor, proxyClient } = setup({
            ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS: 'ELASTICIO_X_A', ELASTICIO_X_A: 'v'
        });
        const err = new Error('boom');
        await sailor.reportError(err);
        const [sent, metadata] = proxyClient.sendError.firstCall.args;
        expect(sent).to.equal(err);
        expect(metadata).to.deep.equal({
            x_a: 'v',
            execId: 'exec', taskId: 'flow', workspaceId: 'workspace', containerId: 'container',
            userId: 'user', stepId: 'step', compId: 'comp', function: 'fn'
        });
    });

    it('hooks delegate to the lifecycle', async () => {
        const { sailor, lifecycle } = setup();
        expect(await sailor.startup()).to.equal('s');
        expect(await sailor.runHookInit()).to.equal('i');
        await sailor.runHookShutdown();
        expect(lifecycle.shutdown).to.have.been.calledOnce;
    });

    it('run listens for messages and processes them', async () => {
        const { sailor, proxyClient, processor } = setup();
        await sailor.run();
        const handler = proxyClient.listenForMessages.firstCall.args[0];
        await handler(META, PAYLOAD);
        expect(processor.processMessage).to.have.been.calledOnceWith(META, PAYLOAD);
    });

    it('swallows processing errors', async () => {
        const { sailor, processor } = setup();
        processor.processMessage.rejects(new Error('bad'));
        await sailor.processMessageAndMaybeShutdownCallback(META, PAYLOAD);
    });

    describe('scheduleShutdown', () => {
        it('stops listening and resolves at once when idle', async () => {
            const { sailor, proxyClient } = setup();
            await sailor.scheduleShutdown();
            expect(proxyClient.stopListeningForMessages).to.have.been.calledOnce;
        });

        it('waits for the last in-flight message', async () => {
            const { sailor, processor } = setup();
            processor.messagesCount = 2;
            let resolved = false;
            const shutdown = sailor.scheduleShutdown().then(() => {
                resolved = true; 
            });
            await new Promise(setImmediate);

            processor.messagesCount = 1;
            await sailor.processMessageAndMaybeShutdownCallback(META, PAYLOAD);
            expect(resolved).to.equal(false);

            processor.messagesCount = 0;
            await sailor.processMessageAndMaybeShutdownCallback(META, PAYLOAD);
            await shutdown;
            expect(resolved).to.equal(true);
        });

        it('B11: repeated calls return the same promise and release every caller', async () => {
            const { sailor, processor, proxyClient } = setup();
            processor.messagesCount = 1;
            const first = sailor.scheduleShutdown();
            const second = sailor.scheduleShutdown();
            expect(second).to.equal(first);
            await new Promise(setImmediate);
            processor.messagesCount = 0;
            await sailor.processMessageAndMaybeShutdownCallback(META, PAYLOAD);
            await Promise.all([first, second]);
            expect(proxyClient.stopListeningForMessages).to.have.been.calledOnce;
        });

        it('resolves when the last message finishes while stopListeningForMessages is pending', async () => {
            const { sailor, processor, proxyClient } = setup();
            const stop = Promise.withResolvers<void>();
            proxyClient.stopListeningForMessages.returns(stop.promise);
            processor.messagesCount = 1;
            const shutdown = sailor.scheduleShutdown();
            processor.messagesCount = 0;
            await sailor.processMessageAndMaybeShutdownCallback(META, PAYLOAD);
            stop.resolve();
            await shutdown;
        });

        it('rejects when stopListeningForMessages fails', async () => {
            const { sailor, proxyClient } = setup();
            proxyClient.stopListeningForMessages.rejects(new Error('stop failed'));
            const err = await sailor.scheduleShutdown().catch((e: unknown) => e);
            expect((err as Error).message).to.equal('stop failed');
        });
    });

    it('createSailor wires real collaborators', () => {
        const sailor = createSailor(makeSettings('http://proxy', { ELASTICIO_OBJECT_STORAGE_URI: 'http://maester' }));
        expect(sailor).to.be.instanceOf(Sailor);
        expect(sailor.messagesCount).to.equal(0);
        expect(sailor.isConnected()).to.equal(false);
    });
});
