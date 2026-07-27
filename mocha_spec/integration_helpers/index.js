'use strict';

const PREFIX = 'sailor_nodejs_integration_test';
const nock = require('nock');
const ShellTester = require('./ShellTester');
const FakeSailorProxy = require('./FakeSailorProxy');
const Encryptor = require('../../lib/encryptor');
const express = require('express');
const FAKE_API_PORT = 1244; // most likely the port won't be taken – https://www.adminsub.net/tcp-udp-port-finder/1244
const FAKE_PROXY_PORT = 1245;

function prepareEnv() {
    const env = {};
    env.LOG_LEVEL = process.env.LOG_LEVEL;
    env.ELASTICIO_PROXY_PREFETCH_SAILOR = '1';
    env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
    env.ELASTICIO_STEP_ID = 'step_1';
    env.ELASTICIO_EXEC_ID = 'some-exec-id';

    env.ELASTICIO_WORKSPACE_ID = '5559edd38968ec073600683';
    env.ELASTICIO_CONTAINER_ID = 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948';

    env.ELASTICIO_USER_ID = '5559edd38968ec0736000002';
    env.ELASTICIO_COMP_ID = '5559edd38968ec0736000456';

    env.ELASTICIO_COMPONENT_PATH = '/mocha_spec/integration_component';

    env.ELASTICIO_API_URI = `http://localhost:${FAKE_API_PORT}`;
    env.ELASTICIO_SAILOR_PROXY_URI = `http://localhost:${FAKE_PROXY_PORT}`;

    env.ELASTICIO_API_USERNAME = 'test@test.com';
    env.ELASTICIO_API_KEY = '5559edd';
    env.ELASTICIO_SAILOR_PROXY_JWT_SECRET = 'testSailorProxyJwtSecret';
    env.ELASTICIO_FLOW_WEBHOOK_URI = 'https://in.elastic.io/hooks/' + env.ELASTICIO_FLOW_ID;

    env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD = 'testCryptoPassword';
    env.ELASTICIO_MESSAGE_CRYPTO_IV = 'iv=any16_symbols';

    env.DEBUG = 'sailor:debug';
    return env;
}

/**
 * Create a FakeSailorProxy for integration tests.
 * Call `await proxyHelper.start()` in beforeEach and `await proxyHelper.stop()` in afterEach.
 */
function proxy(env) {
    const encryptor = new Encryptor(
        env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD,
        env.ELASTICIO_MESSAGE_CRYPTO_IV
    );
    return new FakeSailorProxy(encryptor, FAKE_PROXY_PORT);
}

function mockApiTaskStepResponse(env, response) {
    const defaultResponse = {
        config: {
            apiKey: 'secret'
        },
        snapshot: {
            lastModifiedDate: 123456789
        }
    };

    nock(env.ELASTICIO_API_URI)
        .matchHeader('Connection', 'Keep-Alive')
        .get(`/v1/tasks/${env.ELASTICIO_FLOW_ID}/steps/${env.ELASTICIO_STEP_ID}`)
        .reply(200, Object.assign(defaultResponse, response));
}

let fakeApiServer;

async function fakeApiServerStart(env, response, { responseCode = 200, logger = console } = {}) {
    const app = express();
    const requests = [];

    const defaultResponse = {
        config: {
            apiKey: 'secret'
        },
        snapshot: {
            lastModifiedDate: 123456789
        }
    };

    app.get(`/v1/tasks/${env.ELASTICIO_FLOW_ID}/steps/${env.ELASTICIO_STEP_ID}`, (req, res) => {
        requests.push({
            url: req.url // @todo pick certain properties, not the entire res
        });

        res.status(responseCode).json(Object.assign(defaultResponse, response));
    });
    let server;
    await new Promise(resolve => {
        server = app.listen(FAKE_API_PORT, 'localhost', () => {
            logger.info(`FakeApiServer listening on localhost:${FAKE_API_PORT}`);
            resolve();
        });
    });
    fakeApiServer = { app, server, requests };
    return fakeApiServer;
}

async function fakeApiServerStop() {
    if (!fakeApiServer || !fakeApiServer.server) {
        return;
    }
    await new Promise(resolve => fakeApiServer.server.close(resolve));
}

exports.PREFIX = PREFIX;

exports.prepareEnv = prepareEnv;
exports.proxy = proxy;
exports.FAKE_PROXY_PORT = FAKE_PROXY_PORT;
exports.mockApiTaskStepResponse = mockApiTaskStepResponse;
exports.fakeApiServerStart = fakeApiServerStart;
exports.fakeApiServerStop = fakeApiServerStop;
exports.ShellTester = ShellTester;
