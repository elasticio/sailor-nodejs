import { expect } from 'chai';
import sinon from 'sinon';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Readable } from 'node:stream';
import { Encryptor } from '../../../src/crypto/index.ts';
import { createComponentLogger } from '../../../src/logging/index.ts';
import { MessageStorage, OBJECT_ID_HEADER, type ObjectStore } from '../../../src/storage/index.ts';
import { makeSettings, CRYPTO_IV, CRYPTO_PASSWORD } from '../proxy/helpers.ts';

const TOKEN = 'maester-token';
const RETRY = { retriesCount: 3, requestTimeout: 1000 };
const OPTIONS = { jwtPayloadOrToken: TOKEN, retryOptions: RETRY };

describe('MessageStorage', () => {
    const logger = createComponentLogger();

    afterEach(() => sinon.restore());

    function fakeStore(): sinon.SinonStubbedInstance<ObjectStore> {
        return { getOne: sinon.stub(), add: sinon.stub() };
    }

    describe('fetchMessageBody', () => {
        it('returns the body when there are no headers', async () => {
            const store = fakeStore();
            const storage = new MessageStorage(store, TOKEN, RETRY);
            expect(await storage.fetchMessageBody({ body: { a: 1 } }, logger)).to.deep.equal({ a: 1 });
            expect(store.getOne).not.to.have.been.called;
        });

        it('returns the body when there is no object id header', async () => {
            const store = fakeStore();
            const storage = new MessageStorage(store, TOKEN, RETRY);
            expect(await storage.fetchMessageBody({ body: 'b', headers: { x: 1 } }, logger)).to.equal('b');
            expect(store.getOne).not.to.have.been.called;
        });

        it('fetches the body from Maester with the token', async () => {
            const store = fakeStore();
            store.getOne.resolves({ data: { fetched: true } });
            const storage = new MessageStorage(store, TOKEN, RETRY);
            const body = await storage.fetchMessageBody({ body: {}, headers: { [OBJECT_ID_HEADER]: 'obj-1' } }, logger);
            expect(body).to.deep.equal({ fetched: true });
            expect(store.getOne).to.have.been.calledOnceWith('obj-1', OPTIONS);
        });

        it('wraps fetch failures', async () => {
            const store = fakeStore();
            store.getOne.rejects(new Error('boom'));
            const storage = new MessageStorage(store, TOKEN, RETRY);
            await expect(storage.fetchMessageBody({ headers: { [OBJECT_ID_HEADER]: 'obj-1' } }, logger))
                .to.be.rejectedWith('Failed to get message body with id=obj-1');
        });
    });

    describe('uploadMessageBody', () => {
        it('uploads a stream of the buffer and returns the id', async () => {
            const store = fakeStore();
            store.add.resolves('new-id');
            const storage = new MessageStorage(store, TOKEN, RETRY);
            expect(await storage.uploadMessageBody(Buffer.from('hello'))).to.equal('new-id');
            const [getStream, options] = store.add.firstCall.args;
            expect(options).to.deep.equal(OPTIONS);
            const chunks: Buffer[] = [];
            for await (const chunk of (await getStream()) as Readable) {
                chunks.push(Buffer.from(chunk));
            }
            expect(Buffer.concat(chunks).toString()).to.equal('hello');
        });
    });

    describe('create (real maester-client)', () => {
        const encryptor = new Encryptor(CRYPTO_PASSWORD, CRYPTO_IV);
        const objects = new Map<string, Buffer>();
        let server: http.Server;
        let uri: string;

        before(async () => {
            server = http.createServer(async (req, res) => {
                const chunks: Buffer[] = [];
                for await (const chunk of req) {
                    chunks.push(chunk as Buffer);
                }
                if (req.method === 'POST' && req.url === '/objects') {
                    objects.set('obj-42', Buffer.concat(chunks));
                    res.writeHead(201, { 'content-type': 'application/json' }).end('{"objectId":"obj-42"}');
                } else if (req.method === 'GET' && req.url === '/objects/obj-42') {
                    res.writeHead(200).end(objects.get('obj-42'));
                } else {
                    res.writeHead(404).end();
                }
            });
            server.listen(0);
            await once(server, 'listening');
            uri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        });

        after(() => server.close());

        it('encrypts uploads and decrypts downloads', async () => {
            const settings = makeSettings('http://proxy', {
                ELASTICIO_OBJECT_STORAGE_URI: uri,
                ELASTICIO_OBJECT_STORAGE_TOKEN: TOKEN
            });
            const storage = MessageStorage.create(settings, encryptor);
            const payload = JSON.stringify({ hello: 'wörld' });

            expect(await storage.uploadMessageBody(Buffer.from(payload))).to.equal('obj-42');

            const decipher = encryptor.createDecipher();
            const stored = objects.get('obj-42')!;
            expect(Buffer.concat([decipher.update(stored), decipher.final()]).toString()).to.equal(payload);

            const body = await storage.fetchMessageBody({ headers: { [OBJECT_ID_HEADER]: 'obj-42' } }, logger);
            expect(body).to.deep.equal({ hello: 'wörld' });
        });
    });
});
