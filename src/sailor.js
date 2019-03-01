const _ = require('lodash');
const RestApiClient = require('elasticio-rest-node');
const assert = require('assert');
const uuid = require('uuid');
const ComponentReader = require('./component_reader.js').ComponentReader;
const cipher = require('./cipher.js');
const hooksData = require('./hooksData');
const amqp = require('./amqp.js');
const TaskExec = require('./executor.js').TaskExec;
const log = require('./logging.js');

const TIMEOUT = process.env.ELASTICIO_TIMEOUT || 20 * 60 * 1000; // 20 minutes
const AMQP_HEADER_META_PREFIX = 'x-eio-meta-';
const AMQP_HEADER_TRACE_ID = AMQP_HEADER_META_PREFIX + 'trace-id';

class Sailor {
    constructor (settings) {
        this.settings = settings;
        this.messagesCount = 0;
        this.amqpConnection = new amqp.Amqp(settings);
        this.componentReader = new ComponentReader();
        this.snapshot = {};
        this.stepData = {};
        this.apiClient = RestApiClient(
            settings.API_USERNAME,
            settings.API_KEY,
            {
                retryOnNetworkError: true,
                maxAttempts: settings.API_REQUEST_RETRY_ATTEMPTS,
                retryDelay: settings.API_REQUEST_RETRY_DELAY
            });
    }

    async connect () {
        return this.amqpConnection.connect(this.settings.AMQP_URI);
    }

    async prepare () {
        const {
            settings: {
                COMPONENT_PATH: compPath,
                FLOW_ID: flowId,
                STEP_ID: stepId
            },
            apiClient,
            componentReader
        } = this;

        const stepData = await apiClient.tasks.retrieveStep(flowId, stepId);
        log.debug('Received step data: %j', stepData);

        Object.assign(this, {
            snapshot: stepData.snapshot || {},
            stepData
        });

        this.stepData = stepData;

        return componentReader.init(compPath);
    }

    async disconnect () {
        log.debug('Disconnecting, %s messages in processing', this.messagesCount);

        return this.amqpConnection.disconnect();
    }

    async reportError (err) {
        const headers = {
            execId: process.env.ELASTICIO_EXEC_ID,
            taskId: process.env.ELASTICIO_FLOW_ID,
            userId: process.env.ELASTICIO_USER_ID
        };
        const props = createDefaultAmqpProperties(headers);
        return this.amqpConnection.sendError(err, props);
    }

    async startup () {
        log.info('Starting up component');
        const result = await this.invokeModuleFunction('startup');

        log.debug('Startup data', { result });
        const handle = hooksData.startup(this.settings);

        try {
            const state = _.isEmpty(result) ? {} : result;
            await handle.create(state);
        } catch (e) {
            if (e.statusCode === 409) {
                log.warn('Startup data already exists. Rewriting.');

                await handle.delete();
                await handle.create(result);
            } else {
                log.warn('Component starting error');
                throw e;
            }
        }

        log.info('Component started up');
        return result;
    }

    async shutdown () {
        log.info('About to shut down');

        const handle = hooksData.startup(this.settings);
        const state = await handle.retrieve();
        await this.invokeModuleFunction('shutdown', state);
        await handle.delete();

        log.info('Shut down successfully');
    }

    async init () {
        log.info('About to initialize component for execution');
        const result = await this.invokeModuleFunction('init');
        log.info('Component execution initialized successfully');

        return result;
    }

    async invokeModuleFunction (moduleFunction, data) {
        const settings = this.settings;
        const stepData = this.stepData;
        const module = await this.componentReader.loadTriggerOrAction(settings.FUNCTION);

        if (!module[moduleFunction]) {
            log.error(`invokeModuleFunction – ${moduleFunction} is not found`);
            return Promise.resolve();
        }

        const cfg = _.cloneDeep(stepData.config) || {};
        return module[moduleFunction](cfg, data);
    }

    async run () {
        const incomingQueue = this.settings.LISTEN_MESSAGES_ON;
        const processMessage = this.processMessage.bind(this);
        log.debug('Start listening for messages on %s', incomingQueue);

        return this.amqpConnection.listenQueue(incomingQueue, processMessage);
    }

    readIncomingMessageHeaders (message) {
        const props = message.properties;
        const headers = props.headers;
        const settings = this.settings;

        assert(headers.execId, 'ExecId is missing in message header');
        assert(headers.taskId, 'TaskId is missing in message header');
        assert(headers.userId, 'UserId is missing in message header');
        assert(headers.taskId === settings.FLOW_ID, 'Message with wrong taskID arrived to the sailor');

        const metaHeaderNames = Object.keys(headers).filter(key => key.toLowerCase().startsWith(AMQP_HEADER_META_PREFIX));
        const metaHeaders = _.pick(headers, metaHeaderNames);
        const metaHeadersLowerCased = _.mapKeys(metaHeaders, (value, key) => key.toLowerCase());

        let result = _.pick(headers, ['taskId', 'execId', 'userId']);
        result = _.extend(result, metaHeadersLowerCased);

        if (headers.messageId) {
            result.parentMessageId = headers.messageId;
        }

        if (headers.reply_to) {
            result.reply_to = headers.reply_to;
        }

        return result;
    }

    async processMessage (payload, message) {
        const settings = this.settings;
        let incomingMessageHeaders;
        const origPassthrough = _.cloneDeep(payload.passthrough) || {};

        this.messagesCount += 1;

        const timeStart = Date.now();
        const traceId = message.properties.headers[AMQP_HEADER_TRACE_ID] || 'unknown';
        const messageId = message.properties.headers.messageId || 'unknown';
        const parentMessageId = message.properties.headers.parentMessageId || 'unknown';
        const deliveryTag = message.fields.deliveryTag;
        log.info({
            deliveryTag,
            messageId,
            parentMessageId,
            traceId,
            messagesCount: this.messagesCount,
            messageProcessingTime: Date.now() - timeStart
        }, 'processMessage received');

        try {
            incomingMessageHeaders = this.readIncomingMessageHeaders(message);
        } catch (err) {
            log.error('Invalid message headers:', err.stack);
            return this.amqpConnection.reject(message);
        }

        const stepData = this.stepData;
        if (!stepData) {
            log.warn('Invalid trigger or action specification %j', stepData);
            return this.amqpConnection.reject(message);
        }

        const cfg = _.cloneDeep(stepData.config) || {};
        const snapshot = _.cloneDeep(this.snapshot);

        log.debug('Trigger or action: %s', settings.FUNCTION);

        let outgoingMessageHeaders = _.clone(incomingMessageHeaders);
        outgoingMessageHeaders = _.extend(outgoingMessageHeaders, {
            stepId: settings.STEP_ID,
            compId: settings.COMP_ID,
            function: settings.FUNCTION,
            start: new Date().getTime(),
            cid: cipher.id
        });

        try {
            const module = await this.componentReader.loadTriggerOrAction(settings.FUNCTION);
            return processMessageWithModule.call(this, module);
        } catch (e) {
            await onModuleNotFound.call(this, e);
        }

        async function processMessageWithModule (module) {
            const executionTimeout = setTimeout(onTimeout.bind(this), TIMEOUT);
            const subPromises = [];
            let endWasEmitted;

            function onTimeout () {
                log.info({
                    deliveryTag,
                    messageId,
                    parentMessageId,
                    traceId,
                    messagesCount: this.messagesCount,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage timeout');

                return onEnd.call(this);
            }

            function promise (p) {
                subPromises.push(p);
                return p;
            }

            const taskExec = new TaskExec();
            taskExec
                .on('data', onData.bind(this))
                .on('error', onError.bind(this))
                .on('rebound', onRebound.bind(this))
                .on('snapshot', onSnapshot.bind(this))
                .on('updateSnapshot', onUpdateSnapshot.bind(this))
                .on('updateKeys', onUpdateKeys.bind(this))
                .on('httpReply', onHttpReply.bind(this))
                .on('end', onEnd.bind(this));

            await taskExec.process(module, payload, cfg, snapshot);

            function onData (data) {
                const headers = _.clone(outgoingMessageHeaders);
                log.info({
                    deliveryTag,
                    messageId,
                    parentMessageId,
                    traceId,
                    messagesCount: this.messagesCount,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit data');

                headers.end = new Date().getTime();
                const props = createAmqpProperties(headers, data.id);

                if (stepData.is_passthrough === true) {
                    const passthrough = Object.assign({}, _.omit(data, 'passthrough'));
                    data.passthrough = Object.assign({}, origPassthrough, {
                        [this.settings.STEP_ID]: passthrough
                    });
                }

                return promise(this.amqpConnection.sendData(data, props));
            }

            function onHttpReply (reply) {
                const headers = _.clone(outgoingMessageHeaders);
                const props = createAmqpProperties(headers);
                log.info({
                    deliveryTag,
                    messageId,
                    parentMessageId,
                    traceId,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit HttpReply');

                return promise(this.amqpConnection.sendHttpReply(reply, props));
            }

            function onError (err) {
                const headers = _.clone(outgoingMessageHeaders);
                err = formatError(err);
                taskExec.errorCount++;
                log.info({
                    deliveryTag,
                    messageId,
                    parentMessageId,
                    traceId,
                    messagesCount: this.messagesCount,
                    err,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit error');
                headers.end = new Date().getTime();
                const props = createAmqpProperties(headers);
                return promise(this.amqpConnection.sendError(err, props, message.content));
            }

            function onRebound (err) {
                const headers = _.clone(outgoingMessageHeaders);
                err = formatError(err);
                log.info({
                    deliveryTag,
                    messageId,
                    parentMessageId,
                    traceId,
                    messagesCount: this.messagesCount,
                    err,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit rebound');
                headers.end = new Date().getTime();
                headers.reboundReason = err.message;
                const props = createAmqpProperties(headers);
                return promise(this.amqpConnection.sendRebound(err, message, props));
            }

            function onSnapshot (data) {
                const headers = _.clone(outgoingMessageHeaders);
                headers.snapshotEvent = 'snapshot';
                this.snapshot = data; // replacing `local` snapshot
                const props = createAmqpProperties(headers);
                return promise(this.amqpConnection.sendSnapshot(data, props));
            }

            function onUpdateSnapshot (data) {
                const headers = _.clone(outgoingMessageHeaders);
                headers.snapshotEvent = 'updateSnapshot';

                if (_.isPlainObject(data)) {
                    if (data.$set) {
                        return log.error('ERROR: $set is not supported any more in `updateSnapshot` event');
                    }
                    _.extend(this.snapshot, data); // updating `local` snapshot
                    const props = createAmqpProperties(headers);
                    return promise(this.amqpConnection.sendSnapshot(data, props));
                } else {
                    log.error('You should pass an object to the `updateSnapshot` event');
                }
            }

            function onUpdateKeys (keys) {
                log.info({
                    deliveryTag,
                    messageId,
                    parentMessageId,
                    traceId,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit updateKeys');

                return promise(this.apiClient.accounts.update(cfg._account, { keys: keys })
                    .then(onKeysUpdateSuccess.bind(this))
                    .catch(onKeysUpdateError.bind(this)));

                function onKeysUpdateSuccess () {
                    log.debug('Successfully updated keys #%s', message.fields.deliveryTag);
                }

                function onKeysUpdateError (err) {
                    log.error('Failed to updated keys #%s', message.fields.deliveryTag);
                    return onError.call(this, err);
                }
            }

            async function onEnd () {
                if (endWasEmitted) {
                    log.warn({
                        deliveryTag,
                        messageId,
                        parentMessageId,
                        traceId,
                        messagesCount: this.messagesCount,
                        errorCount: taskExec.errorCount,
                        promises: subPromises.length,
                        messageProcessingTime: Date.now() - timeStart
                    }, 'processMessage emit end was called more than once');
                    log.error('WARNING: End was emitted more than once!');
                    return;
                }

                endWasEmitted = true;

                clearTimeout(executionTimeout);

                if (taskExec.errorCount > 0) {
                    this.amqpConnection.reject(message);
                } else {
                    this.amqpConnection.ack(message);
                }
                this.messagesCount -= 1;
                log.info({
                    deliveryTag,
                    messageId,
                    parentMessageId,
                    traceId,
                    messagesCount: this.messagesCount,
                    errorCount: taskExec.errorCount,
                    promises: subPromises.length,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit end');
            }

            return Promise.all(subPromises);
        }

        async function onModuleNotFound (err) {
            log.error(err.stack);
            outgoingMessageHeaders.end = new Date().getTime();
            await this.amqpConnection.sendError(err, outgoingMessageHeaders, message.content);
            await this.amqpConnection.reject(message);
        }

        function formatError (err) {
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

        function createAmqpProperties (headers, messageId) {
            headers.messageId = messageId || uuid.v4();

            return createDefaultAmqpProperties(headers);
        }
    }
}

function createDefaultAmqpProperties (headers) {
    const result = {
        contentType: 'application/json',
        contentEncoding: 'utf8',
        mandatory: true,
        headers: headers
    };

    return result;
}

exports.Sailor = Sailor;
