const EventEmitter = require('events').EventEmitter;
const _ = require('lodash');
const util = require('util');

exports.TaskExec = TaskExec;

function TaskExec () {
    EventEmitter.call(this);
    this.errorCount = 0;
}

util.inherits(TaskExec, EventEmitter);

TaskExec.prototype.process = async function process (triggerOrAction, payload, cfg, snapshot) {
    if (!_.isFunction(triggerOrAction.process)) {
        const e = new Error('Process function is not found');
        console.error(e.stack);
        this.emit('error', e);
        this.emit('end');
    }

    try {
        const data = await triggerOrAction.process.bind(this)(payload, cfg, snapshot);
        if (data) {
            console.log('Process function is a Promise/generator/etc');
            this.emit('data', data);
        }

        this.emit('end');
    } catch (e) {
        console.error(e.stack);
        this.emit('error', e);
        this.emit('end');
    }
};
