import { expect } from 'chai';
import sinon from 'sinon';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { HooksData, HooksDataError, type RetryRequest } from '../../../src/hooks/hooks-data.ts';

const SETTINGS = {
    FLOW_ID: 'flow',
    API_URI: 'http://api',
    API_USERNAME: 'user',
    API_KEY: 'key',
    API_REQUEST_RETRY_ATTEMPTS: 3,
    API_REQUEST_RETRY_DELAY: 1
};
const URL = 'http://api/sailor-support/hooks/task/flow/startup/data';

describe('HooksData', () => {
    function stubRequest(statusCode: number, body: unknown) {
        return sinon.stub<Parameters<RetryRequest>, ReturnType<RetryRequest>>()
            .resolves({ statusCode, body, headers: {} });
    }

    for (const [method, call] of [
        ['POST', (h: HooksData) => h.create({ a: 1 })],
        ['GET', (h: HooksData) => h.retrieve()],
        ['DELETE', (h: HooksData) => h.delete()]
    ] as const) {
        it(`${method}s startup data with basic auth, keep-alive and retry config`, async () => {
            const request = stubRequest(200, { ok: 1 });
            expect(await call(new HooksData(SETTINGS, request))).to.deep.equal({ ok: 1 });
            const [options, config] = request.firstCall.args;
            expect(options).to.include({ url: URL, method });
            expect(options.auth).to.deep.equal({ username: 'user', password: 'key' });
            expect(options.headers).to.deep.equal({ Connection: 'Keep-Alive' });
            expect(options.data).to.deep.equal(method === 'POST' ? { a: 1 } : undefined);
            expect(config).to.deep.equal({ retriesCount: 3, retryDelay: 1 });
            const validate = options.validateStatus as (s: number) => boolean;
            expect([199, 200, 409, 499, 500].map(validate)).to.deep.equal([false, true, true, true, false]);
        });
    }

    it('throws HooksDataError with body.error and statusCode on status >= 400', async () => {
        const err = await new HooksData(SETTINGS, stubRequest(409, { error: 'exists' })).create({})
            .catch((e: unknown) => e);
        expect(err).to.be.instanceOf(HooksDataError).and.include({ message: 'exists', statusCode: 409 });
    });

    it('uses elasticio-rest-node by default (real HTTP)', async () => {
        const server = http.createServer((req, res) => {
            expect(req.headers.authorization).to.equal(`Basic ${Buffer.from('user:key').toString('base64')}`);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ path: req.url, method: req.method }));
        }).listen(0);
        await once(server, 'listening');
        try {
            const { port } = server.address() as AddressInfo;
            const hooks = new HooksData({ ...SETTINGS, API_URI: `http://127.0.0.1:${port}` });
            expect(await hooks.retrieve()).to.deep.equal({
                path: '/sailor-support/hooks/task/flow/startup/data', method: 'GET'
            });
        } finally {
            server.closeAllConnections();
            server.close();
        }
    });
});
