const assert = require('assert');
const _ = require('lodash');
const EventEmitter = require('./emitter').EventEmitter;

const { ComponentLogger } = require('./logging');

class TaskExec extends EventEmitter {
    constructor({ loggerOptions, variables, services } = {}) {
        super();
        this.errorCount = 0;
        this.logger = new ComponentLogger(loggerOptions);
        // copy variables to protect from outside changes;
        this._variables = Object.assign({}, variables || {});
        this._services = services;
        assert(this._services, 'TaskExec should be created with services');
        assert(this._services.apiClient, 'TaskExec should be created with api client');
        assert(this._services.config , 'TaskExec should be created with config');
        assert(this._services.amqp, 'TaskExec should be created with ampq');
    }

    process(triggerOrAction, payload, cfg, snapshot) {
        const onError = async (err) => {
            this.logger.error(err);
            await this.emit('error', err);
            await this.emit('end');
        };

        if (!_.isFunction(triggerOrAction.process)) {
            return onError(new Error('Process function is not found'));
        }

        new Promise(resolve => {
            const result = triggerOrAction.process.bind(this)(payload, cfg, snapshot);
            if (result) {
                resolve(result);
            }
        })
            .then(async (data) => {
                if (data) {
                    this.logger.debug('Process function is a Promise/generator/etc');
                    await this.emit('data', data);
                }
                await this.emit('end');
            })
            .catch(onError);
    }

    getApiClient() {
        return this._services.apiClient;
    }

    getConfig() {
        return this._services.config;
    }

    /**
     * Get amqp connection wrapper. Internal.
     * Should be used only or really special cases
     */
    __getAmqp() {
        return this._services.amqp;
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
