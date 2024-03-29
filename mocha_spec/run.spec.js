'use strict';

const nock = require('nock');
const chai = require('chai');
const { expect } = chai;
const uuid = require('uuid');
const sinonjs = require('sinon');
const logging = require('../lib/logging.js');
const helpers = require('./integration_helpers');
const Encryptor = require('../lib/encryptor');
const settings = require('../lib/settings');
const { Sailor } = require('../lib/sailor');
const { IPC } = require('../lib/ipc.js');

chai.use(require('sinon-chai'));

function requireRun() {
    //@todo it would be great to use something like this https://github.com/jveski/shelltest
    const path = '../run.js';
    const resolved = require.resolve(path);
    delete require.cache[resolved];
    return require(path);
}

describe('Integration Test', () => {
    let encryptor;
    let env;
    let amqpHelper;
    let ipc;
    const originalEnvironment = { ...process.env };
    const customers = [
        {
            name: 'Homer Simpson'
        },
        {
            name: 'Marge Simpson'
        }
    ];
    let inputMessage;
    let runner;
    let sinon;

    beforeEach(async () => {
        sinon = sinonjs.createSandbox();
        inputMessage = {
            headers: {
                stepId: 'step_1'
            },
            body: {
                message: 'Just do it!'
            }
        };
        process.env = { ...originalEnvironment };
        env = helpers.prepareEnv();
        Object.assign(process.env, env);

        encryptor = new Encryptor(env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD, env.ELASTICIO_MESSAGE_CRYPTO_IV);
        env.ELASTICIO_FUNCTION = 'init_trigger';
        amqpHelper = helpers.amqp(env);
        await amqpHelper.prepare();
        runner = requireRun();
        ipc = new IPC();
    });

    afterEach(async () => {
        await runner.__test__.disconnectOnly();
        nock.cleanAll();
        await amqpHelper.cleanUp();
        sinon.restore();
    });

    describe('when sailor is being invoked for message processing', () => {
        let parentMessageId;
        let threadId;
        let messageId;

        beforeEach(async () => {
            threadId = uuid.v4();
            parentMessageId = uuid.v4();
            messageId = uuid.v4();
        });

        for (let protocolVersion of [1, 2]) {
            describe(`for output protocolVersion ${protocolVersion}`, () => {

                let encoding;
                beforeEach(() => {
                    env.ELASTICIO_PROTOCOL_VERSION = protocolVersion;
                    encoding = protocolVersion < 2 ? 'base64' : undefined;
                });

                it('should run trigger successfully', async () => {
                    helpers.mockApiTaskStepResponse(env);

                    nock('https://api.acme.com')
                        .post('/subscribe')
                        .reply(200, {
                            id: 'subscription_12345'
                        })
                        .get('/customers')
                        .reply(200, customers);

                    await amqpHelper.publishMessage(inputMessage, {
                        parentMessageId,
                        threadId
                    });
                    runner.run(settings.readFrom(env), ipc);
                    const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                        'data',
                        (message, queueName) => resolve({ message, queueName })
                    ));

                    const { properties, content } = message;
                    const { body } = encryptor.decryptMessageContent(content, encoding);
                    expect(queueName).to.eql(amqpHelper.nextStepQueue);

                    expect(properties.headers.messageId).to.be.a('string');
                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;
                    delete properties.headers.messageId;

                    expect(properties.headers).to.deep.equal({
                        execId: env.ELASTICIO_EXEC_ID,
                        taskId: env.ELASTICIO_FLOW_ID,
                        workspaceId: env.ELASTICIO_WORKSPACE_ID,
                        containerId: env.ELASTICIO_CONTAINER_ID,
                        userId: env.ELASTICIO_USER_ID,
                        stepId: env.ELASTICIO_STEP_ID,
                        compId: env.ELASTICIO_COMP_ID,
                        function: env.ELASTICIO_FUNCTION,
                        threadId,
                        parentMessageId,
                        protocolVersion: protocolVersion
                    });

                    delete properties.headers;

                    expect(properties).to.deep.equal({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        deliveryMode: 1,
                        priority: undefined,
                        correlationId: undefined,
                        replyTo: undefined,
                        expiration: undefined,
                        messageId: undefined,
                        timestamp: undefined,
                        type: undefined,
                        userId: undefined,
                        appId: undefined,
                        clusterId: undefined
                    });

                    expect(body).to.deep.equal({
                        originalMsg: inputMessage,
                        customers: customers,
                        subscription: {
                            id: 'subscription_12345',
                            cfg: {
                                apiKey: 'secret'
                            }
                        }
                    });
                });

                it('should run trigger successfully for input protocolVersion 2', async () => {
                    helpers.mockApiTaskStepResponse(env);

                    nock('https://api.acme.com')
                        .post('/subscribe')
                        .reply(200, {
                            id: 'subscription_12345'
                        })
                        .get('/customers')
                        .reply(200, customers);

                    await amqpHelper.publishMessage(
                        inputMessage,
                        {
                            parentMessageId,
                            threadId
                        },
                        {
                            protocolVersion: 2
                        }
                    );

                    runner.run(settings.readFrom(env), ipc);
                    const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                        'data',
                        (message, queueName) => resolve({ message, queueName })
                    ));

                    const { properties, content } = message;
                    const { body } = encryptor.decryptMessageContent(content, encoding);
                    expect(queueName).to.eql(amqpHelper.nextStepQueue);

                    expect(properties.headers.messageId).to.be.a('string');
                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;
                    delete properties.headers.messageId;

                    expect(properties.headers).to.deep.equal({
                        execId: env.ELASTICIO_EXEC_ID,
                        taskId: env.ELASTICIO_FLOW_ID,
                        workspaceId: env.ELASTICIO_WORKSPACE_ID,
                        containerId: env.ELASTICIO_CONTAINER_ID,
                        userId: env.ELASTICIO_USER_ID,
                        stepId: env.ELASTICIO_STEP_ID,
                        compId: env.ELASTICIO_COMP_ID,
                        function: env.ELASTICIO_FUNCTION,
                        threadId,
                        parentMessageId,
                        protocolVersion: protocolVersion
                    });

                    delete properties.headers;

                    expect(properties).to.deep.equal({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        deliveryMode: 1,
                        priority: undefined,
                        correlationId: undefined,
                        replyTo: undefined,
                        expiration: undefined,
                        messageId: undefined,
                        timestamp: undefined,
                        type: undefined,
                        userId: undefined,
                        appId: undefined,
                        clusterId: undefined
                    });

                    expect(body).to.deep.equal({
                        originalMsg: inputMessage,
                        customers: customers,
                        subscription: {
                            id: 'subscription_12345',
                            cfg: {
                                apiKey: 'secret'
                            }
                        }
                    });
                });

                it('should augment passthrough property with data', async () => {
                    env.ELASTICIO_STEP_ID = 'step_2';
                    env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
                    env.ELASTICIO_FUNCTION = 'emit_data';

                    helpers.mockApiTaskStepResponse(env, {
                        is_passthrough: true
                    });

                    const psMsg = {
                        id: messageId,
                        headers: {
                            'x-custom-component-header': '123_abc'
                        },
                        body: {
                            message: 'Just do it'
                        },
                        passthrough: {
                            step_1: { // emulating an another step – just to be sure that it's not lost
                                id: '34',
                                body: {},
                                attachments: {}
                            }
                        }
                    };

                    await amqpHelper.publishMessage(psMsg, {
                        parentMessageId,
                        threadId
                    });

                    runner.run(settings.readFrom(env), ipc);
                    const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                        'data',
                        (message, queueName) => resolve({ message, queueName })
                    ));

                    const { properties, content } = message;
                    const { passthrough } = encryptor.decryptMessageContent(content, encoding);
                    expect(queueName).to.eql(amqpHelper.nextStepQueue);

                    expect(properties.headers.messageId).to.be.a('string');
                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;
                    delete properties.headers.messageId;

                    expect(properties.headers).to.deep.equal({
                        taskId: env.ELASTICIO_FLOW_ID,
                        execId: env.ELASTICIO_EXEC_ID,
                        workspaceId: env.ELASTICIO_WORKSPACE_ID,
                        containerId: env.ELASTICIO_CONTAINER_ID,
                        userId: env.ELASTICIO_USER_ID,
                        threadId,
                        stepId: env.ELASTICIO_STEP_ID,
                        compId: env.ELASTICIO_COMP_ID,
                        function: env.ELASTICIO_FUNCTION,
                        parentMessageId,
                        protocolVersion: protocolVersion
                    });

                    expect(passthrough.step_1).to.deep.eql(psMsg.passthrough.step_1);

                    expect(passthrough.step_2.headers).to.deep.eql(psMsg.headers);
                    expect(passthrough.step_2.body).to.deep.eql({
                        hai: 'there',
                        id: 'someId'
                    });

                    delete properties.headers;

                    expect(properties).to.deep.eql({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        deliveryMode: 1,
                        priority: undefined,
                        correlationId: undefined,
                        replyTo: undefined,
                        expiration: undefined,
                        messageId: undefined,
                        timestamp: undefined,
                        type: undefined,
                        userId: undefined,
                        appId: undefined,
                        clusterId: undefined
                    });
                });

                it(
                    'should paste data from incoming message into passthrough '
                    + 'and not copy own data if NO_SELF_PASSTRHOUGH',
                    async () => {
                        env.ELASTICIO_STEP_ID = 'step_2';
                        env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
                        env.ELASTICIO_FUNCTION = 'emit_data';
                        const sailorSettings = settings.readFrom(env);
                        sailorSettings.NO_SELF_PASSTRHOUGH = true;

                        helpers.mockApiTaskStepResponse(env, {
                            is_passthrough: true
                        });

                        const psMsg = {
                            headers: {
                                stepId: 'step_1'
                            },
                            body: {
                                message: 'Just do it!'
                            },
                            passthrough: {
                                step_oth: { // emulating an another step – just to be sure that it's not lost
                                    id: 'id-56',
                                    body: { a: 1 },
                                    attachments: {}
                                }
                            }
                        };

                        await amqpHelper.publishMessage(psMsg, {
                            parentMessageId,
                            threadId
                        });

                        runner.run(sailorSettings, ipc);
                        const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                            'data',
                            (message, queueName) => resolve({ message, queueName })
                        ));

                        const { properties, content } = message;
                        const { passthrough } = encryptor.decryptMessageContent(content, encoding);
                        expect(queueName).to.eql(amqpHelper.nextStepQueue);

                        expect(passthrough).to.deep.eql({
                            step_oth: {
                                id: 'id-56',
                                body: { a: 1 },
                                attachments: {}
                            },
                            step_1: {
                                headers: inputMessage.headers,
                                body: inputMessage.body
                            }
                        });

                        expect(properties.headers.messageId).to.be.a('string');
                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;
                        delete properties.headers.messageId;

                        expect(properties.headers).to.deep.equal({
                            taskId: env.ELASTICIO_FLOW_ID,
                            execId: env.ELASTICIO_EXEC_ID,
                            workspaceId: env.ELASTICIO_WORKSPACE_ID,
                            containerId: env.ELASTICIO_CONTAINER_ID,
                            userId: env.ELASTICIO_USER_ID,
                            threadId,
                            stepId: env.ELASTICIO_STEP_ID,
                            compId: env.ELASTICIO_COMP_ID,
                            function: env.ELASTICIO_FUNCTION,
                            parentMessageId,
                            protocolVersion: protocolVersion
                        });

                        delete properties.headers;

                        expect(properties).to.deep.eql({
                            contentType: 'application/json',
                            contentEncoding: 'utf8',
                            deliveryMode: 1,
                            priority: undefined,
                            correlationId: undefined,
                            replyTo: undefined,
                            expiration: undefined,
                            messageId: undefined,
                            timestamp: undefined,
                            type: undefined,
                            userId: undefined,
                            appId: undefined,
                            clusterId: undefined
                        });
                    }
                );

                it('should work well with async process function emitting data', async () => {
                    env.ELASTICIO_STEP_ID = 'step_2';
                    env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
                    env.ELASTICIO_FUNCTION = 'async_trigger';
                    env.ELASTICIO_DATA_RATE_LIMIT = '1';
                    env.ELASTICIO_RATE_INTERVAL = '110';

                    helpers.mockApiTaskStepResponse(env, {
                        is_passthrough: true
                    });

                    const psMsg = Object.assign(inputMessage, {
                        passthrough: {
                            step_oth: { // emulating an another step – just to be sure that it's not lost
                                id: 'm-34',
                                body: {},
                                attachments: {}
                            }
                        },
                        headers: {
                            'x-custom-component-header': '123_abc',
                            'stepId': 'step_1'
                        }
                    });

                    await amqpHelper.publishMessage(psMsg, {
                        parentMessageId,
                        threadId
                    });

                    runner.run(settings.readFrom(env), ipc);
                    const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                        'data',
                        (message, queueName) => resolve({ message, queueName })
                    ));

                    const { properties, content } = message;
                    const { passthrough } = encryptor.decryptMessageContent(content, encoding);

                    expect(queueName).to.eql(amqpHelper.nextStepQueue);

                    expect(passthrough.step_oth).to.deep.eql({
                        id: 'm-34',
                        body: {},
                        attachments: {}
                    });

                    expect(passthrough.step_2.headers).to.deep.eql({
                        'x-custom-component-header': '123_abc'
                    });
                    expect(passthrough.step_2.body).to.deep.eql({
                        hai: 'there',
                        id: 'someId'
                    });

                    expect(properties.headers.messageId).to.be.a('string');

                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;
                    delete properties.headers.messageId;

                    expect(properties.headers).to.deep.equal({
                        taskId: env.ELASTICIO_FLOW_ID,
                        execId: env.ELASTICIO_EXEC_ID,
                        workspaceId: env.ELASTICIO_WORKSPACE_ID,
                        containerId: env.ELASTICIO_CONTAINER_ID,
                        userId: env.ELASTICIO_USER_ID,
                        threadId,
                        stepId: env.ELASTICIO_STEP_ID,
                        compId: env.ELASTICIO_COMP_ID,
                        function: env.ELASTICIO_FUNCTION,
                        parentMessageId,
                        protocolVersion
                    });

                    delete properties.headers;

                    expect(properties).to.deep.eql({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        deliveryMode: 1,
                        priority: undefined,
                        correlationId: undefined,
                        replyTo: undefined,
                        expiration: undefined,
                        messageId: undefined,
                        timestamp: undefined,
                        type: undefined,
                        userId: undefined,
                        appId: undefined,
                        clusterId: undefined
                    });
                });


                it('should reopen if consumer channel closed', async () => {
                    helpers.mockApiTaskStepResponse(env);

                    nock('https://api.acme.com')
                        .post('/subscribe')
                        .reply(200, {
                            id: 'subscription_12345'
                        })
                        .get('/customers')
                        .reply(200, customers);


                    runner.run(settings.readFrom(env), ipc);

                    await new Promise(resolve => setTimeout(resolve, 100));

                    await runner.__test__.closeConsumerChannel();

                    await amqpHelper.publishMessage(inputMessage, {
                        parentMessageId,
                        threadId
                    });

                    const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                        'data',
                        (message, queueName) => resolve({ message, queueName })
                    ));

                    const { properties, content } = message;
                    const { body } = encryptor.decryptMessageContent(content, encoding);
                    expect(queueName).to.eql(amqpHelper.nextStepQueue);

                    expect(properties.headers.messageId).to.be.a('string');
                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;
                    delete properties.headers.messageId;

                    expect(properties.headers).to.deep.equal({
                        execId: env.ELASTICIO_EXEC_ID,
                        taskId: env.ELASTICIO_FLOW_ID,
                        workspaceId: env.ELASTICIO_WORKSPACE_ID,
                        containerId: env.ELASTICIO_CONTAINER_ID,
                        userId: env.ELASTICIO_USER_ID,
                        stepId: env.ELASTICIO_STEP_ID,
                        compId: env.ELASTICIO_COMP_ID,
                        function: env.ELASTICIO_FUNCTION,
                        threadId,
                        parentMessageId,
                        protocolVersion: protocolVersion
                    });

                    delete properties.headers;

                    expect(properties).to.deep.equal({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        deliveryMode: 1,
                        priority: undefined,
                        correlationId: undefined,
                        replyTo: undefined,
                        expiration: undefined,
                        messageId: undefined,
                        timestamp: undefined,
                        type: undefined,
                        userId: undefined,
                        appId: undefined,
                        clusterId: undefined
                    });

                    expect(body).to.deep.equal({
                        originalMsg: inputMessage,
                        customers: customers,
                        subscription: {
                            id: 'subscription_12345',
                            cfg: {
                                apiKey: 'secret'
                            }
                        }
                    });

                });

                describe('when env ELASTICIO_STARTUP_REQUIRED is set', () => {
                    let sailorSettings;
                    beforeEach(() => {
                        sailorSettings = settings.readFrom(env);
                        sailorSettings.STARTUP_REQUIRED = '1';
                    });

                    describe('when hooks data for the task is not created yet', () => {
                        it('should execute startup successfully', async () => {
                            let startupRegistrationRequest;
                            const startupRegistrationNock = nock('http://example.com/')
                                .post('/subscriptions/enable')
                                .reply(200, (uri, requestBody) => {
                                    startupRegistrationRequest = requestBody;
                                    return {
                                        status: 'ok'
                                    };
                                });

                            helpers.mockApiTaskStepResponse(env);

                            // sailor persists startup data via sailor-support API
                            let hooksDataRequest;
                            const hooksDataNock = nock(env.ELASTICIO_API_URI)
                                .matchHeader('Connection', 'Keep-Alive')
                                .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {
                                    subscriptionResult: {
                                        status: 'ok'
                                    }
                                })
                                .reply(201, (uri, requestBody) => {
                                    hooksDataRequest = requestBody;
                                    return requestBody;
                                });

                            // response for a subscription request, which performed inside of init method
                            nock('https://api.acme.com')
                                .post('/subscribe')
                                .reply(200, {
                                    id: 'subscription_12345'
                                })
                                .get('/customers')
                                .reply(200, customers);

                            await amqpHelper.publishMessage(inputMessage, { threadId });

                            runner.run(sailorSettings, ipc);
                            const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                                'data',
                                (message, queueName) => resolve({ message, queueName })
                            ));

                            const { properties, content } = message;
                            const { body } = encryptor.decryptMessageContent(content, encoding);
                            expect(queueName).to.eql(amqpHelper.nextStepQueue);

                            expect(startupRegistrationRequest).to.deep.equal({
                                data: 'startup'
                            });

                            expect(hooksDataRequest).to.deep.equal({
                                subscriptionResult: {
                                    status: 'ok'
                                }
                            });

                            expect(startupRegistrationNock.isDone()).to.be.ok;
                            expect(hooksDataNock.isDone()).to.be.ok;

                            expect(properties.headers.messageId).to.be.a('string');

                            delete properties.headers.start;
                            delete properties.headers.end;
                            delete properties.headers.cid;
                            delete properties.headers.messageId;

                            expect(properties.headers).to.eql({
                                execId: env.ELASTICIO_EXEC_ID,
                                taskId: env.ELASTICIO_FLOW_ID,
                                workspaceId: env.ELASTICIO_WORKSPACE_ID,
                                containerId: env.ELASTICIO_CONTAINER_ID,
                                userId: env.ELASTICIO_USER_ID,
                                stepId: env.ELASTICIO_STEP_ID,
                                compId: env.ELASTICIO_COMP_ID,
                                function: env.ELASTICIO_FUNCTION,
                                protocolVersion,
                                threadId
                            });

                            expect(body).to.deep.equal({
                                originalMsg: inputMessage,
                                customers: customers,
                                subscription: {
                                    id: 'subscription_12345',
                                    cfg: {
                                        apiKey: 'secret'
                                    }
                                }
                            });
                        });
                    });

                    describe('when hooks data already exists', () => {
                        it('should delete previous data and execute startup successfully', async () => {
                            let startupRegistrationRequest;
                            const startupRegistrationNock = nock('http://example.com/')
                                .post('/subscriptions/enable')
                                .reply(200, (uri, requestBody) => {
                                    startupRegistrationRequest = requestBody;
                                    return {
                                        status: 'ok'
                                    };
                                });

                            helpers.mockApiTaskStepResponse(env);

                            let hooksDataRequest1;
                            let hooksDataRequest2;

                            // sailor persists startup data via sailor-support API
                            const hooksDataNock1 = nock(env.ELASTICIO_API_URI)
                                .matchHeader('Connection', 'Keep-Alive')
                                .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {
                                    subscriptionResult: {
                                        status: 'ok'
                                    }
                                })
                                .reply(409, (uri, requestBody) => {
                                    hooksDataRequest1 = requestBody;
                                    return {
                                        error: 'Hooks data for the task already exist. Delete previous data first.',
                                        status: 409,
                                        title: 'ConflictError'
                                    };
                                });

                            // sailor removes data in order to resolve conflict
                            const hooksDataDeleteNock = nock(env.ELASTICIO_API_URI)
                                .matchHeader('Connection', 'Keep-Alive')
                                .delete('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                                .reply(204);

                            // sailor persists startup data via sailor-support API
                            const hooksDataNock2 = nock(env.ELASTICIO_API_URI)
                                .matchHeader('Connection', 'Keep-Alive')
                                .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {
                                    subscriptionResult: {
                                        status: 'ok'
                                    }
                                })
                                .reply(201, (uri, requestBody) => {
                                    hooksDataRequest2 = requestBody;
                                    return requestBody;
                                });

                            // response for a subscription request, which performed inside of init method
                            nock('https://api.acme.com')
                                .post('/subscribe')
                                .reply(200, {
                                    id: 'subscription_12345'
                                })
                                .get('/customers')
                                .reply(200, customers);

                            await amqpHelper.publishMessage(inputMessage, { threadId });

                            runner.run(sailorSettings, ipc);
                            const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                                'data',
                                (message, queueName) => resolve({ message, queueName })
                            ));

                            const { properties, content } = message;
                            const { body } = encryptor.decryptMessageContent(content, encoding);
                            expect(queueName).to.eql(amqpHelper.nextStepQueue);

                            expect(startupRegistrationRequest).to.deep.equal({
                                data: 'startup'
                            });

                            expect(startupRegistrationNock.isDone()).to.be.ok;
                            expect(hooksDataNock1.isDone()).to.be.ok;
                            expect(hooksDataNock2.isDone()).to.be.ok;
                            expect(hooksDataDeleteNock.isDone()).to.be.ok;

                            expect(hooksDataRequest1).to.deep.equal({
                                subscriptionResult: {
                                    status: 'ok'
                                }
                            });

                            expect(hooksDataRequest2).to.deep.equal({
                                subscriptionResult: {
                                    status: 'ok'
                                }
                            });

                            expect(properties.headers.messageId).to.be.a('string');

                            delete properties.headers.start;
                            delete properties.headers.end;
                            delete properties.headers.cid;
                            delete properties.headers.messageId;

                            expect(properties.headers).to.eql({
                                execId: env.ELASTICIO_EXEC_ID,
                                taskId: env.ELASTICIO_FLOW_ID,
                                workspaceId: env.ELASTICIO_WORKSPACE_ID,
                                containerId: env.ELASTICIO_CONTAINER_ID,
                                userId: env.ELASTICIO_USER_ID,
                                stepId: env.ELASTICIO_STEP_ID,
                                compId: env.ELASTICIO_COMP_ID,
                                function: env.ELASTICIO_FUNCTION,
                                protocolVersion: protocolVersion,
                                threadId
                            });

                            expect(body).to.deep.equal({
                                originalMsg: inputMessage,
                                customers: customers,
                                subscription: {
                                    id: 'subscription_12345',
                                    cfg: {
                                        apiKey: 'secret'
                                    }
                                }
                            });
                        });
                    });

                    describe('when startup method returns empty data', () => {
                        it('should store an empty object as data and execute trigger successfully', async () => {
                            let startupRegistrationRequest;

                            sailorSettings.FUNCTION = 'startup_with_empty_data';

                            const startupRegistrationNock = nock('http://example.com/')
                                .post('/subscriptions/enable')
                                .reply(200, (uri, requestBody) => {
                                    startupRegistrationRequest = requestBody;
                                    return {
                                        status: 'ok'
                                    };
                                });

                            helpers.mockApiTaskStepResponse(env);

                            // sailor persists startup data via sailor-support API
                            const hooksDataNock = nock(env.ELASTICIO_API_URI)
                                .matchHeader('Connection', 'Keep-Alive')
                                .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {})
                                .reply(201);

                            // sailor removes data in order to resolve conflict
                            const hooksDataDeleteNock = nock(env.ELASTICIO_API_URI)
                                .matchHeader('Connection', 'Keep-Alive')
                                .delete('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                                .reply(400);

                            // response for a subscription request, which performed inside of init method
                            nock('https://api.acme.com')
                                .post('/subscribe')
                                .reply(200, {
                                    id: 'subscription_12345'
                                })
                                .get('/customers')
                                .reply(200, customers);

                            await amqpHelper.publishMessage(inputMessage, { threadId });

                            runner.run(sailorSettings, ipc);
                            const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                                'data',
                                (message, queueName) => resolve({ message, queueName })
                            ));

                            const { properties, content } = message;
                            const { body } = encryptor.decryptMessageContent(content, encoding);
                            expect(queueName).to.eql(amqpHelper.nextStepQueue);

                            expect(startupRegistrationRequest).to.deep.equal({
                                data: 'startup'
                            });

                            expect(startupRegistrationNock.isDone()).to.be.ok;
                            expect(hooksDataNock.isDone()).to.be.ok;
                            expect(hooksDataDeleteNock.isDone()).to.not.be.ok;

                            expect(properties.headers.messageId).to.be.a('string');

                            delete properties.headers.start;
                            delete properties.headers.end;
                            delete properties.headers.cid;
                            delete properties.headers.messageId;

                            expect(properties.headers).to.eql({
                                execId: env.ELASTICIO_EXEC_ID,
                                taskId: env.ELASTICIO_FLOW_ID,
                                workspaceId: env.ELASTICIO_WORKSPACE_ID,
                                containerId: env.ELASTICIO_CONTAINER_ID,
                                userId: env.ELASTICIO_USER_ID,
                                stepId: env.ELASTICIO_STEP_ID,
                                compId: env.ELASTICIO_COMP_ID,
                                function: sailorSettings.FUNCTION,
                                protocolVersion: protocolVersion,
                                threadId
                            });

                            expect(body).to.deep.equal({
                                originalMsg: inputMessage,
                                customers: customers,
                                subscription: {
                                    id: 'subscription_12345',
                                    cfg: {
                                        apiKey: 'secret'
                                    }
                                }
                            });
                        });
                    });

                    describe('when startup method does not exist', () => {
                        it('should store an empty hooks data and run trigger successfully', async () => {
                            sailorSettings.FUNCTION = 'trigger_with_no_hooks';

                            helpers.mockApiTaskStepResponse(env);

                            // sailor persists startup data via sailor-support API
                            const hooksDataNock = nock(env.ELASTICIO_API_URI)
                                .matchHeader('Connection', 'Keep-Alive')
                                .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {})
                                .reply(201);

                            // response for a subscription request, which performed inside of init method
                            nock('https://api.acme.com')
                                .get('/customers')
                                .reply(200, customers);

                            await amqpHelper.publishMessage(inputMessage, { threadId });

                            runner.run(sailorSettings, ipc);
                            const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                                'data',
                                (message, queueName) => resolve({ message, queueName })
                            ));

                            const { properties, content } = message;
                            const { body } = encryptor.decryptMessageContent(content, encoding);
                            expect(queueName).to.eql(amqpHelper.nextStepQueue);

                            expect(properties.headers.messageId).to.be.a('string');

                            delete properties.headers.start;
                            delete properties.headers.end;
                            delete properties.headers.cid;
                            delete properties.headers.messageId;

                            expect(properties.headers).to.eql({
                                execId: env.ELASTICIO_EXEC_ID,
                                taskId: env.ELASTICIO_FLOW_ID,
                                workspaceId: env.ELASTICIO_WORKSPACE_ID,
                                containerId: env.ELASTICIO_CONTAINER_ID,
                                userId: env.ELASTICIO_USER_ID,
                                stepId: env.ELASTICIO_STEP_ID,
                                compId: env.ELASTICIO_COMP_ID,
                                function: sailorSettings.FUNCTION,
                                protocolVersion: protocolVersion,
                                threadId
                            });

                            expect(body).to.deep.equal({
                                originalMsg: inputMessage,
                                customers: customers
                            });

                            expect(hooksDataNock.isDone()).to.be.ok;
                        });
                    });
                });

                describe('when env ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS is set', () => {

                    beforeEach(() => {
                        env.ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS = 'ELASTICIO_FIRST, ELASTICIO_SECOND_ELASTICIO_ENV ,'
                            + 'ELASTICIO_NOT_PRESENT';

                        env.ELASTICIO_RANDOM = 'random';
                        env.ELASTICIO_FIRST = 'first';
                        env.ELASTICIO_SECOND_ELASTICIO_ENV = 'second';
                    });

                    afterEach(() => {
                        delete env.ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS;
                        delete env.ELASTICIO_RANDOM;
                        delete env.FIRST;
                        delete env.ELASTICIO_SECOND_ELASTICIO_ENV;
                    });

                    it('should run trigger successfully and pass additional vars to headers', async () => {


                        helpers.mockApiTaskStepResponse(env);

                        nock('https://api.acme.com')
                            .post('/subscribe')
                            .reply(200, {
                                id: 'subscription_12345'
                            })
                            .get('/customers')
                            .reply(200, customers);

                        await amqpHelper.publishMessage(inputMessage, {
                            parentMessageId,
                            threadId
                        });

                        runner.run(settings.readFrom(env), ipc);
                        const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                            'data',
                            (message, queueName) => resolve({ message, queueName })
                        ));


                        const { properties, content } = message;
                        const { body } = encryptor.decryptMessageContent(content, encoding);
                        expect(queueName).to.eql(amqpHelper.nextStepQueue);

                        expect(properties.headers.messageId).to.be.a('string');

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;
                        delete properties.headers.messageId;

                        expect(properties.headers).to.deep.equal({
                            first: 'first',
                            secondElasticioEnv: 'second',
                            execId: env.ELASTICIO_EXEC_ID,
                            taskId: env.ELASTICIO_FLOW_ID,
                            workspaceId: env.ELASTICIO_WORKSPACE_ID,
                            containerId: env.ELASTICIO_CONTAINER_ID,
                            userId: env.ELASTICIO_USER_ID,
                            stepId: env.ELASTICIO_STEP_ID,
                            compId: env.ELASTICIO_COMP_ID,
                            function: env.ELASTICIO_FUNCTION,
                            threadId,
                            parentMessageId,
                            protocolVersion
                        });

                        expect(body).to.deep.equal({
                            originalMsg: inputMessage,
                            customers: customers,
                            subscription: {
                                id: 'subscription_12345',
                                cfg: {
                                    apiKey: 'secret'
                                }
                            }
                        });
                    });

                });

                describe('when reply_to header is set', () => {
                    it('should send http reply successfully', async () => {

                        env.ELASTICIO_FUNCTION = 'http_reply_action';

                        helpers.mockApiTaskStepResponse(env);

                        nock('https://api.acme.com')
                            .post('/subscribe')
                            .reply(200, {
                                id: 'subscription_12345'
                            })
                            .get('/customers')
                            .reply(200, customers);

                        await amqpHelper.publishMessage(inputMessage, {}, {
                            reply_to: amqpHelper.httpReplyQueueRoutingKey,
                            threadId
                        });

                        runner.run(settings.readFrom(env), ipc);
                        const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                            'data',
                            (message, queueName) => resolve({ message, queueName })
                        ));

                        const { properties, content } = message;
                        const emittedMessage = encryptor.decryptMessageContent(content, 'base64');
                        expect(queueName).to.eql(amqpHelper.httpReplyQueueName);

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;

                        expect(properties.headers.messageId).to.be.a('string');
                        delete properties.headers.messageId;

                        expect(properties.headers).to.eql({
                            execId: env.ELASTICIO_EXEC_ID,
                            taskId: env.ELASTICIO_FLOW_ID,
                            workspaceId: env.ELASTICIO_WORKSPACE_ID,
                            containerId: env.ELASTICIO_CONTAINER_ID,
                            userId: env.ELASTICIO_USER_ID,
                            stepId: env.ELASTICIO_STEP_ID,
                            compId: env.ELASTICIO_COMP_ID,
                            function: env.ELASTICIO_FUNCTION,
                            reply_to: amqpHelper.httpReplyQueueRoutingKey,
                            protocolVersion: 1,
                            threadId
                        });

                        expect(emittedMessage).to.eql({
                            headers: {
                                'content-type': 'text/plain'
                            },
                            body: 'Ok',
                            statusCode: 200
                        });
                    });
                });

                describe('when sailor could not init the module', () => {
                    it('should publish init errors to RabbitMQ', async () => {
                        // NOTICE, don't touch this.
                        // it produces side effect, disabling exit at error
                        // see lib/logging.js
                        sinon.stub(logging, 'criticalErrorAndExit');

                        env.ELASTICIO_FUNCTION = 'fails_to_init';

                        helpers.mockApiTaskStepResponse(env);

                        const sailorSettings = settings.readFrom(env);
                        sailorSettings.FUNCTION = 'fails_to_init';

                        runner.run(settings.readFrom(env), ipc);
                        const { message, queueName } = await new Promise(resolve => amqpHelper.on(
                            'data',
                            (message, queueName) => resolve({ message, queueName })
                        ));

                        const { properties, content } = message;
                        const emittedMessage = JSON.parse(content);
                        const error = encryptor.decryptMessageContent(emittedMessage.error, 'base64');
                        expect(queueName).to.eql(amqpHelper.nextStepErrorQueue);
                        expect(error.message).to.equal('OMG. I cannot init');
                        expect(properties.headers).to.deep.include({
                            execId: env.ELASTICIO_EXEC_ID,
                            taskId: env.ELASTICIO_FLOW_ID,
                            workspaceId: env.ELASTICIO_WORKSPACE_ID,
                            containerId: env.ELASTICIO_CONTAINER_ID,
                            userId: env.ELASTICIO_USER_ID,
                            stepId: env.ELASTICIO_STEP_ID,
                            compId: env.ELASTICIO_COMP_ID,
                            function: env.ELASTICIO_FUNCTION
                        });
                    });
                });
            });
        }

        it('should make all HTTP requests with keep alive agent', async () => {
            env.ELASTICIO_STEP_ID = 'step_2';
            env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
            env.ELASTICIO_FUNCTION = 'trigger_with_keep_alive';

            helpers.mockApiTaskStepResponse(env);

            nock('http://api.acme.com')
                .get('/customers')
                .reply(200, customers);

            await amqpHelper.publishMessage(inputMessage, {
                parentMessageId,
                threadId
            });
            runner.run(settings.readFrom(env), ipc);
            const { message } = await new Promise(resolve => amqpHelper.on(
                'data',
                (message, queueName) => resolve({ message, queueName })
            ));

            const { content } = message;
            const { body } = encryptor.decryptMessageContent(content, 'base64');

            expect(body).to.deep.equal({
                originalMsg: inputMessage,
                customers,
                keepAlive: true
            });
        });

        it('should make all HTTPS requests with keep alive agent', async () => {
            env.ELASTICIO_STEP_ID = 'step_2';
            env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
            env.ELASTICIO_FUNCTION = 'trigger_with_keep_alive';

            inputMessage.body.isHttps = true;

            helpers.mockApiTaskStepResponse(env);

            nock('https://api.acme.com')
                .get('/customers')
                .reply(200, customers);

            await amqpHelper.publishMessage(inputMessage, {
                parentMessageId,
                threadId
            });
            runner.run(settings.readFrom(env), ipc);
            const { message } = await new Promise(resolve => amqpHelper.on(
                'data',
                (message, queueName) => resolve({ message, queueName })
            ));

            const { content } = message;
            const { body } = encryptor.decryptMessageContent(content, 'base64');

            expect(body).to.deep.equal({
                originalMsg: inputMessage,
                customers,
                keepAlive: true
            });
        });

        it('should fail if queue deleted', async () => {
            helpers.mockApiTaskStepResponse(env);

            nock('https://api.acme.com')
                .post('/subscribe')
                .reply(200, {
                    id: 'subscription_12345'
                })
                .get('/customers')
                .reply(200, customers);

            await amqpHelper.publishMessage(inputMessage, {
                parentMessageId,
                threadId
            });
            try {
                await amqpHelper.removeListenQueue();
                await runner.putOutToSea(settings.readFrom(env), ipc);
            } catch (e) {
                expect(e.message).to.match(/BasicConsume; 404/);
                await runner.__test__.disconnectOnly();
                return;
            }

            throw new Error('Error expected!');
        });
        it('should reconnect if consumer connection closed and continue message processing', async () => {
            let threadId2 = uuid.v4();
            helpers.mockApiTaskStepResponse(env);

            nock('https://api.acme.com')
                .post('/subscribe')
                .reply(200, {
                    id: 'subscription_12345'
                })
                .get('/customers')
                .times(2)
                .reply(200, customers);

            const repliesPromise = new Promise((resolve) => {
                const replies = [];
                amqpHelper.on(
                    'data',
                    ({ properties: { headers: { threadId } } }, queueName) => {
                        replies.push({ threadId, queueName });
                        if (replies.length === 2) {
                            resolve(replies);
                        }
                    }
                );
            });
            await amqpHelper.publishMessage(inputMessage, {
                parentMessageId,
                threadId
            });
            await runner.putOutToSea(settings.readFrom(env), ipc);
            const connection = await amqpHelper.serverConnectionWait('read');
            await amqpHelper.serverConnectionClose(connection);
            await amqpHelper.publishMessage(inputMessage, {
                parentMessageId,
                threadId: threadId2
            });
            const replies = await repliesPromise;
            expect(replies).to.deep.equal([
                { threadId, queueName: amqpHelper.nextStepQueue },
                { threadId: threadId2, queueName: amqpHelper.nextStepQueue }
            ]);
        }).timeout(5000); // waiting for rabbitmq http api to finally show connections can be slow
    });

    describe('when sailor is being invoked for start', () => {
        describe('when error connecting to AMQP', () => {
            it('should not send error to AMQP queue', async () => {
                // NOTICE, don't touch this.
                // it produces side effect, disabling exit at error
                // see lib/logging.js
                const fakeLogging = sinon.stub(logging, 'criticalErrorAndExit');

                const sailorSettings = settings.readFrom(env);
                const error = new Error('Error connecting to AMQP');
                sinon.stub(Sailor.prototype, 'connect').rejects(error);
                const reportError = sinon.spy(Sailor.prototype, 'reportError');

                await runner.run(sailorSettings, ipc);

                expect(fakeLogging).to.have.been.calledOnce.and.calledWith('putOutToSea.catch', error);
                expect(reportError).to.not.have.been.called;

            });
        });
    });

    describe('when sailor is being invoked for shutdown', () => {
        describe('when hooksdata is found', () => {
            it('should execute shutdown hook successfully', async () => {
                const sailorSettings = settings.readFrom(env);
                sailorSettings.HOOK_SHUTDOWN = '1';

                const subsriptionResponse = {
                    subId: '507'
                };

                let requestFromShutdownHook;
                const requestFromShutdownNock = nock('http://example.com/')
                    .post('/subscriptions/disable')
                    .reply(200, (uri, requestBody) => {
                        requestFromShutdownHook = requestBody;
                        return {
                            status: 'ok'
                        };
                    });

                // sailor retrieves startup data via sailor-support API
                const hooksDataGetNock = nock(sailorSettings.API_URI)
                    .matchHeader('Connection', 'Keep-Alive')
                    .get('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                    .reply(200, subsriptionResponse);

                // sailor removes startup data via sailor-support API
                const hooksDataDeleteNock = nock(sailorSettings.API_URI)
                    .matchHeader('Connection', 'Keep-Alive')
                    .delete('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                    .reply(204);

                helpers.mockApiTaskStepResponse(env);

                runner.run(sailorSettings, ipc);
                await new Promise(resolve =>
                    // hooksDataDeleteNock.on('replied', () => setTimeout(() => resolve(), 50)))
                    hooksDataDeleteNock.on('replied', () => resolve()));

                expect(hooksDataGetNock.isDone()).to.be.ok;

                expect(requestFromShutdownHook).to.deep.equal({
                    cfg: {
                        apiKey: 'secret'
                    },
                    startupData: subsriptionResponse
                });

                expect(requestFromShutdownNock.isDone()).to.be.ok;
                expect(hooksDataDeleteNock.isDone()).to.be.ok;
            });
        });

        describe('when request for hooksdata is failed with an error', () => {
            // @todo
            it('should not execute shutdown hook');
        });

        describe('when shutdown hook method is not found', () => {
            // @todo
            it('should not thrown error and just finish process');
        });
    });
});
