const chai = require('chai');
const { expect } = chai;
const sinon = require('sinon');
chai.use(require('sinon-chai'));
const nock = require('nock');

const TaskExec = require('../../lib/executor.js').TaskExec;
const { MessageLevelLogger } = require('../../lib/logging.js');

async function waitsFor(cb, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (cb()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('timeout waiting condition');
}

describe('Executor', () => {
    let logger;
    let sandbox;

    const payload = { content: 'MessageContent' };
    const cfg = {};

    beforeEach(() => {
        logger = new MessageLevelLogger({}, {
            threadId: 'threadId',
            messageId: 'messageId',
            parentMessageId: 'parentMessageId'
        });
        sandbox = sinon.createSandbox();
    });
    afterEach(() => {
        sandbox.restore();
    });
    describe('#constructor', () => {
        it('should be constructable without arguments', () => {
            const taskexec = new TaskExec({ }, logger);
            expect(taskexec).to.be.instanceof(TaskExec);
        });
        it('should properly store variables', () => {
            const vars = {
                var1: 'val1',
                var2: 'val2'
            };
            const taskexec = new TaskExec({ variables: vars }, logger);
            expect(taskexec._variables).to.deep.equal(vars);
        });
    });
    describe('getVariables', () => {
        it('should return flow variables', () => {
            const vars = {
                var1: 'val1',
                var2: 'val2'
            };
            const taskexec = new TaskExec({ variables: vars }, logger);
            expect(taskexec.getFlowVariables()).to.deep.equal(vars);
        });
    });

    it('Should execute passthrough trigger and emit all events - data, end', async () => {
        const taskexec = new TaskExec({ }, logger);

        // eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        sandbox.spy(taskexec, 'emit');

        const module = require('./../../spec/component/triggers/passthrough.js');

        taskexec.process(module, payload, cfg);

        await waitsFor(() => taskexec.emit.callCount > 1, 5000);

        expect(taskexec.emit).to.have.been.calledTwice
            .and.calledWith('data')
            .and.calledWith('end');
    });

    it('Should reject if module is missing', async () => {
        const taskexec = new TaskExec({}, logger);
        // eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        sandbox.spy(taskexec, 'emit');

        taskexec.process({}, payload, cfg);

        await waitsFor(() => taskexec.emit.callCount > 1, 5000);

        expect(taskexec.emit).to.have.been.calledTwice
            .and.calledWith('error', sinon.match((arg) => arg.message === 'Process function is not found'))
            .and.calledWith('end');
    });

    it('Should execute rebound_trigger and emit all events - rebound, end', async () => {
        const taskexec = new TaskExec({ }, logger);
        // eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        sandbox.spy(taskexec, 'emit');

        const module = require('./../../spec/component/triggers/rebound_trigger.js');

        taskexec.process(module, payload, cfg);

        await waitsFor(() => taskexec.emit.callCount > 1, 5000);

        expect(taskexec.emit).to.have.been.calledTwice
            .and.calledWith('rebound', sinon.match(arg => arg.message === 'Rebound reason'))
            .and.calledWith('end')
            .and.calledWith('end');
    });

    it('Should execute complex trigger, and emit all 6 events', async () => {
        const taskexec = new TaskExec({ }, logger);
        // eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        sandbox.spy(taskexec, 'emit');

        const module = require('./../../spec/component/triggers/datas_and_errors.js');

        const promise = waitsFor(() => taskexec.emit.callCount >= 5, 5000);
        taskexec.process(module, payload, cfg);
        await promise;

        expect(taskexec.emit).to.have.been.callCount(5)
            .and.calledWith('data', { content: 'Data 1' })
            .and.calledWith('error', sinon.match(arg => arg.message === 'Error 1'))
            .and.calledWith('data', { content: 'Data 2' })
            .and.calledWith('error', sinon.match(arg => arg.message === 'Error 2'))
            .and.calledWith('data', { content: 'Data 3' });
    });

    it('Should execute a Promise trigger and emit all events - data, end', async () => {
        const taskexec = new TaskExec({ }, logger);

        // eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        sandbox.spy(taskexec, 'emit');

        const module = require('./../../spec/component/triggers/promise_trigger.js');

        const promise = waitsFor(() => taskexec.emit.callCount > 1, 5000);
        taskexec.process(module, payload, cfg);
        await promise;

        expect(taskexec.emit).to.have.been.calledTwice
            .and.calledWith('data', { body: 'I am a simple promise' })
            .and.calledWith('end');
    });
    it('Should execute test_trigger and emit all events - 3 data events, 3 errors, 3 rebounds, 1 end', async () => {
        const taskexec = new TaskExec({ }, logger);
        // eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        sandbox.spy(taskexec, 'emit');

        const module = require('./../../spec/component/triggers/test_trigger.js');
        const promise = waitsFor(() => taskexec.emit.callCount >= 9, 5000);
        taskexec.process(module, payload, cfg);

        await promise;

        expect(taskexec.emit).to.have.been.callCount(10)
            .and.calledWith('data', 'Data 1')
            .and.calledWith('data', { content: 'Data 2' })
            .and.calledWith('data')
            .and.calledWith('error', 'Error 1')
            .and.calledWith('error', sinon.match(arg => (arg instanceof Error) && arg.message === 'Error 2'))
            .and.calledWith('error')
            .and.calledWith('rebound', 'Rebound Error 1')
            .and.calledWith('rebound', sinon.match(arg => (arg instanceof Error) && arg.message === 'Rebound Error 2'))
            .and.calledWith('rebound')
            .and.calledWith('end');
    });

    describe('Promises', () => {
        it('Should execute a Promise.resolve() trigger and emit end', async () => {
            const taskexec = new TaskExec({ }, logger);

            // eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            sandbox.spy(taskexec, 'emit');

            const module = require('./../../spec/component/triggers/promise_resolve_no_data.js');

            const promise = waitsFor(() => taskexec.emit.callCount > 0, 5000);
            taskexec.process(module, payload, cfg);
            await promise;

            expect(taskexec.emit).to.have.been.calledOnce
                .and.calledWith('end');
        });
    });

    describe('Request Promise', () => {
        beforeEach(() => {
            nock('http://promise_target_url:80')
                .get('/foo/bar')
                .reply(200, {
                    message: 'Life is good with promises'
                });
        });

        it('Should execute a Promise trigger and emit all events - data, end', async () => {
            const taskexec = new TaskExec({ }, logger);

            // eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            sandbox.spy(taskexec, 'emit');

            const module = require('./../../spec/component/triggers/promise_request_trigger.js');

            const promise = waitsFor(() => taskexec.emit.callCount > 1, 5000);
            taskexec.process(module, payload, cfg);
            await promise;

            expect(taskexec.emit).to.have.been.calledTwice
                .and.calledWith('data', { body: { message: 'Life is good with promises' } })
                .and.calledWith('end');
        });
    });

    describe('Request Generators', () => {
        it('Should execute a Promise trigger and emit all events - data, end', async () => {
            nock('http://promise_target_url:80')
                .get('/foo/bar')
                .reply(200, {
                    message: 'Life is good with generators'
                });

            const taskexec = new TaskExec({ }, logger);

            // eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            sandbox.spy(taskexec, 'emit');

            const module = require('./../../spec/component/triggers/generator_request_trigger.js');

            const promise = waitsFor(() => taskexec.emit.callCount > 1, 5000);
            taskexec.process(module, payload, cfg);
            await promise;

            expect(taskexec.emit).to.have.been.calledTwice
                .and.calledWith('data', { body: { message: 'Life is good with generators' } })
                .and.calledWith('end');
        });

        it('Should execute a Promise trigger and emit all events - data, end', async () => {
            nock('https://login.acme')
                .post('/oauth2/v2.0/token', {
                    client_id: 'admin',
                    client_secret: 'secret'
                })
                .reply(200, {
                    access_token: 'new_access_token'
                })
                .get('/oauth2/v2.0/contacts')
                .reply(200, {
                    result: [
                        {
                            email: 'homer.simpson@acme.org'
                        },
                        {
                            email: 'marge.simpson@acme.org'
                        }
                    ]
                });

            const taskexec = new TaskExec({ }, logger);

            // eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            sandbox.spy(taskexec, 'emit');

            const module = require('./../../spec/component/triggers/promise_emitting_events.js');

            const promise = waitsFor(() => taskexec.emit.callCount > 1, 5000);
            taskexec.process(module, payload, cfg);
            await promise;

            expect(taskexec.emit).to.have.been.callCount(3)
                .and.calledWith('updateKeys', { oauth: { access_token: 'new_access_token' } })
                .and.calledWith('data', {
                    body: {
                        result: [
                            {
                                email: 'homer.simpson@acme.org'
                            },
                            {
                                email: 'marge.simpson@acme.org'
                            }
                        ]
                    }
                })
                .and.calledWith('end');
        });
    });
    describe('async process function', () => {
        it('should work', async () => {
            const taskexec = new TaskExec({ }, logger);

            // eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            sandbox.spy(taskexec, 'emit');

            const module = require('./../../spec/component/triggers/async_process_function');

            const promise = waitsFor(() => taskexec.emit.callCount > 1, 1000);
            taskexec.process(module, payload, cfg);
            await promise;
            expect(taskexec.emit).to.have.been.calledTwice
                .and.calledWith('data', { some: 'data' })
                .and.calledWith('end');
        });
    });

    describe('executor logger', () => {
        function TestStream() {
            this.lastRecord = '';
        }

        TestStream.prototype.write = function write(record) {
            this.lastRecord = record;
        };

        let taskExec;
        let testStream;

        beforeEach(() => {
            testStream = new TestStream();
            const logger = new MessageLevelLogger(
                {},
                {
                    threadId: 'threadId',
                    messageId: 'messageId',
                    parentMessageId: 'parentMessageId',
                    streams: [
                        {
                            type: 'raw',
                            stream: testStream
                        }
                    ]
                },
                true
            );

            taskExec = new TaskExec({ }, logger);
        });

        it('should check if level is enabled', () => {
            expect(taskExec.logger.info()).to.be.ok;
        });

        it('should implicitly convert first argument to string', () => {
            taskExec.logger.info(undefined);
            expect(testStream.lastRecord.msg).equal('undefined');

            taskExec.logger.info(null);
            expect(testStream.lastRecord.msg).equal('null');

            taskExec.logger.info({});
            expect(testStream.lastRecord.msg).equal('[object Object]');
        });

        it('should format log message', () => {
            taskExec.logger.info('hello %s', 'world');

            expect(testStream.lastRecord.msg).equal('hello world');
        });

        it('should log extra fields', () => {
            const testStream = new TestStream();
            const logger = new MessageLevelLogger(
                {},
                {
                    streams: [
                        {
                            type: 'raw',
                            stream: testStream
                        }
                    ],
                    threadId: 'threadId',
                    messageId: 'messageId',
                    parentMessageId: 'parentMessageId'

                },
                true
            );

            taskExec = new TaskExec({ }, logger);

            taskExec.logger.info('info');

            expect(testStream.lastRecord.name).to.equal('component');
            expect(testStream.lastRecord.threadId).to.equal('threadId');
            expect(testStream.lastRecord.messageId).to.equal('messageId');
            expect(testStream.lastRecord.parentMessageId).to.equal('parentMessageId');
            expect(testStream.lastRecord.msg).to.equal('info');
        });
    });
});
