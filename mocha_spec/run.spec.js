const nock = require('nock');
const chai = require('chai');
const sinon = require('sinon');

chai.use(require('sinon-chai'));
const { expect } = chai;

const helpers = require('./integration_helpers');
const SingleApp = require('../lib/SingleApp.js');

describe('Integration Test', () => {
    const customers = [
        {
            name: 'Homer Simpson'
        },
        {
            name: 'Marge Simpson'
        }
    ];
    const inputMessage = {
        headers: {},
        body: {
            message: 'Just do it!'
        }
    };
    let config;
    let amqpHelper;
    let sandbox;
    let app;
    let oldEnv;

    beforeEach(async () => {
        oldEnv = Object.assign({}, process.env);
        config = helpers.prepareEnv();
        sandbox = sinon.createSandbox();
        nock('https://api.acme.com')
            .post('/subscribe')
            .reply(200, {
                id: 'subscription_12345'
            })
            .get('/customers')
            .reply(200, customers);
        app = new SingleApp();
    });

    afterEach(async () => {
        Object.assign(process.env, oldEnv);
        delete config.ELASTICIO_STARTUP_REQUIRED;
        delete config.ELASTICIO_FUNCTION;
        delete config.ELASTICIO_HOOK_SHUTDOWN;

        await amqpHelper.cleanUp();
        nock.cleanAll();
        sandbox.restore();
        await app.stop();
    });

    describe('when sailor is being invoked for message processing', () => {
        const parentMessageId = 'parent_message_1234567890';
        const threadId = helpers.PREFIX + '_thread_id_123456';
        const messageId = 'f45be600-f770-11e6-b42d-b187bfbf19fd';

        it('should run trigger successfully', async () => {
            config.ELASTICIO_FUNCTION = 'init_trigger';
            amqpHelper = helpers.amqp(config);
            await amqpHelper.prepare();
            helpers.mockApiTaskStepResponse(config);

            const promise = new Promise(resolve => {
                amqpHelper.on('data', ({ properties, body }, queueName) => {
                    expect(queueName).to.eql(amqpHelper.nextStepQueue);

                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;

                    expect(properties.headers).to.deep.equal({
                        execId: config.ELASTICIO_EXEC_ID,
                        taskId: config.ELASTICIO_FLOW_ID,
                        workspaceId: config.ELASTICIO_WORKSPACE_ID,
                        containerId: config.ELASTICIO_CONTAINER_ID,
                        userId: config.ELASTICIO_USER_ID,
                        stepId: config.ELASTICIO_STEP_ID,
                        compId: config.ELASTICIO_COMP_ID,
                        function: config.ELASTICIO_FUNCTION,
                        threadId,
                        parentMessageId: parentMessageId,
                        messageId
                    });

                    delete properties.headers;

                    expect(properties).to.deep.equal({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        deliveryMode: undefined,
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

                    resolve();
                });
            });

            await app.start();
            amqpHelper.publishMessage(inputMessage, {
                parentMessageId,
                threadId
            });
            await promise;
        });

        it('should augment passthrough property with data', async () => {
            config.ELASTICIO_STEP_ID = 'step_2';
            config.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
            config.ELASTICIO_FUNCTION = 'emit_data';

            amqpHelper = helpers.amqp(config);
            await amqpHelper.prepare();

            helpers.mockApiTaskStepResponse(config, {
                is_passthrough: true
            });

            const psMsg = Object.assign(inputMessage, {
                passthrough: {
                    step_1: {
                        id: '34',
                        body: {},
                        attachments: {}
                    }
                }
            });

            const promise = new Promise((resolve) => {
                amqpHelper.on('data', ({ properties, emittedMessage }, queueName) => {
                    expect(queueName).to.eql(amqpHelper.nextStepQueue);

                    expect(emittedMessage.passthrough).to.deep.eql({
                        step_1: {
                            id: '34',
                            body: {},
                            attachments: {}
                        },
                        step_2: {
                            id: messageId,
                            headers: {
                                'x-custom-component-header': '123_abc'
                            },
                            body: {
                                id: 'someId',
                                hai: 'there'
                            }
                        }
                    });

                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;

                    expect(properties.headers).to.deep.equal({
                        taskId: config.ELASTICIO_FLOW_ID,
                        execId: config.ELASTICIO_EXEC_ID,
                        workspaceId: config.ELASTICIO_WORKSPACE_ID,
                        containerId: config.ELASTICIO_CONTAINER_ID,
                        userId: config.ELASTICIO_USER_ID,
                        threadId,
                        stepId: config.ELASTICIO_STEP_ID,
                        compId: config.ELASTICIO_COMP_ID,
                        function: config.ELASTICIO_FUNCTION,
                        messageId,
                        parentMessageId
                    });

                    delete properties.headers;

                    expect(properties).to.deep.eql({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        deliveryMode: undefined,
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
                    resolve();
                });
            });
            await app.start();
            amqpHelper.publishMessage(psMsg, {
                parentMessageId,
                threadId
            });

            await promise;
        });

        it('should work well with async process function emitting data', async () => {
            config.ELASTICIO_STEP_ID = 'step_2';
            config.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
            config.ELASTICIO_FUNCTION = 'async_trigger';
            config.ELASTICIO_DATA_RATE_LIMIT = '1';
            config.ELASTICIO_RATE_INTERVAL = '110';

            amqpHelper = helpers.amqp(config);
            await amqpHelper.prepare();

            helpers.mockApiTaskStepResponse(config, {
                is_passthrough: true
            });

            const psMsg = Object.assign(inputMessage, {
                passthrough: {
                    step_1: {
                        id: '34',
                        body: {},
                        attachments: {}
                    }
                }
            });

            amqpHelper.publishMessage(psMsg, {
                parentMessageId,
                threadId
            });

            let counter = 0;
            const start = Date.now();
            const promise = new Promise(resolve => {
                amqpHelper.on('data', ({ properties, emittedMessage }, queueName) => {

                    expect(queueName).to.eql(amqpHelper.nextStepQueue);

                    expect(emittedMessage.passthrough).to.deep.eql({
                        step_1: {
                            id: '34',
                            body: {},
                            attachments: {}
                        },
                        step_2: {
                            id: messageId,
                            headers: {
                                'x-custom-component-header': '123_abc'
                            },
                            body: {
                                id: 'someId',
                                hai: 'there'
                            }
                        }
                    });


                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;

                    expect(properties.headers).to.deep.equal({
                        taskId: config.ELASTICIO_FLOW_ID,
                        execId: config.ELASTICIO_EXEC_ID,
                        workspaceId: config.ELASTICIO_WORKSPACE_ID,
                        containerId: config.ELASTICIO_CONTAINER_ID,
                        userId: config.ELASTICIO_USER_ID,
                        threadId,
                        stepId: config.ELASTICIO_STEP_ID,
                        compId: config.ELASTICIO_COMP_ID,
                        function: config.ELASTICIO_FUNCTION,
                        messageId,
                        parentMessageId
                    });

                    delete properties.headers;

                    expect(properties).to.deep.eql({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
                        deliveryMode: undefined,
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

                    counter++;
                    // We need 10 messages
                    if (counter > 10) {
                        const duration = Date.now() - start;
                        expect(duration > 1000).to.be.ok;
                        resolve();
                    }
                });
            });

            await app.start();
            await promise;
        });

        describe('when env ELASTICIO_STARTUP_REQUIRED is set', () => {
            beforeEach(() => {
                config.ELASTICIO_STARTUP_REQUIRED = '1';
                config.ELASTICIO_FUNCTION = 'init_trigger';
            });

            describe('when hooks data for the task is not created yet', () => {
                it('should execute startup successfully', async () => {
                    amqpHelper = helpers.amqp(config);
                    await amqpHelper.prepare();
                    let startupRegistrationRequest;
                    const startupRegistrationNock = nock('http://example.com/')
                        .post('/subscriptions/enable')
                        .reply(200, (uri, requestBody) => {
                            startupRegistrationRequest = requestBody;
                            return {
                                status: 'ok'
                            };
                        });

                    helpers.mockApiTaskStepResponse(config);

                    // sailor persists startup data via sailor-support API
                    let hooksDataRequest;
                    const hooksDataNock = nock(config.ELASTICIO_API_URI)
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

                    const promise = new Promise(resolve => amqpHelper.on('data', ({ properties, body }, queueName) => {
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

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;

                        expect(properties.headers).to.eql({
                            execId: config.ELASTICIO_EXEC_ID,
                            taskId: config.ELASTICIO_FLOW_ID,
                            workspaceId: config.ELASTICIO_WORKSPACE_ID,
                            containerId: config.ELASTICIO_CONTAINER_ID,
                            userId: config.ELASTICIO_USER_ID,
                            stepId: config.ELASTICIO_STEP_ID,
                            compId: config.ELASTICIO_COMP_ID,
                            function: config.ELASTICIO_FUNCTION,
                            messageId
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

                        resolve();
                    }));

                    await app.start();
                    amqpHelper.publishMessage(inputMessage);
                    await promise;
                });
            });

            describe('when hooks data already exists', () => {
                it('should delete previous data and execute startup successfully', async () => {
                    amqpHelper = helpers.amqp(config);
                    await amqpHelper.prepare();
                    let startupRegistrationRequest;
                    const startupRegistrationNock = nock('http://example.com/')
                        .post('/subscriptions/enable')
                        .reply(200, (uri, requestBody) => {
                            startupRegistrationRequest = requestBody;
                            return {
                                status: 'ok'
                            };
                        });

                    helpers.mockApiTaskStepResponse(config);

                    let hooksDataRequest1;
                    let hooksDataRequest2;

                    // sailor persists startup data via sailor-support API
                    const hooksDataNock1 = nock(config.ELASTICIO_API_URI)
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
                    const hooksDataDeleteNock = nock(config.ELASTICIO_API_URI)
                        .matchHeader('Connection', 'Keep-Alive')
                        .delete('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                        .reply(204);

                    // sailor persists startup data via sailor-support API
                    const hooksDataNock2 = nock(config.ELASTICIO_API_URI)
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

                    const promise = new Promise(resolve => amqpHelper.on('data', ({ properties, body }, queueName) => {
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

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;

                        expect(properties.headers).to.eql({
                            execId: config.ELASTICIO_EXEC_ID,
                            taskId: config.ELASTICIO_FLOW_ID,
                            workspaceId: config.ELASTICIO_WORKSPACE_ID,
                            containerId: config.ELASTICIO_CONTAINER_ID,
                            userId: config.ELASTICIO_USER_ID,
                            stepId: config.ELASTICIO_STEP_ID,
                            compId: config.ELASTICIO_COMP_ID,
                            function: config.ELASTICIO_FUNCTION,
                            messageId
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
                        resolve();
                    }));

                    await app.start();

                    amqpHelper.publishMessage(inputMessage);
                    await promise;
                });
            });

            describe('when startup method returns empty data', () => {
                it('should store an empty object as data and execute trigger successfully', async () => {
                    let startupRegistrationRequest;

                    config.ELASTICIO_FUNCTION = 'startup_with_empty_data';
                    amqpHelper = helpers.amqp(config);
                    await amqpHelper.prepare();

                    const startupRegistrationNock = nock('http://example.com/')
                        .post('/subscriptions/enable')
                        .reply(200, (uri, requestBody) => {
                            startupRegistrationRequest = requestBody;
                            return {
                                status: 'ok'
                            };
                        });

                    helpers.mockApiTaskStepResponse(config);

                    // sailor persists startup data via sailor-support API
                    const hooksDataNock = nock(config.ELASTICIO_API_URI)
                        .matchHeader('Connection', 'Keep-Alive')
                        .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {})
                        .reply(201);

                    // sailor removes data in order to resolve conflict
                    const hooksDataDeleteNock = nock(config.ELASTICIO_API_URI)
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

                    const promise = new Promise(resolve => amqpHelper.on('data', ({ properties, body }, queueName) => {
                        expect(queueName).to.eql(amqpHelper.nextStepQueue);

                        expect(startupRegistrationRequest).to.deep.equal({
                            data: 'startup'
                        });

                        expect(startupRegistrationNock.isDone()).to.be.ok;
                        expect(hooksDataNock.isDone()).to.be.ok;
                        expect(hooksDataDeleteNock.isDone()).to.not.be.ok;

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;

                        expect(properties.headers).to.eql({
                            execId: config.ELASTICIO_EXEC_ID,
                            taskId: config.ELASTICIO_FLOW_ID,
                            workspaceId: config.ELASTICIO_WORKSPACE_ID,
                            containerId: config.ELASTICIO_CONTAINER_ID,
                            userId: config.ELASTICIO_USER_ID,
                            stepId: config.ELASTICIO_STEP_ID,
                            compId: config.ELASTICIO_COMP_ID,
                            function: config.ELASTICIO_FUNCTION,
                            messageId
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
                        resolve();
                    }));

                    await app.start();

                    amqpHelper.publishMessage(inputMessage);
                    await promise;
                });
            });

            describe('when startup method does not exist', () => {
                it('should store an empty hooks data and run trigger successfully', async () => {
                    config.ELASTICIO_FUNCTION = 'trigger_with_no_hooks';

                    amqpHelper = helpers.amqp(config);
                    await amqpHelper.prepare();
                    helpers.mockApiTaskStepResponse(config);

                    // sailor persists startup data via sailor-support API
                    const hooksDataNock = nock(config.ELASTICIO_API_URI)
                        .matchHeader('Connection', 'Keep-Alive')
                        .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {})
                        .reply(201);

                    // response for a subscription request, which performed inside of init method
                    nock('https://api.acme.com')
                        .get('/customers')
                        .reply(200, customers);

                    const promise = new Promise(resolve => amqpHelper.on('data', ({ properties, body }, queueName) => {
                        expect(queueName).to.eql(amqpHelper.nextStepQueue);

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;

                        expect(properties.headers).to.eql({
                            execId: config.ELASTICIO_EXEC_ID,
                            taskId: config.ELASTICIO_FLOW_ID,
                            workspaceId: config.ELASTICIO_WORKSPACE_ID,
                            containerId: config.ELASTICIO_CONTAINER_ID,
                            userId: config.ELASTICIO_USER_ID,
                            stepId: config.ELASTICIO_STEP_ID,
                            compId: config.ELASTICIO_COMP_ID,
                            function: config.ELASTICIO_FUNCTION,
                            messageId
                        });

                        expect(body).to.deep.equal({
                            originalMsg: inputMessage,
                            customers: customers
                        });

                        expect(hooksDataNock.isDone()).to.be.ok;

                        resolve();
                    }));

                    await app.start();

                    amqpHelper.publishMessage(inputMessage);
                    await promise;
                });
            });
        });

        describe('when reply_to header is set', () => {
            it('should send http reply successfully', async () => {
                config.ELASTICIO_FUNCTION = 'http_reply_action';

                helpers.mockApiTaskStepResponse(config);
                amqpHelper = helpers.amqp(config);
                await amqpHelper.prepare();

                nock('https://api.acme.com')
                    .post('/subscribe')
                    .reply(200, {
                        id: 'subscription_12345'
                    })
                    .get('/customers')
                    .reply(200, customers);

                const promise = new Promise(resolve =>
                    amqpHelper.on('data', ({ properties, emittedMessage }, queueName) => {
                        expect(queueName).to.eql(amqpHelper.httpReplyQueueName);

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;

                        expect(properties.headers.messageId).to.be.a('string');
                        delete properties.headers.messageId;

                        expect(properties.headers).to.eql({
                            execId: config.ELASTICIO_EXEC_ID,
                            taskId: config.ELASTICIO_FLOW_ID,
                            workspaceId: config.ELASTICIO_WORKSPACE_ID,
                            containerId: config.ELASTICIO_CONTAINER_ID,
                            userId: config.ELASTICIO_USER_ID,
                            stepId: config.ELASTICIO_STEP_ID,
                            compId: config.ELASTICIO_COMP_ID,
                            function: config.ELASTICIO_FUNCTION,
                            reply_to: amqpHelper.httpReplyQueueRoutingKey
                        });

                        expect(emittedMessage).to.eql({
                            headers: {
                                'content-type': 'text/plain'
                            },
                            body: 'Ok',
                            statusCode: 200
                        });

                        resolve();
                    })
                );

                await app.start();

                amqpHelper.publishMessage(inputMessage, {}, {
                    reply_to: amqpHelper.httpReplyQueueRoutingKey
                });
                await promise;
            });
        });

        describe('when sailor could not init the module', () => {
            it('should publish init errors to RabbitMQ', async () => {
                // If component fails to start, then it calls process.exit
                // and this crashes tests. Handle this.
                sandbox.stub(process, 'exit');
                sandbox.stub(process, 'on');
                config.ELASTICIO_FUNCTION = 'fails_to_init';

                helpers.mockApiTaskStepResponse(config);
                amqpHelper = helpers.amqp(config);
                await amqpHelper.prepare();

                const promise = new Promise(resolve =>
                    amqpHelper.on('data', ({ properties, emittedMessage }, queueName) => {
                        expect(queueName).to.eql(amqpHelper.nextStepErrorQueue);

                        expect(JSON.parse(emittedMessage.error).message).to.equal('OMG. I cannot init');

                        expect(properties.headers).to.eql({
                            execId: config.ELASTICIO_EXEC_ID,
                            taskId: config.ELASTICIO_FLOW_ID,
                            workspaceId: config.ELASTICIO_WORKSPACE_ID,
                            containerId: config.ELASTICIO_CONTAINER_ID,
                            userId: config.ELASTICIO_USER_ID,
                            stepId: config.ELASTICIO_STEP_ID,
                            compId: config.ELASTICIO_COMP_ID,
                            function: config.ELASTICIO_FUNCTION
                        });
                        expect(process.exit).to.have.been.calledOnce.and.calledWith(1);
                        resolve();
                    })
                );
                await app.start();
                await promise;
            });
        });
    });

    describe('when sailor is being invoked for shutdown', () => {
        describe('when hooksdata is found', () => {
            it('should execute shutdown successfully', async () => {
                config.ELASTICIO_HOOK_SHUTDOWN = '1';
                config.ELASTICIO_FUNCTION = 'init_trigger';

                amqpHelper = helpers.amqp(config);
                await amqpHelper.prepare();

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
                const hooksDataGetNock = nock(config.ELASTICIO_API_URI)
                    .matchHeader('Connection', 'Keep-Alive')
                    .get('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                    .reply(200, subsriptionResponse);

                // sailor removes startup data via sailor-support API
                const hooksDataDeleteNock = nock(config.ELASTICIO_API_URI)
                    .matchHeader('Connection', 'Keep-Alive')
                    .delete('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                    .reply(204);

                helpers.mockApiTaskStepResponse(config);
                const promise = new Promise(resolve => hooksDataDeleteNock.on('replied', () => setTimeout(() => {
                    expect(hooksDataGetNock.isDone()).to.be.ok;

                    expect(requestFromShutdownHook).to.deep.equal({
                        cfg: {
                            apiKey: 'secret'
                        },
                        startupData: subsriptionResponse
                    });

                    expect(requestFromShutdownNock.isDone()).to.be.ok;
                    expect(hooksDataDeleteNock.isDone()).to.be.ok;
                    resolve();

                }, 50)));

                await app.start();
                await promise;
            });
        });

        describe('when request for hooksdata is failed with an error', () => {
            // @todo
            it('should not execute shutdown');
        });

        describe('when shutdown hook method is not found', () => {
            // @todo
            it('should not thrown error and just finish process');
        });
    });
});
