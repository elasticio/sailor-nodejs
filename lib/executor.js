const _ = require('lodash');
const util = require('util');
const selfAddressed = require('self-addressed');
const EventEmitter = require('./emitter').EventEmitter;
const log = require('./logging');

function LoggerProxy(logger) {
    for (let type of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
        this[type] = function log() {
            const args = Array.prototype.slice.call(arguments);

            if (args.length && typeof args[0] !== 'string') {
                args[0] = String(args[0]);
            }

            return logger[type](...args);
        };
    }
}

exports.TaskExec = TaskExec;

function TaskExec({ loggerOptions } = {}) {
    EventEmitter.call(this);
    this.errorCount = 0;
    this.logger = new LoggerProxy(log.child(loggerOptions || {}));
}

util.inherits(TaskExec, EventEmitter);

TaskExec.prototype.process = function process(triggerOrAction, payload, cfg, snapshot) {
    //eslint-disable-next-line consistent-this
    const self = this;

    if (!_.isFunction(triggerOrAction.process)) {
        return onError(new Error('Process function is not found'));
    }

    new Promise((resolve, reject) => {
        const result = triggerOrAction.process.bind(self)(payload, cfg, snapshot);
        if (result) {
            resolve(result);
        }
    })
        .then(onPromisedData)
        .catch(onError);

    function onPromisedData(data) {
        if (data) {
            log.debug('Process function is a Promise/generator/etc');
            self.emit('data', data);
        }
        self.emit('end');
    }

    function onError(err) {
        log.error(err);
        self.emit('error', err);
        self.emit('end');
    }
};

const _emit = TaskExec.prototype.emit;

TaskExec.emit = (name, data) => {
    function mailman(address, envelope) {
        _emit.call(address, name, envelope);
    }
    return selfAddressed(mailman, this, data); // returns a promise
};

const _on = TaskExec.prototype.on;

TaskExec.on = (name, fn) => {
    function onSelfAddressedEnvelope(envelope) {
        if (selfAddressed.is(envelope)) {
            var result = fn();
            selfAddressed(envelope, result);
            envelope.replies = 1;
            selfAddressed(envelope);
        }
    }
    _on.call(this, name, onSelfAddressedEnvelope);
};
