describe('Executor', () => {

    const nock = require('nock');

    var TaskExec = require('../lib/executor.js').TaskExec;
    var payload = { content: 'MessageContent' };
    var cfg = {};

    it('Should execute passthrough trigger and emit all events - data, end', () => {
        var taskexec = new TaskExec();

        //eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        spyOn(taskexec, 'emit').andCallThrough();

        var module = require('./component/triggers/passthrough.js');

        runs(() => {
            taskexec.process(module, payload, cfg);
        });

        waitsFor(() => taskexec.emit.callCount > 1, 5000);

        runs(() => {
            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit.calls[0].args[0]).toEqual('data');
            expect(taskexec.emit.calls[1].args[0]).toEqual('end');
        });
    });

    it('Should reject if module is missing', () => {
        var taskexec = new TaskExec();
        //eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        spyOn(taskexec, 'emit').andCallThrough();

        runs(() => {
            taskexec.process({}, payload, cfg);
        });

        waitsFor(() => taskexec.emit.callCount > 1, 5000);

        runs(() => {
            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit.calls[0].args[0]).toEqual('error');
            expect(taskexec.emit.calls[0].args[1].message).toEqual('Process function is not found');
            expect(taskexec.emit.calls[1].args[0]).toEqual('end');
        });
    });

    it('Should execute rebound_trigger and emit all events - rebound, end', () => {
        var taskexec = new TaskExec();
        //eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        spyOn(taskexec, 'emit').andCallThrough();

        var module = require('./component/triggers/rebound_trigger.js');

        runs(() => {
            taskexec.process(module, payload, cfg);
        });

        waitsFor(() => taskexec.emit.callCount > 1, 5000);

        runs(() => {
            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit.calls[0].args[0]).toEqual('rebound');
            expect(taskexec.emit.calls[1].args[0]).toEqual('end');
        });
    });

    it('Should execute complex trigger, and emit all 6 events', () => {
        var taskexec = new TaskExec();
        //eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        spyOn(taskexec, 'emit').andCallThrough();

        var module = require('./component/triggers/datas_and_errors.js');

        runs(() => {
            taskexec.process(module, payload, cfg);
        });

        waitsFor(() => taskexec.emit.callCount >= 5);

        runs(() => {
            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit.callCount).toEqual(5);
            expect(taskexec.emit.calls[0].args[0]).toEqual('data');
            expect(taskexec.emit.calls[0].args[1]).toEqual({ content: 'Data 1' });
            expect(taskexec.emit.calls[1].args[0]).toEqual('error');
            expect(taskexec.emit.calls[1].args[1].message).toEqual('Error 1');
            expect(taskexec.emit.calls[2].args[0]).toEqual('data');
            expect(taskexec.emit.calls[2].args[1]).toEqual({ content: 'Data 2' });
            expect(taskexec.emit.calls[3].args[0]).toEqual('error');
            expect(taskexec.emit.calls[3].args[1].message).toEqual('Error 2');
            expect(taskexec.emit.calls[4].args[0]).toEqual('data');
            expect(taskexec.emit.calls[4].args[1]).toEqual({ content: 'Data 3' });
        });
    });

    it('Should execute test_trigger and emit all events - 3 data events, 3 errors, 3 rebounds, 1 end', () => {
        var taskexec = new TaskExec();
        //eslint-disable-next-line no-empty-function
        taskexec.on('error', () => {});
        spyOn(taskexec, 'emit').andCallThrough();

        var module = require('./component/triggers/test_trigger.js');
        taskexec.process(module, payload, cfg);

        waitsFor(() => taskexec.emit.callCount >= 9, 5000);

        runs(() => {

            expect(taskexec.emit).toHaveBeenCalled();

            var calls = taskexec.emit.calls;

            expect(calls[0].args).toEqual(['data', 'Data 1']);
            expect(calls[1].args).toEqual(['data', { content: 'Data 2' }]);
            expect(calls[2].args).toEqual(['data']);

            expect(calls[3].args).toEqual(['error', 'Error 1']);
            expect(calls[4].args).toEqual(['error', {}]);
            expect(calls[5].args).toEqual(['error']);

            expect(calls[6].args).toEqual(['rebound', 'Rebound Error 1']);
            expect(calls[7].args).toEqual(['rebound', {}]);
            expect(calls[8].args).toEqual(['rebound']);

            expect(calls[9].args[0]).toEqual('end');
        });
    });


    describe('Promises', () => {

        it('Should execute a Promise trigger and emit all events - data, end', () => {
            var taskexec = new TaskExec();

            //eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            spyOn(taskexec, 'emit').andCallThrough();

            var module = require('./component/triggers/promise_trigger.js');

            runs(() => {
                taskexec.process(module, payload, cfg);
            });

            waitsFor(() => taskexec.emit.callCount > 1, 5000);

            runs(() => {
                expect(taskexec.emit).toHaveBeenCalled();
                expect(taskexec.emit.callCount).toEqual(2);
                expect(taskexec.emit.calls[0].args[0]).toEqual('data');
                expect(taskexec.emit.calls[0].args[1]).toEqual({
                    body: 'I am a simple promise'
                });
                expect(taskexec.emit.calls[1].args[0]).toEqual('end');
            });
        });

        it('Should execute a Promise.resolve() trigger and emit end', () => {
            var taskexec = new TaskExec();

            //eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            spyOn(taskexec, 'emit').andCallThrough();

            var module = require('./component/triggers/promise_resolve_no_data.js');

            runs(() => {
                taskexec.process(module, payload, cfg);
            });

            waitsFor(() => taskexec.emit.callCount > 0, 5000);

            runs(() => {
                expect(taskexec.emit).toHaveBeenCalled();
                expect(taskexec.emit.callCount).toEqual(1);
                expect(taskexec.emit.calls[0].args[0]).toEqual('end');
            });
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

        it('Should execute a Promise trigger and emit all events - data, end', () => {


            var taskexec = new TaskExec();

            //eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            spyOn(taskexec, 'emit').andCallThrough();

            var module = require('./component/triggers/promise_request_trigger.js');

            runs(() => {
                taskexec.process(module, payload, cfg);
            });

            waitsFor(() => taskexec.emit.callCount > 1, 5000);

            runs(() => {
                expect(taskexec.emit).toHaveBeenCalled();
                expect(taskexec.emit.callCount).toEqual(2);
                expect(taskexec.emit.calls[0].args[0]).toEqual('data');
                expect(taskexec.emit.calls[0].args[1]).toEqual({
                    body: {
                        message: 'Life is good with promises'
                    }
                });
                expect(taskexec.emit.calls[1].args[0]).toEqual('end');
            });
        });
    });

    describe('Request Generators', () => {

        it('Should execute a Promise trigger and emit all events - data, end', () => {

            nock('http://promise_target_url:80')
                .get('/foo/bar')
                .reply(200, {
                    message: 'Life is good with generators'
                });


            var taskexec = new TaskExec();

            //eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            spyOn(taskexec, 'emit').andCallThrough();

            var module = require('./component/triggers/generator_request_trigger.js');

            runs(() => {
                taskexec.process(module, payload, cfg);
            });

            waitsFor(() => taskexec.emit.callCount > 1, 5000);

            runs(() => {
                expect(taskexec.emit).toHaveBeenCalled();
                expect(taskexec.emit.callCount).toEqual(2);
                expect(taskexec.emit.calls[0].args[0]).toEqual('data');
                expect(taskexec.emit.calls[0].args[1]).toEqual({
                    body: {
                        message: 'Life is good with generators'
                    }
                });
                expect(taskexec.emit.calls[1].args[0]).toEqual('end');
            });
        });

        it('Should execute a Promise trigger and emit all events - data, end', () => {

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


            var taskexec = new TaskExec();

            //eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            spyOn(taskexec, 'emit').andCallThrough();

            var module = require('./component/triggers/promise_emitting_events.js');

            runs(() => {
                taskexec.process(module, payload, cfg);
            });

            waitsFor(() => taskexec.emit.callCount > 1, 5000);

            runs(() => {
                expect(taskexec.emit).toHaveBeenCalled();
                expect(taskexec.emit.callCount).toEqual(3);
                expect(taskexec.emit.calls[0].args[0]).toEqual('updateKeys');
                expect(taskexec.emit.calls[0].args[1]).toEqual({
                    oauth: {
                        access_token: 'new_access_token'
                    }
                });
                expect(taskexec.emit.calls[1].args[0]).toEqual('data');
                expect(taskexec.emit.calls[1].args[1]).toEqual({
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
                expect(taskexec.emit.calls[2].args[0]).toEqual('end');
            });
        });
    });

    describe('async process function', () => {
        it('should work', () => {
            const taskexec = new TaskExec();

            //eslint-disable-next-line no-empty-function
            taskexec.on('error', () => {});
            spyOn(taskexec, 'emit').andCallThrough();

            const module = require('./component/triggers/async_process_function');

            runs(() => {
                taskexec.process(module, payload, cfg);
            });

            waitsFor(() => taskexec.emit.callCount > 1);

            runs(() => {
                expect(taskexec.emit).toHaveBeenCalled();
                expect(taskexec.emit.callCount).toEqual(2);
                expect(taskexec.emit.calls[0].args[0]).toEqual('data');
                expect(taskexec.emit.calls[0].args[1]).toEqual({
                    some: 'data'
                });
                expect(taskexec.emit.calls[1].args[0]).toEqual('end');
            });
        });
    });
});
