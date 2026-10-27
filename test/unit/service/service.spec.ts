import { expect } from 'chai';
import sinon from 'sinon';
import { processService, ServiceExec, type ServiceDeps } from '../../../src/service/index.ts';
import type { Env } from '../../../src/settings/index.ts';
import type { ApiClient } from '../../../src/execution/task-exec.ts';

const BASE_ENV = {
    ELASTICIO_POST_RESULT_URL: 'http://test.com/123/456',
    ELASTICIO_CFG: '{"_account":"acc"}',
    ELASTICIO_COMPONENT_PATH: '/comp',
    ELASTICIO_API_URI: 'http://api',
    ELASTICIO_API_USERNAME: 'user',
    ELASTICIO_API_KEY: 'key',
    ELASTICIO_ACTION_OR_TRIGGER: 'update',
    ELASTICIO_GET_MODEL_METHOD: 'getModel'
};

function setup({ module = {}, verify, statusCode = 200 }: {
    module?: Record<string, unknown>;
    verify?: (...args: unknown[]) => unknown;
    statusCode?: number;
} = {}) {
    const update = sinon.stub().resolves();
    const apiClient = { accounts: { update }, tasks: {} } as unknown as ApiClient;
    const componentReader = {
        init: sinon.stub().resolves(),
        loadVerifyCredentials: sinon.stub().resolves(verify ?? ((_cfg: unknown, cb: (e: unknown, r: unknown) => void) =>
            cb(null, { verified: true }))),
        loadTriggerOrAction: sinon.stub().resolves(module)
    };
    const request = sinon.stub().resolves({ statusCode, body: 'OK', headers: {} });
    const deps = { componentReader, request, createApiClient: () => apiClient } as unknown as ServiceDeps;
    const run = (method: string, env: Env = {}) => processService(method, { ...BASE_ENV, ...env }, deps);
    return { run, componentReader, request, update, apiClient };
}

describe('processService', () => {
    describe('rejects without posting', () => {
        it('when POST_RESULT_URL is missing', async () => {
            const { run, request } = setup();
            const err = await run('verifyCredentials', { ELASTICIO_POST_RESULT_URL: '' }).catch((e: Error) => e);
            expect((err as Error).message).to.equal('ELASTICIO_POST_RESULT_URL is not provided');
            expect(request).not.to.have.been.called;
        });

        it('when the POST answers non-200', async () => {
            const { run } = setup({ statusCode: 404 });
            const err = await run('verifyCredentials').catch((e: Error) => e);
            expect((err as Error).message).to.equal('Failed to POST data to http://test.com/123/456 (404, OK)');
        });

        it('B5: when API_REQUEST_RETRY_ATTEMPTS is not a number', async () => {
            const { run, request } = setup();
            const err = await run('verifyCredentials', { ELASTICIO_API_REQUEST_RETRY_ATTEMPTS: 'x' })
                .catch((e: Error) => e);
            expect(err).to.be.instanceOf(Error);
            expect(request).not.to.have.been.called;
        });
    });

    describe('posts an error response', () => {
        for (const [name, method, env, message] of [
            ['unknown method', 'unknownMethod', {}, 'Unknown service method "unknownMethod"'],
            ['no CFG', 'verifyCredentials', { ELASTICIO_CFG: '' }, 'ELASTICIO_CFG is not provided'],
            ['bad CFG', 'verifyCredentials', { ELASTICIO_CFG: '{' }, 'Unable to parse CFG'],
            ['no API_KEY', 'verifyCredentials', { ELASTICIO_API_KEY: '' }, 'ELASTICIO_API_KEY is not provided'],
            ['no ACTION_OR_TRIGGER', 'getMetaModel', { ELASTICIO_ACTION_OR_TRIGGER: '' },
                'ELASTICIO_ACTION_OR_TRIGGER is not provided'],
            ['no GET_MODEL_METHOD', 'selectModel', { ELASTICIO_GET_MODEL_METHOD: '' },
                'ELASTICIO_GET_MODEL_METHOD is not provided'],
            ['missing model method', 'selectModel', {}, 'Method "getModel" is not found in "update" action or trigger']
        ] as const) {
            it(name, async () => {
                const { run, request } = setup();
                const result = await run(method, env);
                expect(result).to.deep.equal({ status: 'error', data: { message } });
                expect(request.firstCall.args[0].data).to.deep.equal(result);
            });
        }
    });

    it('POSTs with keep-alive and retry config, moving URL credentials to basic auth', async () => {
        const { run, request } = setup();
        await run('verifyCredentials', {
            ELASTICIO_POST_RESULT_URL: 'http://u%40x:p%3A@test.com/123',
            ELASTICIO_API_REQUEST_RETRY_ATTEMPTS: '5',
            ELASTICIO_API_REQUEST_RETRY_DELAY: '7'
        });
        const [options, config] = request.firstCall.args;
        expect(options).to.include({ url: 'http://test.com/123', method: 'POST' });
        expect(options.auth).to.deep.equal({ username: 'u@x', password: 'p:' });
        expect(options.headers).to.deep.equal({ Connection: 'Keep-Alive' });
        expect(config).to.deep.equal({ retriesCount: 5, retryDelay: 7 });
    });

    describe('verifyCredentials', () => {
        it('inits the component reader and calls verify with cfg and this = ServiceExec', async () => {
            const verify = sinon.stub().resolves({ verified: true, extra: 1 });
            const { run, componentReader } = setup({ verify });
            expect(await run('verifyCredentials')).to.deep.equal({
                status: 'success', data: { verified: true, extra: 1 }
            });
            expect(componentReader.init).to.have.been.calledWith('/comp');
            expect(verify.firstCall.thisValue).to.be.instanceOf(ServiceExec);
            expect(verify.firstCall.args[0]).to.deep.equal({ _account: 'acc' });
            expect(verify.firstCall.thisValue.getConfig().API_KEY).to.equal('key');
        });

        it('a callback result without verified counts as verified', async () => {
            const { run } = setup({ verify: (_c, cb) => (cb as (e: unknown, r: unknown) => void)(null, 'yes') });
            expect((await run('verifyCredentials')).data).to.deep.equal({ verified: true });
        });

        it('keeps verified: false', async () => {
            const { run } = setup({ verify: async () => ({ verified: false }) });
            expect((await run('verifyCredentials')).data).to.deep.equal({ verified: false });
        });

        it('a rejection or throw becomes verified: false with the reason', async () => {
            const { run } = setup({ verify: () => {
                throw new Error('bad creds'); 
            } });
            expect(await run('verifyCredentials')).to.deep.equal({
                status: 'success', data: { verified: false, reason: 'bad creds' }
            });
        });

        it('B10: a load error becomes verified: false', async () => {
            const { run, componentReader } = setup();
            componentReader.loadVerifyCredentials.rejects(new Error('SyntaxError: x'));
            expect((await run('verifyCredentials')).data).to.deep.equal({ verified: false, reason: 'SyntaxError: x' });
        });
    });

    describe('model methods', () => {
        it('getMetaModel resolves via callback', async () => {
            const { run, componentReader } = setup({
                module: { getMetaModel: (_c: unknown, cb: (e: unknown, r: unknown) => void) => cb(null, { in: 1 }) }
            });
            expect(await run('getMetaModel')).to.deep.equal({ status: 'success', data: { in: 1 } });
            expect(componentReader.loadTriggerOrAction).to.have.been.calledWith('update');
        });

        it('selectModel resolves via a promise', async () => {
            const { run } = setup({ module: { getModel: async () => ({ a: 'A' }) } });
            expect((await run('selectModel')).data).to.deep.equal({ a: 'A' });
        });

        it('a rejection is posted as an error', async () => {
            const { run } = setup({ module: { getModel: async () => {
                throw new Error('nope'); 
            } } });
            expect(await run('selectModel')).to.deep.equal({ status: 'error', data: { message: 'nope' } });
        });

        it('waits for updateKeys before answering; failed updates are only logged', async () => {
            const update = Promise.withResolvers<void>();
            const { run, apiClient } = setup({
                module: {
                    async getModel(this: ServiceExec) {
                        this.emit('updateKeys', { oauth: 1 });
                        this.emit('updateKeys', { oauth: 2 });
                        return { m: 1 };
                    }
                }
            });
            const stub = apiClient.accounts.update as sinon.SinonStub;
            stub.onFirstCall().returns(update.promise);
            stub.onSecondCall().rejects(new Error('update failed'));
            let done = false;
            const result = run('selectModel').then(r => {
                done = true; return r; 
            });
            await new Promise(setImmediate);
            expect(done).to.equal(false);
            update.resolve();
            expect((await result).data).to.deep.equal({ m: 1 });
            expect(stub).to.have.been.calledWith('acc', { keys: { oauth: 1 } });
        });
    });
});
