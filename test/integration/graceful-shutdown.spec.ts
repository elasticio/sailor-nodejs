import { expect } from 'chai';
import * as helpers from './helpers/index.ts';
import type { FakeSailorProxy, ShellTester, TestEnv } from './helpers/index.ts';


describe('Graceful shutdown', function test() {
    this.timeout(helpers.ShellTester.TIMEOUT_DEFAULT * 1.1);

    const inputMessage = {
        headers: {
            stepId: 'step_1'
        },
        body: {
            message: 'test'
        }
    };

    let proxyHelper: FakeSailorProxy;
    let env: TestEnv;
    let sailorTester: ShellTester | null;

    beforeEach(async () => {
        env = helpers.prepareEnv();
        proxyHelper = helpers.proxy(env);
        sailorTester = null;
        await proxyHelper.start();
        await helpers.fakeApiServerStart(env);
    });

    afterEach(async () => {
        await helpers.fakeApiServerStop();
        // Kill subprocess if it's still alive (e.g., the test failed early)
        if (sailorTester && sailorTester.getExitResult() === null) {
            sailorTester.sendKill('SIGKILL');
            await Promise.race([
                sailorTester.getPromise().catch(() => {}),
                new Promise(resolve => setTimeout(resolve, 1000))
            ]);
        }
        await proxyHelper.stop();
    });

    describe('start, no messages, shutdown', () => {
        it('should shutdown instantly after fully initialized', async () => {
            env.ELASTICIO_FUNCTION = 'echo_incoming_data';

            const tester = sailorTester = helpers.ShellTester.init({
                timeout: 1000,
                env: env as NodeJS.ProcessEnv
            });

            tester.run();

            // let (sailor) to start consuming messages
            await tester.waitForEvent('init:ended');

            tester.sendKill();

            // if sailor won't shutdown shortly, this promise will be rejected since tester.timeout is 1000ms
            await tester.getPromise();
        });

        it('should shutdown w/o errors in any random moment', async () => {
            env.ELASTICIO_FUNCTION = 'echo_incoming_data';

            const tester = sailorTester = helpers.ShellTester.init({
                timeout: 1000,
                env: env as NodeJS.ProcessEnv
            });

            tester.run();

            // wait a bit to make sailor start initialization process
            await tester.waitForEvent('init:started');

            tester.sendKill();

            // if sailor won't shutdown shortly, this promise will be rejected since tester.timeout is 1000ms
            await tester.getPromise();
        });
    });

    describe('start, no messages, shutdown, send more messages', () => {
        it('should not consume messages', async () => {
            env.ELASTICIO_FUNCTION = 'echo_incoming_data';

            const tester = sailorTester = helpers.ShellTester.init({
                timeout: 1500,
                env: env as NodeJS.ProcessEnv
            });

            tester.run();

            // let sailor to start consuming messages
            await tester.waitForEvent('init:ended');

            tester.sendKill();

            // let sailor to schedule shutdown
            await new Promise(resolve => setTimeout(resolve, 200));
            proxyHelper.queueMessage(inputMessage);

            // let proxy to settle
            await new Promise(resolve => setTimeout(resolve, 500));

            // if sailor won't shutdown shortly, this promise will be rejected since tester.timeout is 1000ms
            await tester.getPromise();

            // make sure the message won't be consumed by the sailor
            const messagesLeft = await proxyHelper.retrieveMessagesNotConsumed();
            expect(messagesLeft).to.have.lengthOf(1);
        });
    });

    describe('start, one message, fast message processing in sailor, shutdown', () => {
        it('should shutdown shortly', async () => {
            // selecting certain trigger of the component
            env.ELASTICIO_FUNCTION = 'echo_incoming_data';

            const tester = sailorTester = helpers.ShellTester.init({ env: env as NodeJS.ProcessEnv });
            tester.run();

            proxyHelper.queueMessage(inputMessage);

            // let (sailor + proxy) some time to handle all messages
            await tester.waitForEvent('init:ended');
            await new Promise(resolve => setTimeout(resolve, 500));

            tester.sendKill();

            // waiting until sailor finished
            await tester.getPromise();

            // make sure that echo_incoming_data finished processing
            expect(proxyHelper.dataMessages).to.have.lengthOf(1);

            // make sure that incoming messages queue is empty
            const messagesLeft = await proxyHelper.retrieveMessagesNotConsumed();
            expect(messagesLeft).to.have.lengthOf(0);
        });
    });

    describe('start, one message, slow processing, shutdown earlier than processing time', () => {
        it('should shutdown after processing', async () => {
            // selecting certain trigger of the component
            env.ELASTICIO_FUNCTION = 'wait_2_seconds_and_echo_incoming_data';

            const tester = sailorTester = helpers.ShellTester.init({ env: env as NodeJS.ProcessEnv });
            tester.run();

            proxyHelper.queueMessage(inputMessage);

            // let (sailor + proxy) some time to handle all messages
            await tester.waitForEvent('init:started');
            await new Promise(resolve => setTimeout(resolve, 500));

            // just to double check, that sailor has not processed the message yet
            // (otherwise this test is equal to previous)
            expect(proxyHelper.dataMessages).to.have.lengthOf(0);

            tester.sendKill();

            // waiting until sailor finished
            await tester.getPromise();

            // make sure that echo_incoming_data finished processing
            expect(proxyHelper.dataMessages).to.have.lengthOf(1);

            // make sure that incoming messages queue is empty
            const messagesLeft = await proxyHelper.retrieveMessagesNotConsumed();
            expect(messagesLeft).to.have.lengthOf(0);
        });
    });

    describe('start, one message, slow processing, shutdown twice', () => {
        it('should shutdown after processing', async () => {
            // selecting certain trigger of the component
            env.ELASTICIO_FUNCTION = 'wait_2_seconds_and_echo_incoming_data';

            const tester = sailorTester = helpers.ShellTester.init({ env: env as NodeJS.ProcessEnv });
            tester.run();

            proxyHelper.queueMessage(inputMessage);

            // let (sailor + proxy) some time to handle all messages
            await tester.waitForEvent('init:started');
            await new Promise(resolve => setTimeout(resolve, 500));

            // just to double check, that sailor has not processed the message yet
            // (otherwise this test is equal to previous)
            expect(proxyHelper.dataMessages).to.have.lengthOf(0);

            tester.sendKill();
            await new Promise(resolve => setTimeout(resolve, 50));
            tester.sendKill();
            await new Promise(resolve => setTimeout(resolve, 50));

            // waiting until sailor finished
            await tester.getPromise();

            // make sure that echo_incoming_data finished processing
            expect(proxyHelper.dataMessages).to.have.lengthOf(1);

            // make sure that incoming messages queue is empty
            const messagesLeft = await proxyHelper.retrieveMessagesNotConsumed();
            expect(messagesLeft).to.have.lengthOf(0);
        });
    });

    describe('start, two messages, slow processing, shutdown earlier than processing time', () => {
        it('should shutdown after processing of the first message', async () => {
            // selecting certain trigger of the component
            env.ELASTICIO_FUNCTION = 'wait_2_seconds_and_echo_incoming_data';

            const tester = sailorTester = helpers.ShellTester.init({ env: env as NodeJS.ProcessEnv });
            tester.run();

            proxyHelper.queueMessage(inputMessage);
            proxyHelper.queueMessage(inputMessage);

            // let (sailor + proxy) some time to handle all messages
            await tester.waitForEvent('init:started');
            await new Promise(resolve => setTimeout(resolve, 500));

            // just to double check, that sailor has not processed the message yet
            expect(proxyHelper.dataMessages).to.have.lengthOf(0);

            tester.sendKill();

            // waiting until sailor finished
            await tester.getPromise();

            // make sure that echo_incoming_data finished processing
            expect(proxyHelper.dataMessages).to.have.lengthOf(1);

            // sailor must not consume new messages once shutdown is scheduled
            // so make sure that the second message is not consumed
            const messagesLeft = await proxyHelper.retrieveMessagesNotConsumed();
            expect(messagesLeft).to.have.lengthOf(1);
        });
    });

    describe('start, two messages, wait for the first message processed, shutdown', () => {
        // FIXME –  I don't know how to test this without making a Wunderwaffe
        it('should shutdown after processing of the last message');
    });

    describe('start, two messages, fast processing, wait, shutdown', () => {
        it('should shutdown shortly', async () => {
            // selecting certain trigger of the component
            env.ELASTICIO_FUNCTION = 'echo_incoming_data';

            const tester = sailorTester = helpers.ShellTester.init({ env: env as NodeJS.ProcessEnv });

            proxyHelper.queueMessage(inputMessage);
            proxyHelper.queueMessage(inputMessage);

            tester.run();
            // let (sailor + proxy) some time to handle all messages
            await tester.waitForEvent('init:started');
            await new Promise(resolve => setTimeout(resolve, 2000));

            // make sure sailor has processed the messages
            expect(proxyHelper.dataMessages).to.have.lengthOf(2);

            tester.sendKill();

            // waiting until sailor finished
            await tester.getPromise();

            // make sure that no messages are left in the queue
            const messagesLeft = await proxyHelper.retrieveMessagesNotConsumed();
            expect(messagesLeft).to.have.lengthOf(0);
        });
    });
});
