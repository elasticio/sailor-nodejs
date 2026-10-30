import { expect } from 'chai';
import * as helpers from './helpers/index.ts';
import { Encryptor } from '../../src/crypto/index.ts';
import type { FakeSailorProxy, ShellTester } from './helpers/index.ts';

// D4: a native ES module component is loaded with import() and runs end to end (forks run.js → dist/).
describe('ESM component', function test() {
    this.timeout(helpers.ShellTester.TIMEOUT_DEFAULT * 1.1);

    let env: helpers.TestEnv;
    let proxy: FakeSailorProxy;
    let sailor: ShellTester | null;

    beforeEach(async () => {
        env = helpers.prepareEnv();
        env.ELASTICIO_COMPONENT_PATH = helpers.ESM_COMPONENT_PATH;
        env.ELASTICIO_FUNCTION = 'echo_incoming_data';
        proxy = helpers.proxy(env);
        sailor = null;
        await proxy.start();
        await helpers.fakeApiServerStart(env, undefined, { logger: { info: () => {} } });
    });

    afterEach(async () => {
        await helpers.fakeApiServerStop();
        if (sailor && sailor.getExitResult() === null) {
            sailor.sendKill('SIGKILL');
            await sailor.getPromise().catch(() => {});
        }
        await proxy.stop();
    });

    it('processes a message and emits the returned value as data', async () => {
        sailor = helpers.ShellTester.init({ env: env as NodeJS.ProcessEnv });
        sailor.run();

        const received = new Promise<{ body: Buffer }>(resolve => proxy.once('message', (msg, type) => {
            if (type === 'data') {
                resolve(msg);
            }
        }));
        const finished = new Promise(resolve => proxy.once('finish-processing', resolve));
        proxy.queueMessage({ headers: { stepId: 'step_1' }, body: { hello: 'esm' } });

        const { body } = await received;
        const encryptor = new Encryptor(env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD, env.ELASTICIO_MESSAGE_CRYPTO_IV);
        const message = encryptor.decryptMessageContent(body, 'base64') as { body: Record<string, unknown> };
        expect(message.body).to.deep.include({ esm: true });
        expect(message.body.msg).to.deep.include({ body: { hello: 'esm' } });
        expect(await finished).to.include({ status: 'success' });

        sailor.sendKill();
        expect(await sailor.getPromise()).to.include({ code: 0 });
    });
});
