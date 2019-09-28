const ComponentReader = require('./component_reader.js').ComponentReader;
const TaskExec = require('./executor.js').TaskExec;
const _ = require('lodash');
const hooksData = require('./hooksData');
const RestApiClient = require('elasticio-rest-node');
const assert = require('assert');
const uuid = require('uuid');

const AMQP_HEADER_META_PREFIX = 'x-eio-meta-';
const { MessageLevelLogger } = require('./logging.js');
// FIXME tests
class Semaphor {
    constructor() {
        this._counter = 0;
        this._waiters = [];
    }
    inc() {
        this._counter++;
    }
    dec() {
        this._counter > 0 && this._counter--;
        this._notifyWaiters();
    }
    _notifyWaiters() {
        if (this._counter === 0) {
            this._waiters.forEach(([resolve, timer]) => {
                clearTimeout(timer);
                resolve();
            });
            this._waiters = [];
        }
    }
    async waitForFree(timeout = 30 * 1000) {
        return new Promise((resolve, reject) => {
            const pair = [
                resolve,
                setTimeout(() => {
                    const waiterIndex = this._waiters.indexOf(pair);
                    if (this._waitersIndex >= -1) {
                        this._waiters.splice(waiterIndex, 1);
                    }
                    reject(new Error('timeout'));
                }, timeout)
            ];
            this._waiters.push(pair);
            this._notifyWaiters();
        });
    }
}

/**
 * API_USERNAME
 * API_KEY
 * API_URI
 * API_REQUEST_RETRY_ATTEMPTS
 * API_REQUEST_RETRY_DELAY
 *
 * FLOW_ID
 * STEP_ID
 * USER_ID
 * CONTAINER_ID
 * WORKSPACE_ID
 * EXEC_ID
 * COMP_ID
 * FUNCTION
 *
 * COMPONENT_PATH
 * TIMEOUT
 */
class Sailor {
    constructor(communicationLayer, settings, logger) {
        this._logger = logger;
        this.settings = settings;
        this.messagesCount = 0;
        this._communicationLayer = communicationLayer;
        this.componentReader = new ComponentReader(this._logger);
        this.snapshot = {};
        this.stepData = null;
        // eslint-disable-next-line new-cap
        this._apiClient = RestApiClient(
            settings.API_USERNAME,
            settings.API_KEY,
            {
                retryCount: settings.API_REQUEST_RETRY_ATTEMPTS,
                retryDelay: settings.API_REQUEST_RETRY_DELAY
            }
        );
        this._busySemaphor = new Semaphor();
    }

    async prepare() {
        const {
            settings: {
                COMPONENT_PATH: compPath,
                FLOW_ID: flowId,
                STEP_ID: stepId
            },
            componentReader
        } = this;
        // FIXME piece of shit
        if (!this.stepData) {
            const stepData = await this._apiClient.tasks.retrieveStep(flowId, stepId);
            this.stepData = stepData;
            this.snapshot = stepData.snapshot || {};
        } else {
            this.snapshot = this.stepData.snapshot || {};
        }
        this._logger.debug('Received step data: %j', this.stepData);
        await componentReader.init(compPath);
    }

    reportError(err) {
        const headers = {
            execId: this.settings.EXEC_ID,
            taskId: this.settings.FLOW_ID,
            workspaceId: this.settings.WORKSPACE_ID,
            containerId: this.settings.CONTAINER_ID,
            userId: this.settings.USER_ID,
            stepId: this.settings.STEP_ID,
            compId: this.settings.COMP_ID,
            function: this.settings.FUNCTION
        };
        const props = createDefaultAmqpProperties(headers);
        this._communicationLayer.sendError(err, props);
    }

    async startup() {
        this._logger.debug('Starting up component');
        const result = await this._invokeModuleFunction('startup');
        this._logger.trace('Startup data', { result });
        const handle = hooksData.startup(this.settings);
        try {
            const state = _.isEmpty(result) ? {} : result;
            await handle.create(state);
        } catch (e) {
            if (e.statusCode === 409) {
                this._logger.warn('Startup data already exists. Rewriting.');
                await handle.delete();
                await handle.create(result);
            } else {
                this._logger.warn('Component starting error');
                throw e;
            }
        }
        this._logger.debug('Component started up');
        return result;
    }

    async shutdown() {
        this._logger.debug('About to shut down');
        const handle = hooksData.startup(this.settings);
        const state = await handle.retrieve();
        await this._invokeModuleFunction('shutdown', state);
        await handle.delete();
        this._logger.debug('Shut down successfully');
    }

    async init() {
        this._logger.debug('About to initialize component for execution');
        const res = await this._invokeModuleFunction('init');
        this._logger.debug('Component execution initialized successfully');
        return res;
    }

    async _invokeModuleFunction(moduleFunction, data) {
        const stepData = this.stepData;
        const module = await this.componentReader.loadTriggerOrAction(this.settings.FUNCTION);
        if (!module[moduleFunction]) {
            this._logger.warn(`invokeModuleFunction – ${moduleFunction} is not found`);
            return;
        }
        const cfg = _.cloneDeep(stepData.config) || {};
        return new Promise((resolve, reject) => {
            try {
                resolve(module[moduleFunction](cfg, data));
            } catch (e) {
                reject(e);
            }
        });
    }

    async run() {
        // FIXME that's sailor "ACTIVE" mode
        // probably this should be moved to upper layers
        const processMessage = this.processMessage.bind(this);
        this._communicationLayer.listenQueue(processMessage);
    }
    // FIXME tests
    async stop() {
        await this._communicationLayer.unlistenQueue();
        await this.waitFinishProcessing();
    }
    // FIXME tests
    async waitFinishProcessing() {
        return this._busySemaphor.waitForFree();
    }

    _readIncomingMessageHeaders(message) {
        const { headers } = message.properties;

        assert(headers.execId, 'ExecId is missing in message header');
        assert(headers.taskId, 'TaskId is missing in message header');
        assert(headers.userId, 'UserId is missing in message header');
        assert(headers.taskId === this.settings.FLOW_ID, 'Message with wrong taskID arrived to the sailor');

        const metaHeaderNames = Object.keys(headers)
            .filter(key => key.toLowerCase().startsWith(AMQP_HEADER_META_PREFIX));

        const metaHeaders = _.pick(headers, metaHeaderNames);
        const metaHeadersLowerCased = _.mapKeys(metaHeaders, (value, key) => key.toLowerCase());

        let result = _.pick(headers, ['taskId', 'execId', 'workspaceId', 'containerId', 'userId', 'stepId', 'compId']);
        result = _.extend(result, metaHeadersLowerCased);

        result.threadId = headers.threadId || headers['x-eio-meta-trace-id'];

        if (headers.messageId) {
            result.parentMessageId = headers.messageId;
        }

        if (headers.reply_to) {
            result.reply_to = headers.reply_to;
        }

        return result;
    }

    async processMessage(payload, message) {
        try {
            const { headers } = message.properties;
            const messageLogger = new MessageLevelLogger(
                this.settings,
                {
                    threadId: headers.threadId || headers['x-eio-meta-trace-id'] || 'unknown',
                    messageId: headers.messageId || 'unknown',
                    parentMessageId: headers.parentMessageId || 'unknown'
                },
                false
            );
            this._busySemaphor.inc();
            await this._processMessage(payload, message, messageLogger);
        } catch (e) {
            this._logger.error(e, 'Failed to process message');
            throw e;
        } finally {
            this._busySemaphor.dec();
        }
    }

    async _processMessage(payload, message, logger) {
        // eslint-disable-next-line consistent-this
        const self = this;
        const settings = this.settings;
        let incomingMessageHeaders;
        const origPassthrough = _.cloneDeep(payload.passthrough) || {};

        this.messagesCount += 1;

        const timeStart = Date.now();

        const { deliveryTag } = message.fields;

        logger.trace({
            messagesCount: this.messagesCount,
            messageProcessingTime: Date.now() - timeStart
        }, 'processMessage received');

        try {
            incomingMessageHeaders = this._readIncomingMessageHeaders(message);
        } catch (err) {
            logger.error(err, 'Invalid message headers');
            return this._communicationLayer.reject(message);
        }

        const stepData = this.stepData;
        if (!stepData) {
            logger.warn('Invalid trigger or action specification %j', stepData);
            return this._communicationLayer.reject(message);
        }
        const cfg = _.cloneDeep(stepData.config) || {};
        const snapshot = _.cloneDeep(this.snapshot);

        logger.debug('Trigger or action: %s', settings.FUNCTION);

        let outgoingMessageHeaders = _.clone(incomingMessageHeaders);

        outgoingMessageHeaders = _.extend(outgoingMessageHeaders, {
            execId: settings.EXEC_ID,
            taskId: settings.FLOW_ID,
            workspaceId: settings.WORKSPACE_ID,
            containerId: settings.CONTAINER_ID,
            userId: settings.USER_ID,
            stepId: settings.STEP_ID,
            compId: settings.COMP_ID,
            function: settings.FUNCTION,
            start: new Date().getTime(),
            // TODO in ideal world this should be filled by communication layer
            cid: this._communicationLayer.getEncryptionId()
        });
        try {
            const module = await this.componentReader.loadTriggerOrAction(this.settings.FUNCTION);
            return processMessageWithModule(module);
        } catch (err) {
            logger.error(err);
            outgoingMessageHeaders.end = new Date().getTime();
            await this._communicationLayer.sendError(err, outgoingMessageHeaders, message.content);
            await this._communicationLayer.reject(message);
        }

        function processMessageWithModule(module) {
            return new Promise((resolve) => {
                const executionTimeout = setTimeout(onTimeout, self.settings.TIMEOUT);
                let endWasEmitted;

                function onTimeout() {
                    logger.trace({
                        messagesCount: self.messagesCount,
                        messageProcessingTime: Date.now() - timeStart
                    }, 'processMessage timeout');
                    return onEnd();
                }

                const { headers } = message.properties;
                const clientCodeLogger = new MessageLevelLogger(
                    self.settings,
                    {
                        threadId: headers.threadId || headers['x-eio-meta-trace-id'] || 'unknown',
                        messageId: headers.messageId || 'unknown',
                        parentMessageId: headers.parentMessageId || 'unknown'
                    },
                    true
                );

                const taskExec = new TaskExec({ variables: stepData.variables }, clientCodeLogger);

                taskExec
                    .on('data', onData)
                    .on('error', onError)
                    .on('rebound', onRebound)
                    .on('snapshot', onSnapshot)
                    .on('updateSnapshot', onUpdateSnapshot)
                    .on('updateKeys', onUpdateKeys)
                    .on('httpReply', onHttpReply)
                    .on('end', onEnd);

                taskExec.process(module, payload, cfg, snapshot);

                async function onData(data) {
                    const headers = _.clone(outgoingMessageHeaders);
                    logger.trace({
                        messagesCount: self.messagesCount,
                        messageProcessingTime: Date.now() - timeStart
                    }, 'processMessage emit data');

                    headers.end = new Date().getTime();
                    const props = createAmqpProperties(headers, data.id);

                    if (stepData.is_passthrough === true) {
                        const passthrough = Object.assign({}, _.omit(data, 'passthrough'));

                        data.passthrough = Object.assign({}, origPassthrough, {
                            [self.settings.STEP_ID]: passthrough
                        });
                    }

                    return self._communicationLayer.sendData(data, props);
                }

                async function onHttpReply(reply) {
                    const headers = _.clone(outgoingMessageHeaders);
                    const props = createAmqpProperties(headers);
                    logger.trace({
                        messageProcessingTime: Date.now() - timeStart
                    }, 'processMessage emit HttpReply');

                    return self._communicationLayer.sendHttpReply(reply, props);
                }

                async function onError(err) {
                    const headers = _.clone(outgoingMessageHeaders);
                    err = formatError(err);
                    taskExec.errorCount++;
                    logger.trace({
                        err,
                        messagesCount: self.messagesCount,
                        messageProcessingTime: Date.now() - timeStart
                    }, 'processMessage emit error');
                    headers.end = new Date().getTime();
                    const props = createAmqpProperties(headers);
                    return self._communicationLayer.sendError(err, props, message.content);
                }

                async function onRebound(err) {
                    const headers = _.clone(outgoingMessageHeaders);
                    err = formatError(err);
                    logger.trace({
                        err,
                        messagesCount: self.messagesCount,
                        messageProcessingTime: Date.now() - timeStart
                    }, 'processMessage emit rebound');
                    headers.end = new Date().getTime();
                    headers.reboundReason = err.message;
                    const props = createAmqpProperties(headers);
                    return self._communicationLayer.sendRebound(err, message, props);
                }

                async function onSnapshot(data) {
                    const headers = _.clone(outgoingMessageHeaders);
                    headers.snapshotEvent = 'snapshot';
                    self.snapshot = data; // replacing `local` snapshot
                    const props = createAmqpProperties(headers);
                    return self._communicationLayer.sendSnapshot(data, props);
                }

                async function onUpdateSnapshot(data) {
                    const headers = _.clone(outgoingMessageHeaders);
                    headers.snapshotEvent = 'updateSnapshot';

                    if (_.isPlainObject(data)) {
                        if (data.$set) {
                            return logger.warn('ERROR: $set is not supported any more in `updateSnapshot` event');
                        }
                        _.extend(self.snapshot, data); // updating `local` snapshot
                        const props = createAmqpProperties(headers);
                        return self._communicationLayer.sendSnapshot(data, props);
                    } else {
                        logger.error('You should pass an object to the `updateSnapshot` event');
                    }
                }

                async function onUpdateKeys(keys) {
                    logger.trace({
                        messageProcessingTime: Date.now() - timeStart
                    }, 'processMessage emit updateKeys');

                    try {
                        await self._apiClient.accounts.update(cfg._account, { keys: keys });
                        logger.debug('Successfully updated keys #%s', deliveryTag);
                    } catch (error) {
                        logger.error('Failed to updated keys #%s', deliveryTag);
                        await onError(error);
                    }
                }

                function onEnd() {
                    if (endWasEmitted) {
                        logger.warn({
                            messagesCount: self.messagesCount,
                            errorCount: taskExec.errorCount,
                            messageProcessingTime: Date.now() - timeStart
                        }, 'processMessage emit end was called more than once');
                        return;
                    }

                    endWasEmitted = true;

                    clearTimeout(executionTimeout);

                    if (taskExec.errorCount > 0) {
                        self._communicationLayer.reject(message);
                    } else {
                        self._communicationLayer.ack(message);
                    }
                    self.messagesCount -= 1;
                    logger.trace({
                        messagesCount: self.messagesCount,
                        errorCount: taskExec.errorCount,
                        messageProcessingTime: Date.now() - timeStart
                    }, 'processMessage emit end');

                    resolve();
                }
            });
        }

        function formatError(err) {
            if (err instanceof Error || (_.isObject(err) && _.has(err, 'message'))) {
                return {
                    message: err.message,
                    stack: err.stack || 'Not Available',
                    name: err.name || 'Error'
                };
            } else {
                return {
                    message: err || 'Not Available',
                    stack: 'Not Available',
                    name: 'Error'
                };
            }
        }

        function createAmqpProperties(headers, messageId) {
            headers.messageId = messageId || uuid.v4();

            return createDefaultAmqpProperties(headers);
        }
    }
}

function createDefaultAmqpProperties(headers) {
    const result = {
        contentType: 'application/json',
        contentEncoding: 'utf8',
        mandatory: true,
        headers: headers
    };

    return result;
}

module.exports = Sailor;
