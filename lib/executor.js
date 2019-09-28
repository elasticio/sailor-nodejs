const _ = require('lodash');
const EventEmitter = require('./emitter').EventEmitter;

class TaskExec extends EventEmitter {
    constructor({ variables } = {}, logger) {
        super();
        this.errorCount = 0;
        // Notice: logger property is part of interface!!!!!!
        // Do not rename!!!!!
        // TODO probably transform it to getter to make it explicitly visible
        // Or rewrite to typescript :(
        this.logger = logger;
        // copy variables to protect from outside changes;
        this._variables = Object.assign({}, variables || {});
    }

    async process(triggerOrAction, payload, cfg, snapshot) {
        try {
            if (!_.isFunction(triggerOrAction.process)) {
                throw new Error('Process function is not found');
            }
            const possiblyPromise = triggerOrAction.process.bind(this)(payload, cfg, snapshot);
            // Required behavior
            // 1. if trigger or action returns nothing then nothing should be emitted
            // 2. if trigger or action returns promise then end event should be emitted anyway
            // 3. if trigger or action returns non empty promise, then data event should be emitted
            if (possiblyPromise) {
                const data = await possiblyPromise;
                if (data) {
                    this.logger.debug('Process function is a Promise/generator/etc');
                    this.emit('data', data);
                }
                // Notice end should be emitted only in case if data was emitted
                // and not otherwise
                this.emit('end');
            }
        } catch (e) {
            this.logger.error(e);
            this.emit('error', e);
            this.emit('end');
        }
    }

    /**
     * Returns flow variables or empty object
     * @returns {Object<String, String>}
     */
    getFlowVariables() {
        return this._variables;
    }
}

exports.TaskExec = TaskExec;
