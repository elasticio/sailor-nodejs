import nock from 'nock';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { Encryptor } from '../../../src/crypto/index.ts';
import { FakeSailorProxy } from './fake-sailor-proxy.ts';

export { FakeSailorProxy } from './fake-sailor-proxy.ts';
export { ShellTester } from './shell-tester.ts';

export const PREFIX = 'sailor_nodejs_integration_test';
export const FAKE_API_PORT = 1244; // most likely the port won't be taken
export const FAKE_PROXY_PORT = 1245;

/** Fixture components, relative to the repo root (the sailor resolves `COMPONENT_PATH` from cwd). */
export const CJS_COMPONENT_PATH = '/test/integration/fixtures/component';
export const ESM_COMPONENT_PATH = '/test/integration/fixtures/esm-component';

export type TestEnv = Record<string, string | undefined>;

export function prepareEnv(): TestEnv {
    const env: TestEnv = {};
    env.LOG_LEVEL = process.env.LOG_LEVEL;
    env.ELASTICIO_PROXY_PREFETCH_SAILOR = '1';
    env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
    env.ELASTICIO_STEP_ID = 'step_1';
    env.ELASTICIO_EXEC_ID = 'some-exec-id';

    env.ELASTICIO_WORKSPACE_ID = '5559edd38968ec073600683';
    env.ELASTICIO_CONTAINER_ID = 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948';

    env.ELASTICIO_USER_ID = '5559edd38968ec0736000002';
    env.ELASTICIO_COMP_ID = '5559edd38968ec0736000456';

    env.ELASTICIO_COMPONENT_PATH = CJS_COMPONENT_PATH;

    env.ELASTICIO_API_URI = `http://localhost:${FAKE_API_PORT}`;
    env.ELASTICIO_SAILOR_PROXY_URI = `http://localhost:${FAKE_PROXY_PORT}`;

    env.ELASTICIO_OUTGOING_MESSAGE_SIZE_LIMIT = '1000000';

    env.ELASTICIO_API_USERNAME = 'test@test.com';
    env.ELASTICIO_API_KEY = '5559edd';
    env.ELASTICIO_SAILOR_PROXY_JWT_SECRET = 'testSailorProxyJwtSecret';
    env.ELASTICIO_FLOW_WEBHOOK_URI = 'https://in.elastic.io/hooks/' + env.ELASTICIO_FLOW_ID;

    env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD = 'testCryptoPassword';
    env.ELASTICIO_MESSAGE_CRYPTO_IV = 'iv=any16_symbols';
    return env;
}

/** Call `await proxy.start()` in beforeEach and `await proxy.stop()` in afterEach. */
export function proxy(env: TestEnv): FakeSailorProxy {
    const encryptor = new Encryptor(env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD, env.ELASTICIO_MESSAGE_CRYPTO_IV);
    return new FakeSailorProxy(encryptor, FAKE_PROXY_PORT);
}

const defaultStepResponse = () => ({
    config: {
        apiKey: 'secret'
    },
    snapshot: {
        lastModifiedDate: 123456789
    }
});

export function mockApiTaskStepResponse(env: TestEnv, response?: object): void {
    nock(env.ELASTICIO_API_URI!)
        .matchHeader('Connection', 'Keep-Alive')
        .get(`/v1/tasks/${env.ELASTICIO_FLOW_ID}/steps/${env.ELASTICIO_STEP_ID}`)
        .reply(200, { ...defaultStepResponse(), ...response });
}

export interface FakeApiServer {
    app: Express;
    server: Server;
    requests: { url: string }[];
}

let fakeApiServer: FakeApiServer | undefined;

/** Real HTTP server for the step endpoint (forked sailors can't be reached by nock). */
export async function fakeApiServerStart(
    env: TestEnv,
    response?: object,
    { responseCode = 200, logger = console }: { responseCode?: number; logger?: Pick<Console, 'info'> } = {}
): Promise<FakeApiServer> {
    const app = express();
    const requests: { url: string }[] = [];

    app.get(`/v1/tasks/${env.ELASTICIO_FLOW_ID}/steps/${env.ELASTICIO_STEP_ID}`, (req, res) => {
        requests.push({ url: req.url });
        res.status(responseCode).json({ ...defaultStepResponse(), ...response });
    });
    const server = await new Promise<Server>((resolve) => {
        const srv = app.listen(FAKE_API_PORT, 'localhost', () => {
            logger.info(`FakeApiServer listening on localhost:${FAKE_API_PORT}`);
            resolve(srv);
        });
    });
    fakeApiServer = { app, server, requests };
    return fakeApiServer;
}

export async function fakeApiServerStop(): Promise<void> {
    const server = fakeApiServer?.server;
    fakeApiServer = undefined;
    if (server) {
        await new Promise(resolve => server.close(resolve));
    }
}
