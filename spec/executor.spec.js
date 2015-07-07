describe('Executor', function () {

    var TaskExec = require('../lib/executor.js').TaskExec;
    var payload = {content: "MessageContent"};
    var cfg = {};

    it('Should execute passthrough trigger and emit all events - data, end', function () {
        var taskexec = new TaskExec();

        taskexec.on('error', function(){});
        spyOn(taskexec, 'emit').andCallThrough();

        var module = require('./component/triggers/passthrough.js');
        taskexec.process(module, payload, cfg);

        expect(taskexec.emit).toHaveBeenCalled();
        expect(taskexec.emit.calls[0].args[0]).toEqual('data');
        expect(taskexec.emit.calls[1].args[0]).toEqual('end');
    });

    it('Should execute action which uses next() callback without error', function () {
        var taskexec = new TaskExec();
        taskexec.on('error', function(){});
        spyOn(taskexec, 'emit').andCallThrough();

        var module = require('./component/actions/next_callback.js');
        taskexec.process(module, payload, cfg, {snapshot: 'data'});

        expect(taskexec.emit).toHaveBeenCalled();
        expect(taskexec.emit.calls[0].args[0]).toEqual('data');
        expect(taskexec.emit.calls[0].args[1]).toEqual({some: 'data'});
        expect(taskexec.emit.calls[1].args[0]).toEqual('snapshot');
        expect(taskexec.emit.calls[1].args[1]).toEqual({snapshot: 'data'});
        expect(taskexec.emit.calls[2].args[0]).toEqual('end');
    });

    it('Should execute action which uses next() callback with error', function () {
        var taskexec = new TaskExec();
        taskexec.on('error', function(){});
        spyOn(taskexec, 'emit').andCallThrough();

        var module = require('./component/actions/next_callback.js');
        taskexec.process(module, {error: true}, cfg, {snapshot: 'data'});

        expect(taskexec.emit).toHaveBeenCalled();
        expect(taskexec.emit.calls[0].args[0]).toEqual('error');
        expect(taskexec.emit.calls[0].args[1].toString()).toMatch('tmp error');
        expect(taskexec.emit.calls[1].args[0]).toEqual('end');
    });

    it('Should reject if module is missing', function () {
        var taskexec = new TaskExec();
        taskexec.on('error', function(){});
        spyOn(taskexec, 'emit').andCallThrough();

        taskexec.process({}, payload, cfg);

        expect(taskexec.emit).toHaveBeenCalled();
        expect(taskexec.emit.calls[0].args[0]).toEqual('error');
        expect(taskexec.emit.calls[0].args[1].message).toEqual('Process function is not found');
        expect(taskexec.emit.calls[1].args[0]).toEqual('end');
    });

    it('Should execute rebound_trigger and emit all events - rebound, end', function () {
        var taskexec = new TaskExec();
        taskexec.on('error', function(){});
        spyOn(taskexec, 'emit').andCallThrough();

        var module = require('./component/triggers/rebound_trigger.js');
        taskexec.process(module, payload, cfg);

        expect(taskexec.emit).toHaveBeenCalled();
        expect(taskexec.emit.calls[0].args[0]).toEqual('rebound');
        expect(taskexec.emit.calls[1].args[0]).toEqual('end');
    });

    it('Should execute complex trigger, and emit all 6 events', function () {
        var taskexec = new TaskExec();
        taskexec.on('error', function(){});
        spyOn(taskexec, 'emit').andCallThrough();

        var module = require('./component/triggers/datas_and_errors.js');

        runs(function(){
            taskexec.process(module, payload, cfg);
        });

        waitsFor(function(){
            return taskexec.emit.callCount === 5;
        });

        runs(function(){
            expect(taskexec.emit).toHaveBeenCalled();
            expect(taskexec.emit.callCount).toEqual(5);
            expect(taskexec.emit.calls[0].args[0]).toEqual('data');
            expect(taskexec.emit.calls[1].args[0]).toEqual('error');
        });
    });

    it('Should execute test_trigger and emit all events - 3 data events, 3 errors, 3 rebounds, 1 end', function () {
        var taskexec = new TaskExec();
        taskexec.on('error', function(){});
        spyOn(taskexec, 'emit').andCallThrough();

        var module = require('./component/triggers/test_trigger.js');
        taskexec.process(module, payload, cfg);

        expect(taskexec.emit).toHaveBeenCalled();

        var calls = taskexec.emit.calls;

        expect(calls[0].args).toEqual(['data', 'Data 1']);
        expect(calls[1].args).toEqual(['data', {content:'Data 2'}]);
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
