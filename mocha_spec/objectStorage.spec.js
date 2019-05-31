const nock = require('nock');
const expect = require('chai').expect;
const getStream = require('get-stream');

describe('ObjectStorage', () => {

    process.env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD = 'testCryptoPassword';
    process.env.ELASTICIO_MESSAGE_CRYPTO_IV = 'iv=any16_symbols';

    const envVars = {};
    envVars.ELASTICIO_AMQP_URI = 'amqp://test2/test2';
    envVars.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
    envVars.ELASTICIO_STEP_ID = 'step_1';
    envVars.ELASTICIO_EXEC_ID = 'some-exec-id';

    envVars.ELASTICIO_USER_ID = '5559edd38968ec0736000002';
    envVars.ELASTICIO_COMP_ID = '5559edd38968ec0736000456';
    envVars.ELASTICIO_FUNCTION = 'list';

    envVars.ELASTICIO_HOOK_SHUTDOWN = true;

    envVars.ELASTICIO_API_URI = 'http://apihost.com';
    envVars.ELASTICIO_API_USERNAME = 'test@test.com';
    envVars.ELASTICIO_API_KEY = '5559edd';

    envVars.ELASTICIO_OBJECT_STORAGE_URI = 'http://ma.es.ter';
    envVars.ELASTICIO_OBJECT_STORAGE_TOKEN = 'jwt';
    envVars.ELASTICIO_OBJECT_FLOW_ID = 1;

    const ObjectStorage = require('../lib/objectStorage.js');
    const encryptor = require('../lib/encryptor.js');
    const settings = require('../lib/settings.js').readFrom(envVars);

    it('should fail after 3 retries', async () => {
        const objectStorage = new ObjectStorage(settings);

        const objectStorageCalls = nock(settings.OBJECT_STORAGE_URI)
            .matchHeader('authorization', 'Bearer jwt')
            .get('/objects/1')
            .replyWithError({ code: 'ETIMEDOUT' })
            .get('/objects/1')
            .reply(404)
            .get('/objects/1')
            .replyWithError({ code: 'ENOTFOUND' });

        let err;
        try {
            await objectStorage.getObject(1);
        } catch (e) {
            err = e;
        }

        expect(objectStorageCalls.isDone()).to.be.true;
        expect(err.code).to.be.equal('ENOTFOUND');
    });

    it('should retry get request 3 times on errors', async () => {
        const objectStorage = new ObjectStorage(settings);
        const data = { test: 'test' };

        const objectStorageCalls = nock(settings.OBJECT_STORAGE_URI)
            .matchHeader('authorization', 'Bearer jwt')
            .get('/objects/1')
            .reply(500)
            .get('/objects/1')
            .replyWithError({ code: 'ECONNRESET' })
            .get('/objects/1')
            .reply(200, await getStream.buffer(encryptor.encryptMessageContentStream(data)));

        const out = await objectStorage.getObject(1);

        expect(objectStorageCalls.isDone()).to.be.true;
        expect(out).to.be.deep.equal(data);
    });

    it('should retry put request 3 times on errors', async () => {
        const objectStorage = new ObjectStorage(settings);
        const data = { test: 'test' };
        const put = await getStream.buffer(encryptor.encryptMessageContentStream(data));

        const objectStorageCalls = nock(settings.OBJECT_STORAGE_URI)
            .matchHeader('authorization', 'Bearer jwt')
            .put(/^\/objects\/[0-9a-z-]+$/, put)
            .replyWithError({ code: 'ECONNREFUSED' })
            .put(/^\/objects\/[0-9a-z-]+$/, put)
            .reply(400)
            .put(/^\/objects\/[0-9a-z-]+$/, put)
            .reply(200);

        await objectStorage.addObject(data);

        expect(objectStorageCalls.isDone()).to.be.true;
    });

    it('should retry put request on 409 error with different objectId', async () => {
        const objectStorage = new ObjectStorage(settings);
        const data = { test: 'test' };
        const put = await getStream.buffer(encryptor.encryptMessageContentStream(data));

        const objectStorageCalls = nock(settings.OBJECT_STORAGE_URI)
            .matchHeader('authorization', 'Bearer jwt')
            .matchHeader('content-type', 'application/octet-stream')
            .put(/^\/objects\/[0-9a-z-]+$/, put)
            .reply(503)
            .put(/^\/objects\/[0-9a-z-]+$/, put)
            .reply(409)
            .put(/^\/objects\/[0-9a-z-]+$/, put)
            .reply(200);
        const urls = [];
        objectStorageCalls.on('request', req => {
            urls.push(req.path);
        });

        await objectStorage.addObject(data);

        expect(objectStorageCalls.isDone()).to.be.true;
        expect(urls[0]).to.be.equal(urls[1]);
        expect(urls[1]).to.not.equal(urls[2]);
    });
});
