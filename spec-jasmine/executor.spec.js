const nock = require('nock');
const TaskExec = require('../src/executor.js').TaskExec;
const payload = { content: 'MessageContent' };
const cfg = {};

describe('Executor', () => {
    it('Should execute passthrough trigger and emit all events - data, end', async () => {
        const taskexec = new TaskExec();
        taskexec.on('error', () => { });
        spyOn(taskexec, 'emit').and.callThrough();

        const module = require('./component/triggers/passthrough.js');
        await taskexec.process(module, payload, cfg);

        expect(taskexec.emit).toHaveBeenCalled();
        expect(taskexec.emit.calls.argsFor(0)[0]).toEqual('data');
        expect(taskexec.emit.calls.argsFor(1)[0]).toEqual('end');
    });

    it('Should reject if module is missing', async () => {
        const taskexec = new TaskExec();
        taskexec.on('error', () => { });
        spyOn(taskexec, 'emit').and.callThrough();

        await taskexec.process({}, payload, cfg);

        expect(taskexec.emit).toHaveBeenCalled();
        expect(taskexec.emit.calls.argsFor(0)[0]).toEqual('error');
        expect(taskexec.emit.calls.argsFor(0)[1].message).toEqual('Process function is not found');
        expect(taskexec.emit.calls.argsFor(1)[0]).toEqual('end');
    });

    it('Should execute rebound_trigger and emit all events - rebound, end', async () => {
        const taskexec = new TaskExec();
        taskexec.on('error', () => { });
        spyOn(taskexec, 'emit').and.callThrough();

        const module = require('./component/triggers/rebound_trigger.js');
        await taskexec.process(module, payload, cfg);

        expect(taskexec.emit).toHaveBeenCalled();
        expect(taskexec.emit.calls.argsFor(0)[0]).toEqual('rebound');
        expect(taskexec.emit.calls.argsFor(1)[0]).toEqual('end');
    });

    it('Should execute complex trigger, and emit all 6 events', async () => {
        const taskexec = new TaskExec();
        taskexec.on('error', () => { });
        spyOn(taskexec, 'emit').and.callThrough();

        const module = require('./component/triggers/datas_and_errors.js');
        await taskexec.process(module, payload, cfg);

        expect(taskexec.emit).toHaveBeenCalled();
        expect(taskexec.emit).toHaveBeenCalledTimes(6);
        expect(taskexec.emit.calls.argsFor(0)[0]).toEqual('data');
        expect(taskexec.emit.calls.argsFor(0)[1]).toEqual({ content: 'Data 1' });
        expect(taskexec.emit.calls.argsFor(1)[0]).toEqual('error');
        expect(taskexec.emit.calls.argsFor(1)[1].message).toEqual('Error 1');
        expect(taskexec.emit.calls.argsFor(2)[0]).toEqual('data');
        expect(taskexec.emit.calls.argsFor(2)[1]).toEqual({ content: 'Data 2' });
        expect(taskexec.emit.calls.argsFor(3)[0]).toEqual('error');
        expect(taskexec.emit.calls.argsFor(3)[1].message).toEqual('Error 2');
        expect(taskexec.emit.calls.argsFor(4)[0]).toEqual('data');
        expect(taskexec.emit.calls.argsFor(4)[1]).toEqual({ content: 'Data 3' });
        expect(taskexec.emit.calls.argsFor(5)[0]).toEqual('end');
    });

    it('Should execute test_trigger and emit all events - 3 data events, 3 errors, 3 rebounds, 1 end', async () => {
        const taskexec = new TaskExec();
        taskexec.on('error', () => { });
        spyOn(taskexec, 'emit').and.callThrough();

        const module = require('./component/triggers/test_trigger.js');
        await taskexec.process(module, payload, cfg);

        expect(taskexec.emit).toHaveBeenCalled();
        expect(taskexec.emit.calls.argsFor(0)).toEqual(['data', 'Data 1']);
        expect(taskexec.emit.calls.argsFor(1)).toEqual(['data', { content: 'Data 2' }]);
        expect(taskexec.emit.calls.argsFor(2)).toEqual(['data']);
        expect(taskexec.emit.calls.argsFor(3)).toEqual(['error', 'Error 1']);
        expect(taskexec.emit.calls.argsFor(4)[0]).toEqual('error');
        expect(taskexec.emit.calls.argsFor(4)[1].message).toEqual('Error 2');
        expect(taskexec.emit.calls.argsFor(5)).toEqual(['error']);
        expect(taskexec.emit.calls.argsFor(6)).toEqual(['rebound', 'Rebound Error 1']);
        expect(taskexec.emit.calls.argsFor(7)[0]).toEqual('rebound');
        expect(taskexec.emit.calls.argsFor(7)[1].message).toEqual('Rebound Error 2');
        expect(taskexec.emit.calls.argsFor(8)).toEqual(['rebound']);
        expect(taskexec.emit.calls.argsFor(9)[0]).toEqual('end');
    });

    describe('Promises', () => {
        it('Should execute a Promise trigger and emit all events - data, end', async () => {
            const taskexec = new TaskExec();
            taskexec.on('error', () => { });
            spyOn(taskexec, 'emit').and.callThrough();

            const module = require('./component/triggers/promise_trigger.js');
            await taskexec.process(module, payload, cfg);

            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit).toHaveBeenCalledTimes(2);
            expect(taskexec.emit.calls.argsFor(0)[0]).toEqual('data');
            expect(taskexec.emit.calls.argsFor(0)[1]).toEqual({ body: 'I am a simple promise' });
            expect(taskexec.emit.calls.argsFor(1)[0]).toEqual('end');
        });

        it('Should execute a Promise.resolve() trigger and emit end', async () => {
            const taskexec = new TaskExec();
            taskexec.on('error', () => { });
            spyOn(taskexec, 'emit').and.callThrough();

            const module = require('./component/triggers/promise_resolve_no_data.js');
            await taskexec.process(module, payload, cfg);

            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit).toHaveBeenCalledTimes(1);
            expect(taskexec.emit.calls.argsFor(0)[0]).toEqual('end');
        });
    });

    describe('Request Promise', () => {
        beforeEach(() => {
            nock('http://promise_target_url:80')
                .get('/foo/bar')
                .reply(200, { message: 'Life is good with promises' });
        });

        it('Should execute a Promise trigger and emit all events - data, end', async () => {
            const taskexec = new TaskExec();
            taskexec.on('error', () => { });
            spyOn(taskexec, 'emit').and.callThrough();

            const module = require('./component/triggers/promise_request_trigger.js');
            await taskexec.process(module, payload, cfg);

            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit).toHaveBeenCalledTimes(2);
            expect(taskexec.emit.calls.argsFor(0)[0]).toEqual('data');
            expect(taskexec.emit.calls.argsFor(0)[1]).toEqual({ body: { message: 'Life is good with promises' } });
            expect(taskexec.emit.calls.argsFor(1)[0]).toEqual('end');
        });
    });

    describe('Request Generators', () => {
        it('Should execute a Promise trigger and emit all events - data, end', async () => {
            nock('http://promise_target_url:80')
                .get('/foo/bar')
                .reply(200, { message: 'Life is good with generators' });

            const taskexec = new TaskExec();
            taskexec.on('error', () => { });
            spyOn(taskexec, 'emit').and.callThrough();

            const module = require('./component/triggers/generator_request_trigger.js');
            await taskexec.process(module, payload, cfg);

            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit).toHaveBeenCalledTimes(2);
            expect(taskexec.emit.calls.argsFor(0)[0]).toEqual('data');
            expect(taskexec.emit.calls.argsFor(0)[1]).toEqual({
                body: {
                    message: 'Life is good with generators'
                }
            });
            expect(taskexec.emit.calls.argsFor(1)[0]).toEqual('end');
        });

        it('Should execute a Promise trigger and emit all events - data, end', async () => {
            nock('https://login.acme')
                .post('/oauth2/v2.0/token', {
                    client_id: 'admin',
                    client_secret: 'secret'
                })
                .reply(200, { access_token: 'new_access_token' })
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

            const taskexec = new TaskExec();
            taskexec.on('error', () => { });
            spyOn(taskexec, 'emit').and.callThrough();

            const module = require('./component/triggers/promise_emitting_events.js');
            await taskexec.process(module, payload, cfg);

            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit).toHaveBeenCalledTimes(3);
            expect(taskexec.emit.calls.argsFor(0)[0]).toEqual('updateKeys');
            expect(taskexec.emit.calls.argsFor(0)[1]).toEqual({
                oauth: {
                    access_token: 'new_access_token'
                }
            });
            expect(taskexec.emit.calls.argsFor(1)[0]).toEqual('data');
            expect(taskexec.emit.calls.argsFor(1)[1]).toEqual({
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
            });
            expect(taskexec.emit.calls.argsFor(2)[0]).toEqual('end');
        });
    });

    describe('async process function', () => {
        it('should work', async () => {
            const taskexec = new TaskExec();
            taskexec.on('error', () => { });
            spyOn(taskexec, 'emit').and.callThrough();

            const module = require('./component/triggers/async_process_function');
            await taskexec.process(module, payload, cfg);

            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit).toHaveBeenCalledTimes(2);
            expect(taskexec.emit.calls.argsFor(0)[0]).toEqual('data');
            expect(taskexec.emit.calls.argsFor(0)[1]).toEqual({ some: 'data' });
            expect(taskexec.emit.calls.argsFor(1)[0]).toEqual('end');
        });
    });
});
