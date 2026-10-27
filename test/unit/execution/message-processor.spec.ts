import { expect } from 'chai';
import sinon from 'sinon';
import type { Env } from '../../../src/settings/index.ts';
import type { MessageMetadata } from '../../../src/proxy/codec.ts';
import { MessageProcessor } from '../../../src/execution/message-processor.ts';
import type { IncomingPayload } from '../../../src/execution/outgoing.ts';
import type { ApiClient, StepData, TaskExec, TriggerOrAction } from '../../../src/execution/task-exec.ts';
import { OBJECT_ID_HEADER } from '../../../src/storage/index.ts';
import { makeSettings } from '../proxy/helpers.ts';

type Process = (this: TaskExec, msg: IncomingPayload, cfg: Record<string, unknown>, snapshot: unknown) => unknown;

function setup({ process, env = {}, stepData = {}, definition = {}, loadError }: {
    process?: Process;
    env?: Env;
    stepData?: StepData;
    definition?: Record<string, unknown>;
    loadError?: Error;
}) {
    const settings = makeSettings('http://proxy', env);
    const proxyClient = {
        sendMessage: sinon.stub().resolves(),
        sendError: sinon.stub().resolves(),
        sendRebound: sinon.stub().resolves(),
        sendSnapshot: sinon.stub().resolves(),
        finishProcessing: sinon.stub().resolves()
    };
    const module: TriggerOrAction = { process: process as TriggerOrAction['process'] };
    const componentReader = {
        loadTriggerOrAction: loadError ? sinon.stub().rejects(loadError) : sinon.stub().resolves(module),
        findTriggerOrActionDefinition: sinon.stub().returns({
            main: './x.js', autoResolveObjectReferences: true, ...definition
        })
    };
    const storage = {
        fetchMessageBody: sinon.stub().callsFake(async (m: { body?: unknown }) => m.body),
        uploadMessageBody: sinon.stub().resolves('uploaded-id')
    };
    const apiClient = { accounts: { update: sinon.stub().resolves() }, tasks: {} } as unknown as ApiClient
        & { accounts: { update: sinon.SinonStub } };
    const processor = new MessageProcessor({ settings, proxyClient, componentReader, storage, apiClient });
    processor.setStepData({ config: { _account: 'acc-1', apiKey: 'k' }, ...stepData });
    return { settings, proxyClient, componentReader, storage, apiClient, processor };
}

const metadata = (): MessageMetadata => ({ messageId: 'in-1', threadId: 'thread-1', parentMessageId: 'p-0' });
const payload = (extra: Partial<IncomingPayload> = {}): IncomingPayload => ({ headers: {}, body: { in: 1 }, ...extra });

describe('MessageProcessor', () => {
    afterEach(() => sinon.restore());

    it('sends data and finishes with success', async () => {
        const { processor, proxyClient, settings } = setup({
            process(msg) {
                return { body: { out: msg.body } };
            }
        });
        await processor.processMessage(metadata(), payload());

        expect(proxyClient.sendMessage).to.have.been.calledOnce;
        const { data, metadata: sent, type, incomingMessageId } = proxyClient.sendMessage.firstCall.args[0];
        expect(type).to.equal('data');
        expect(incomingMessageId).to.equal('in-1');
        expect(data).to.deep.equal({ body: { out: { in: 1 } }, headers: {} });
        expect(sent).to.include({
            parentMessageId: 'in-1', threadId: 'thread-1', execId: settings.EXEC_ID, taskId: settings.FLOW_ID,
            stepId: settings.STEP_ID, compId: settings.COMP_ID, function: settings.FUNCTION
        });
        expect(sent).not.to.have.property('messageId');
        expect(sent.start).to.be.a('number');
        expect(sent.end).to.be.a('number');
        expect(proxyClient.finishProcessing).to.have.been.calledOnceWith(sinon.match({ messageId: 'in-1' }), 'success');
        expect(processor.messagesCount).to.equal(0);
    });

    it('uses data.id as messageId and adds snake_case additional vars', async () => {
        const { processor, proxyClient } = setup({
            env: {
                ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS: 'ELASTICIO_FIRST, ELASTICIO_SECOND_ELASTICIO_ENV ',
                ELASTICIO_FIRST: 'first',
                ELASTICIO_SECOND_ELASTICIO_ENV: 'second'
            },
            process: () => ({ id: 'out-1', body: {} })
        });
        await processor.processMessage(metadata(), payload());
        expect(proxyClient.sendMessage.firstCall.args[0].metadata)
            .to.include({ messageId: 'out-1', first: 'first', second_elasticio_env: 'second' });
    });

    it('finishes only once when end is emitted twice', async () => {
        const { processor, proxyClient } = setup({
            async process() {
                await this.emit('data', { body: {} });
                await this.emit('end');
                await this.emit('end');
            }
        });
        await processor.processMessage(metadata(), payload());
        expect(proxyClient.sendMessage).to.have.been.calledOnce;
        expect(proxyClient.finishProcessing).to.have.been.calledOnce;
    });

    describe('passthrough', () => {
        const incoming = () => payload({ passthrough: { prev: { body: { p: 1 }, headers: {} } } });

        it('adds the outgoing message under STEP_ID', async () => {
            const { processor, proxyClient, settings } = setup({
                stepData: { is_passthrough: true },
                process: () => ({ body: { out: 1 } })
            });
            await processor.processMessage(metadata(), incoming());
            expect(proxyClient.sendMessage.firstCall.args[0].data).to.deep.equal({
                body: { out: 1 },
                headers: {},
                passthrough: {
                    prev: { body: { p: 1 }, headers: {} },
                    [settings.STEP_ID]: { body: { out: 1 }, headers: {} }
                }
            });
        });

        it('NO_SELF_PASSTHROUGH adds the incoming message under its stepId instead', async () => {
            const { processor, proxyClient } = setup({
                env: { ELASTICIO_NO_SELF_PASSTHROUGH: 'true' },
                stepData: { is_passthrough: true },
                process: () => ({ body: { out: 1 } })
            });
            await processor.processMessage({ ...metadata(), stepId: 'in-step' }, incoming());
            expect(proxyClient.sendMessage.firstCall.args[0].data.passthrough).to.deep.equal({
                prev: { body: { p: 1 }, headers: {} },
                'in-step': { body: { in: 1 }, headers: {} }
            });
        });
    });

    it('exposes flow variables', async () => {
        let vars: unknown;
        const { processor } = setup({
            stepData: { variables: { v: '1' } },
            process() {
                vars = this.getFlowVariables();
                return { body: {} };
            }
        });
        await processor.processMessage(metadata(), payload());
        expect(vars).to.deep.equal({ v: '1' });
    });

    describe('updateKeys', () => {
        it('updates the account', async () => {
            const { processor, apiClient, proxyClient } = setup({
                async process() {
                    await this.emit('updateKeys', { token: 't' });
                    await this.emit('end');
                }
            });
            await processor.processMessage(metadata(), payload());
            expect(apiClient.accounts.update).to.have.been.calledOnceWith('acc-1', { keys: { token: 't' } });
            expect(proxyClient.finishProcessing.firstCall.args[1]).to.equal('success');
        });

        it('emits error when the update fails', async () => {
            const { processor, apiClient, proxyClient } = setup({
                async process() {
                    await this.emit('updateKeys', {});
                    await this.emit('end');
                }
            });
            apiClient.accounts.update.rejects(new Error('update failed'));
            await processor.processMessage(metadata(), payload());
            expect(proxyClient.sendError.firstCall.args[0]).to.include({ message: 'update failed' });
            expect(proxyClient.finishProcessing.firstCall.args[1]).to.equal('error');
        });
    });

    it('sends rebound and finishes with success', async () => {
        const { processor, proxyClient } = setup({
            async process() {
                await this.emit('rebound', new Error('later'));
                await this.emit('end');
            }
        });
        await processor.processMessage(metadata(), payload());
        expect(proxyClient.sendRebound.firstCall.args[0]).to.include({ message: 'later', name: 'Error' });
        expect(proxyClient.finishProcessing.firstCall.args[1]).to.equal('success');
    });

    describe('snapshots', () => {
        it('snapshot replaces the local snapshot, passed to the next message', async () => {
            const seen: unknown[] = [];
            const { processor, proxyClient } = setup({
                stepData: { snapshot: { initial: true } },
                async process(_msg, _cfg, snapshot) {
                    seen.push(snapshot);
                    await this.emit('snapshot', { n: 1 });
                    await this.emit('end');
                }
            });
            await processor.processMessage(metadata(), payload());
            await processor.processMessage(metadata(), payload());
            expect(seen).to.deep.equal([{ initial: true }, { n: 1 }]);
            expect(proxyClient.sendSnapshot.firstCall.args[0]).to.deep.equal({ n: 1 });
            expect(proxyClient.sendSnapshot.firstCall.args[1]).to.include({ snapshotEvent: 'snapshot' });
        });

        it('updateSnapshot merges into the local snapshot', async () => {
            const { processor, proxyClient } = setup({
                stepData: { snapshot: { a: 1 } },
                async process() {
                    await this.emit('updateSnapshot', { b: 2 });
                    await this.emit('updateSnapshot', { $set: { c: 3 } });
                    await this.emit('updateSnapshot', 'not an object');
                    await this.emit('end');
                }
            });
            await processor.processMessage(metadata(), payload());
            expect(proxyClient.sendSnapshot).to.have.been.calledOnce;
            expect(proxyClient.sendSnapshot.firstCall.args[1]).to.include({ snapshotEvent: 'updateSnapshot' });
            expect(processor.snapshot).to.deep.equal({ a: 1, b: 2 });
        });
    });

    it('sends error and finishes with error', async () => {
        const { processor, proxyClient } = setup({
            process: () => {
                throw new Error('failed');
            }
        });
        await processor.processMessage(metadata(), payload({ body: { in: 2 } }));
        const [err, sentMetadata, original, incoming] = proxyClient.sendError.firstCall.args;
        expect(err).to.include({ message: 'failed', name: 'Error' });
        expect(err.stack).to.be.a('string');
        expect(sentMetadata.end).to.be.a('number');
        expect(original).to.deep.include({ body: { in: 2 } });
        expect(incoming).to.include({ messageId: 'in-1' });
        expect(proxyClient.finishProcessing.firstCall.args[1]).to.equal('error');
    });

    it('formats non-Error errors', async () => {
        const { processor, proxyClient } = setup({
            async process() {
                await this.emit('error', 'just a string');
                await this.emit('error', { message: 'obj' });
                await this.emit('error');
                await this.emit('end');
            }
        });
        await processor.processMessage(metadata(), payload());
        expect(proxyClient.sendError.getCalls().map(c => c.args[0])).to.deep.equal([
            { message: 'just a string', stack: 'Not Available', name: 'Error' },
            { message: 'obj', stack: 'Not Available', name: 'Error' },
            { message: 'Not Available', stack: 'Not Available', name: 'Error' }
        ]);
    });

    it('sends error and finishes with error when the trigger can not be loaded', async () => {
        const { processor, proxyClient } = setup({ loadError: new Error('no such trigger') });
        await processor.processMessage(metadata(), payload());
        expect(proxyClient.sendError.firstCall.args[0]).to.have.property('message', 'no such trigger');
        expect(proxyClient.finishProcessing).to.have.been.calledOnceWith(sinon.match.any, 'error');
        expect(processor.messagesCount).to.equal(0);
    });

    it('sends every data and error call', async () => {
        const { processor, proxyClient } = setup({
            async process() {
                await this.emit('data', { body: 1 });
                await this.emit('error', new Error('e1'));
                await this.emit('data', { body: 2 });
                await this.emit('error', new Error('e2'));
                await this.emit('end');
            }
        });
        await processor.processMessage(metadata(), payload());
        expect(proxyClient.sendMessage).to.have.been.calledTwice;
        expect(proxyClient.sendError).to.have.been.calledTwice;
    });

    it('sends httpReply and customType', async () => {
        const { processor, proxyClient } = setup({
            async process() {
                await this.emit('httpReply', { statusCode: 200, body: 'ok', headers: {} });
                await this.emit('customType', { type: 'pub-sub', payload: { x: 1 } });
                await this.emit('end');
            }
        });
        await processor.processMessage(metadata(), payload());
        const [reply, custom] = proxyClient.sendMessage.getCalls().map(c => c.args[0]);
        expect(reply).to.deep.include({ type: 'http-reply', data: { statusCode: 200, body: 'ok', headers: {} } });
        expect(custom).to.deep.include({ type: 'pub-sub', data: { x: 1 }, forceProtocolVersion: 2 });
    });

    it('reports an httpReply send failure to the component', async () => {
        let caught: unknown;
        const { processor, proxyClient } = setup({
            async process() {
                try {
                    await this.emit('httpReply', { statusCode: 200 });
                } catch (e) {
                    caught = e;
                }
                await this.emit('end');
            }
        });
        proxyClient.sendMessage.rejects(new Error('send failed'));
        await processor.processMessage(metadata(), payload());
        expect(caught).to.have.property('message', 'send failed');
    });

    describe('incoming lightweight messages', () => {
        const lightweight = () => payload({
            body: {},
            headers: { [OBJECT_ID_HEADER]: 'body-id' },
            passthrough: { prev: { body: {}, headers: { [OBJECT_ID_HEADER]: 'pt-id' } } }
        });

        it('fetches body and passthrough bodies before process', async () => {
            let received: IncomingPayload | undefined;
            const { processor, storage } = setup({
                process(msg) {
                    received = msg;
                    return { body: {} };
                }
            });
            storage.fetchMessageBody.callsFake(async (m: { headers: Record<string, string> }) =>
                ({ fetched: m.headers[OBJECT_ID_HEADER] }));
            await processor.processMessage(metadata(), lightweight());
            expect(received?.body).to.deep.equal({ fetched: 'body-id' });
            expect(received?.passthrough?.prev?.body).to.deep.equal({ fetched: 'pt-id' });
        });

        it('sends error and finishes with error when a fetch fails', async () => {
            const process = sinon.stub();
            const { processor, storage, proxyClient } = setup({ process });
            storage.fetchMessageBody.rejects(new Error('Failed to get message body with id=body-id'));
            await processor.processMessage(metadata(), lightweight());
            expect(process).not.to.have.been.called;
            expect(proxyClient.sendError.firstCall.args[0])
                .to.have.property('message', 'Failed to get message body with id=body-id');
            expect(proxyClient.finishProcessing.firstCall.args[1]).to.equal('error');
            expect(processor.messagesCount).to.equal(0);
        });

        it('with autoResolveObjectReferences off, downloads only empty passthrough bodies in onData', async () => {
            let received: IncomingPayload | undefined;
            const { processor, storage, proxyClient } = setup({
                definition: { autoResolveObjectReferences: false },
                stepData: { is_passthrough: true },
                process(msg) {
                    received = msg;
                    return { body: { out: 1 } };
                }
            });
            storage.fetchMessageBody.resolves({ fetched: true });
            await processor.processMessage(metadata(), lightweight());
            expect(received?.body).to.deep.equal({});
            expect(storage.fetchMessageBody).to.have.been.calledOnce;
            expect(proxyClient.sendMessage.firstCall.args[0].data.passthrough.prev.body)
                .to.deep.equal({ fetched: true });
        });
    });

    describe('outgoing lightweight messages', () => {
        const env = { ELASTICIO_EMIT_LIGHTWEIGHT_MESSAGE: 'true', ELASTICIO_OBJECT_STORAGE_SIZE_THRESHOLD: '10' };
        const incoming = () => payload({
            passthrough: {
                uploaded: { body: { big: 'x'.repeat(20) }, headers: { [OBJECT_ID_HEADER]: 'existing' } },
                fresh: { body: { big: 'y'.repeat(20) }, headers: {} }
            }
        });

        it('uploads body and passthrough bodies above the threshold', async () => {
            const { processor, storage, proxyClient } = setup({
                env,
                stepData: { is_passthrough: true },
                process: () => ({ body: { big: 'z'.repeat(20) }, headers: { h: 1 } })
            });
            storage.uploadMessageBody.onFirstCall().resolves('body-id').onSecondCall().resolves('fresh-id');
            await processor.processMessage(metadata(), incoming());

            expect(storage.uploadMessageBody).to.have.been.calledTwice;
            const { data } = proxyClient.sendMessage.firstCall.args[0];
            expect(data.body).to.deep.equal({});
            expect(data.headers).to.deep.equal({ h: 1, [OBJECT_ID_HEADER]: 'body-id' });
            expect(data.passthrough.uploaded).to.deep.equal({ body: {}, headers: { [OBJECT_ID_HEADER]: 'existing' } });
            expect(data.passthrough.fresh).to.deep.equal({ body: {}, headers: { [OBJECT_ID_HEADER]: 'fresh-id' } });
        });

        it('sends error and no data when an upload fails', async () => {
            const { processor, storage, proxyClient } = setup({
                env,
                process: () => ({ body: { big: 'z'.repeat(20) } })
            });
            storage.uploadMessageBody.rejects(new Error('maester down'));
            await processor.processMessage(metadata(), payload());
            expect(proxyClient.sendMessage).not.to.have.been.called;
            expect(proxyClient.sendError.firstCall.args[0])
                .to.have.property('message', 'Lightweight message/passthrough body upload error');
            expect(proxyClient.finishProcessing.firstCall.args[1]).to.equal('error');
        });

        it('does not upload below the threshold', async () => {
            const { processor, storage, proxyClient } = setup({ env, process: () => ({ body: { s: 1 } }) });
            await processor.processMessage(metadata(), payload());
            expect(storage.uploadMessageBody).not.to.have.been.called;
            expect(proxyClient.sendMessage.firstCall.args[0].data.body).to.deep.equal({ s: 1 });
        });
    });
});
