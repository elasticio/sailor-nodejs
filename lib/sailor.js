const uuid = require('uuid');
const ComponentReader = require('./component_reader.js').ComponentReader;
const amqp = require('./amqp.js');
const TaskExec = require('./executor.js').TaskExec;
const log = require('./logging.js');
const _ = require('lodash');
const hooksData = require('./hooksData');
const Encryptor = require('../lib/encryptor');
const RestApiClient = require('elasticio-rest-node');
const assert = require('assert');
const co = require('co');
const pThrottle = require('p-throttle');
const { ObjectStorage } = require('@elastic.io/maester-client');
const { Readable } = require('stream');

const AMQP_HEADER_META_PREFIX = 'x-eio-meta-';
const OBJECT_ID_HEADER = 'x-ipaas-object-storage-id';

function convertSettingsToCamelCase(settings) {
    return _.mapKeys(settings, (value, key) => _.camelCase(key));
}

function getAdditionalHeadersFromSettings(settings) {
    return convertSettingsToCamelCase(settings.additionalVars);
}

class Sailor {
    static get OBJECT_ID_HEADER() {
        return OBJECT_ID_HEADER;
    }
    constructor(settings) {
        this.settings = settings;
        this.messagesCount = 0;
        this.amqpConnection = new amqp.Amqp(settings);
        this.componentReader = new ComponentReader();
        this.snapshot = {};
        this.stepData = {};
        this.shutdownCallback = null;
        //eslint-disable-next-line new-cap
        this.apiClient = RestApiClient(
            settings.API_USERNAME,
            settings.API_KEY,
            {
                retryCount: settings.API_REQUEST_RETRY_ATTEMPTS,
                retryDelay: settings.API_REQUEST_RETRY_DELAY
            });

        const objectStorage = new ObjectStorage({
            uri: settings.OBJECT_STORAGE_URI,
            jwtSecret: settings.OBJECT_STORAGE_TOKEN
        });

        const encryptor = new Encryptor(settings.MESSAGE_CRYPTO_PASSWORD, settings.MESSAGE_CRYPTO_IV);
        this.objectStorage = objectStorage.use(
            () => encryptor.createCipher(),
            () => encryptor.createDecipher()
        );

        this.throttles = {
            // 100 Messages per Second
            data: pThrottle(() => Promise.resolve(true),
                settings.DATA_RATE_LIMIT,
                settings.RATE_INTERVAL),
            error: pThrottle(() => Promise.resolve(true),
                settings.ERROR_RATE_LIMIT,
                settings.RATE_INTERVAL),
            snapshot: pThrottle(() => Promise.resolve(true),
                settings.SNAPSHOT_RATE_LIMIT,
                settings.RATE_INTERVAL)
        };
    }

    async connect() {
        return this.amqpConnection.connect(this.settings.AMQP_URI);
    }

    async prepare() {
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
        log.debug('Received step data');
        assert(stepData);

        Object.assign(this, {
            snapshot: stepData.snapshot || {},
            stepData
        });

        this.stepData = stepData;

        await componentReader.init(compPath);
    }

    async disconnect() {
        log.debug('Disconnecting, %s messages in processing', this.messagesCount);
        return this.amqpConnection.disconnect();
    }

    reportError(err) {
        const headers = Object.assign({}, getAdditionalHeadersFromSettings(this.settings), {
            execId: this.settings.EXEC_ID,
            taskId: this.settings.FLOW_ID,
            workspaceId: this.settings.WORKSPACE_ID,
            containerId: this.settings.CONTAINER_ID,
            userId: this.settings.USER_ID,
            stepId: this.settings.STEP_ID,
            compId: this.settings.COMP_ID,
            function: this.settings.FUNCTION
        });
        return this.amqpConnection.sendError(err, headers);
    }

    startup() {
        return co(function* doStartup() {
            log.debug('Starting up component');
            const result = yield this.invokeModuleFunction('startup');
            log.trace('Startup data received');
            const handle = hooksData.startup(this.settings);
            try {
                const state = _.isEmpty(result) ? {} : result;
                yield handle.create(state);
            } catch (e) {
                if (e.statusCode === 409) {
                    log.warn('Startup data already exists. Rewriting.');
                    yield handle.delete();
                    yield handle.create(result);
                } else {
                    log.warn('Component starting error');
                    throw e;
                }
            }
            log.debug('Component started up');
            return result;
        }.bind(this));
    }

    runHookShutdown() {
        return co(function* doShutdown() {
            log.debug('About to shut down');
            const handle = hooksData.startup(this.settings);
            const state = yield handle.retrieve();
            yield this.invokeModuleFunction('shutdown', state);
            yield handle.delete();
            log.debug('Shut down successfully');
        }.bind(this));
    }

    runHookInit() {
        return co(function* doInit() {
            log.debug('About to initialize component for execution');
            const res = yield this.invokeModuleFunction('init');
            log.debug('Component execution initialized successfully');
            return res;
        }.bind(this));
    }

    invokeModuleFunction(moduleFunction, data) {
        const settings = this.settings;
        const stepData = this.stepData;
        return co(function* gen() {
            const module = yield this.componentReader.loadTriggerOrAction(settings.FUNCTION);
            if (!module[moduleFunction]) {
                log.warn(`invokeModuleFunction – ${moduleFunction} is not found`);
                return Promise.resolve();
            }
            const cfg = _.cloneDeep(stepData.config) || {};
            return new Promise((resolve, reject) => {
                try {
                    resolve(module[moduleFunction](cfg, data));
                } catch (e) {
                    reject(e);
                }
            });
        }.bind(this));
    }

    run() {
        const incomingQueue = this.settings.LISTEN_MESSAGES_ON;
        const handler = this.processMessageAndMaybeShutdownCallback.bind(this);
        log.debug('Start listening for messages on %s', incomingQueue);
        return this.amqpConnection.listenQueue(incomingQueue, handler);
    }

    async processMessageAndMaybeShutdownCallback(payload, message) {
        try {
            return await this.processMessage(payload, message);
        } catch (e) {
            log.error('Something very bad happened during message processing');
        } finally {
            if (this.shutdownCallback) {
                if (this.messagesCount === 0) {
                    // there is no another processMessage invocation, so it's time to call shutdownCallback
                    log.debug('About to invoke shutdownCallback');
                    this.shutdownCallback();
                    this.shutdownCallback = null;
                } else {
                    // there is another not finished processMessage invocation
                    log.debug('No shutdownCallback since messagesCount is not zero');
                }
            }
        }
    }

    async scheduleShutdown() {
        if (this.shutdownCallback) {
            log.debug('scheduleShutdown – shutdown is already scheduled, do nothing');
            return new Promise(resolve => this.shutdownCallback = resolve);
        }

        await this.amqpConnection.stopConsume();
        if (this.messagesCount === 0) {
            // there is no unfinished processMessage invocation, let's just resolve scheduleShutdown now
            log.debug('scheduleShutdown – about to shutdown immediately');
            return Promise.resolve();
        }
        // at least one processMessage invocation is not finished yet
        // let's return a Promise, which will be resolved by processMessageAndMaybeShutdownCallback
        log.debug('scheduleShutdown – shutdown is scheduled');
        return new Promise(resolve => this.shutdownCallback = resolve);
    }


    readIncomingMessageHeaders(message) {
        const { headers } = message.properties;

        // Get meta headers
        const metaHeaderNames = Object.keys(headers)
            .filter(key => key.toLowerCase().startsWith(AMQP_HEADER_META_PREFIX));

        const metaHeaders = _.pick(headers, metaHeaderNames);
        const metaHeadersLowerCased = _.mapKeys(metaHeaders, (value, key) => key.toLowerCase());

        const result = {
            stepId: headers.stepId, // the only use is passthrough mechanism
            ...metaHeadersLowerCased,
            threadId: headers.threadId || metaHeadersLowerCased['x-eio-meta-trace-id'],
            messageId: headers.messageId,
            parentMessageId: headers.parentMessageId
        };
        if (!result.threadId) {
            const threadId = uuid.v4();
            log.debug({ threadId }, 'Initiate new thread as it is not started ATM');
            result.threadId = threadId;
        }
        if (headers.reply_to) {
            result.reply_to = headers.reply_to;
        }
        return result;
    }

    async fetchMessageBody(message, logger) {
        const { body, headers } = message;

        logger.info('Checking if incoming messages is lightweight...');

        if (!headers) {
            logger.info('Empty headers so not lightweight.');
            return body;
        }

        const { [OBJECT_ID_HEADER]: objectId } = headers;

        if (!objectId) {
            logger.trace('No object id header so not lightweight.');
            return body;
        }

        logger.info('Object id header found, message is lightweight.', { objectId });

        let object;

        logger.info('Going to fetch message body.', { objectId });

        try {
            object = await this.objectStorage.getOne(
                objectId,
                { jwtPayloadOrToken: this.settings.OBJECT_STORAGE_TOKEN }
            );
        } catch (e) {
            log.error(e);
            throw new Error(`Failed to get message body with id=${objectId}`);
        }

        logger.info('Successfully obtained message body.', { objectId });
        logger.trace('Message body object received');

        return object.data;
    }

    uploadMessageBody(bodyBuf) {
        const stream = () => Readable.from(bodyBuf);
        return this.objectStorage.add(
            stream,
            { jwtPayloadOrToken: this.settings.OBJECT_STORAGE_TOKEN }
        );
    }

    async runExec(module, payload, message, outgoingMessageHeaders, stepData, timeStart, logger) {
        const origPassthrough = _.cloneDeep(payload.passthrough) || {};
        const incomingMessageHeaders = this.readIncomingMessageHeaders(message);
        const settings = this.settings;
        const cfg = _.cloneDeep(stepData.config) || {};
        const snapshot = _.cloneDeep(this.snapshot);
        const { deliveryTag } = message.fields;

        const that = this;

        await new Promise(resolve => {
            let endWasEmitted;


            const taskExec = new TaskExec({
                loggerOptions: _.pick(incomingMessageHeaders, ['threadId', 'messageId', 'parentMessageId']),
                variables: stepData.variables,
                services: {
                    apiClient: this.apiClient,
                    amqp: this.amqpConnection,
                    config: this.settings
                }
            });

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
                headers.messageId = data.id || headers.messageId;
                logger.trace({
                    messagesCount: that.messagesCount,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit data');

                headers.end = new Date().getTime();

                if (stepData.is_passthrough === true) {
                    data.passthrough = { ...origPassthrough };
                    if (settings.NO_SELF_PASSTRHOUGH) {
                        const { stepId } = incomingMessageHeaders;
                        if (stepId) {
                            data.passthrough = Object.assign({}, origPassthrough, {
                                [stepId]: Object.assign({}, _.omit(payload, 'passthrough'))
                            });
                        }
                    }
                }

                data.headers = data.headers || {};
                const { body, passthrough = {} } = data;

                if (settings.EMIT_LIGHTWEIGHT_MESSAGE) {
                    logger.trace('Outgoing lightweight is enabled, going to check size.');
                    const bodyBuf = Buffer.from(JSON.stringify(body), 'utf-8');
                    const passthroughBufs = Object.keys(passthrough).map(stepId => ({
                        stepId,
                        body: Buffer.from(JSON.stringify(passthrough[stepId].body), 'utf-8'),
                        id: passthrough[stepId].headers && passthrough[stepId].headers[OBJECT_ID_HEADER]
                    }));

                    const totalLength = passthroughBufs.reduce((len, { body }) =>
                        len + body.length, bodyBuf.length);

                    if (totalLength > settings.OBJECT_STORAGE_SIZE_THRESHOLD) {
                        logger.info(
                            'Message size is above threshold, going to upload',
                            {
                                totalLength,
                                OBJECT_STORAGE_SIZE_THRESHOLD: settings.OBJECT_STORAGE_SIZE_THRESHOLD
                            }
                        );

                        let bodyId;
                        let passthroughIds;
                        try {
                            [bodyId, ...passthroughIds] = await Promise.all([
                                that.uploadMessageBody(bodyBuf),
                                ...passthroughBufs.map(async ({ stepId, body, id }) => {
                                    const bodyId = id || await that.uploadMessageBody(body);
                                    return { stepId, bodyId };
                                })
                            ]);
                        } catch (e) {
                            logger.error(e, 'Error during message/passthrough body upload');
                            return onError(new Error('Lightweight message/passthrough body upload error'));
                        }

                        logger.info('Message body uploaded', { id: bodyId });
                        const { headers } = data;
                        data.body = {};
                        data.headers = {
                            ...(headers || {}),
                            [OBJECT_ID_HEADER]: bodyId
                        };

                        for (const { stepId, bodyId } of passthroughIds) {
                            logger.info('Passthrough Message body uploaded', { stepId, id: bodyId });
                            const { [stepId]: { headers } } = passthrough;
                            data.passthrough[stepId].body = {};
                            data.passthrough[stepId].headers = {
                                ...(headers || {}),
                                [OBJECT_ID_HEADER]: bodyId
                            };
                        }

                    } else {
                        logger.trace(
                            'Message size is below threshold.',
                            {
                                totalLength,
                                OBJECT_STORAGE_SIZE_THRESHOLD: settings.OBJECT_STORAGE_SIZE_THRESHOLD
                            }
                        );
                    }
                } else if (passthrough) {
                    logger.trace('Outgoing lightweight is disabled, going to download all bodies.');
                    try {
                        await Promise.all(Object.keys(passthrough).map(async stepId => {
                            logger.trace('Going to check if passthrough for step is lightweight.', { stepId });
                            // if body is not empty then we've downloaded before processing, no need to redownload
                            if (!_.isEmpty(data.passthrough[stepId].body)) {
                                logger.trace('Body is not empty.', { stepId });
                                return;
                            }
                            data.passthrough[stepId].body = await that.fetchMessageBody(
                                passthrough[stepId],
                                logger
                            );
                        }));
                    } catch (e) {
                        return onError(e);
                    }
                }

                if (stepData.is_passthrough === true && !settings.NO_SELF_PASSTRHOUGH) {
                    data.passthrough = Object.assign({}, origPassthrough, {
                        [settings.STEP_ID]: Object.assign({}, _.omit(data, 'passthrough'))
                    });
                }

                log.trace('Going to send outgoing message');

                try {
                    await that.amqpConnection.sendData(data, headers, that.throttles.data);
                    log.trace('Outgoing message sent');
                } catch (err) {
                    return onError(err);
                }
            }

            async function onHttpReply(reply) {
                const headers = _.clone(outgoingMessageHeaders);
                logger.trace({
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit HttpReply');

                return that.amqpConnection.sendHttpReply(reply, headers);
            }

            async function onError(err) {
                const headers = _.clone(outgoingMessageHeaders);
                err = formatError(err);
                taskExec.errorCount++;
                logger.trace({
                    err,
                    messagesCount: that.messagesCount,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit error');
                headers.end = new Date().getTime();
                return that.amqpConnection.sendError(err, headers, message, that.throttles.error);
            }

            async function onRebound(err) {
                const outgoingHeaders = _.clone(outgoingMessageHeaders);
                err = formatError(err);
                logger.trace({
                    err,
                    messagesCount: that.messagesCount,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit rebound');
                return that.amqpConnection.sendRebound(err, message, outgoingHeaders);
            }

            async function onSnapshot(data) {
                const headers = _.clone(outgoingMessageHeaders);
                headers.snapshotEvent = 'snapshot';
                that.snapshot = data; //replacing `local` snapshot
                return that.amqpConnection.sendSnapshot(data, headers, that.throttles.snapshot);
            }

            async function onUpdateSnapshot(data) {
                const headers = _.clone(outgoingMessageHeaders);
                headers.snapshotEvent = 'updateSnapshot';

                if (_.isPlainObject(data)) {
                    if (data.$set) {
                        return log.warn('ERROR: $set is not supported any more in `updateSnapshot` event');
                    }
                    _.extend(that.snapshot, data); //updating `local` snapshot
                    return that.amqpConnection.sendSnapshot(data, headers);
                } else {
                    log.error('You should pass an object to the `updateSnapshot` event');
                }
            }

            async function onUpdateKeys(keys) {
                logger.trace({
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit updateKeys');

                try {
                    await that.apiClient.accounts.update(cfg._account, { keys: keys });
                    logger.debug('Successfully updated keys #%s', deliveryTag);
                } catch (error) {
                    logger.error('Failed to updated keys #%s', deliveryTag);
                    await onError(error);
                }
            }

            function onEnd() {
                if (endWasEmitted) {
                    logger.warn({
                        messagesCount: that.messagesCount,
                        errorCount: taskExec.errorCount,
                        messageProcessingTime: Date.now() - timeStart
                    }, 'processMessage emit end was called more than once');
                    return;
                }

                endWasEmitted = true;

                if (taskExec.errorCount > 0) {
                    that.amqpConnection.reject(message);
                } else {
                    that.amqpConnection.ack(message);
                }
                that.messagesCount -= 1;
                logger.trace({
                    messagesCount: that.messagesCount,
                    errorCount: taskExec.errorCount,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit end');
                resolve();
            }
        });


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
    }

    async processMessage(payload, message) {
        //eslint-disable-next-line consistent-this
        const self = this;
        const settings = this.settings;
        const incomingMessageHeaders = this.readIncomingMessageHeaders(message);

        self.messagesCount += 1;

        const timeStart = Date.now();
        const { deliveryTag } = message.fields;

        const logger = log.child({
            threadId: incomingMessageHeaders.threadId || 'unknown',
            messageId: incomingMessageHeaders.messageId || 'unknown',
            parentMessageId: incomingMessageHeaders.parentMessageId || 'unknown',
            deliveryTag
        });

        logger.trace({ messagesCount: this.messagesCount }, 'processMessage received');

        const stepData = this.stepData;

        log.debug('Trigger or action: %s', settings.FUNCTION);
        const outgoingMessageId = uuid.v4();
        const outgoingMessageHeaders = {
            ...incomingMessageHeaders,
            ...getAdditionalHeadersFromSettings(settings),
            parentMessageId: incomingMessageHeaders.messageId,
            threadId: incomingMessageHeaders.threadId,
            messageId: outgoingMessageId,
            execId: settings.EXEC_ID,
            taskId: settings.FLOW_ID,
            workspaceId: settings.WORKSPACE_ID,
            containerId: settings.CONTAINER_ID,
            userId: settings.USER_ID,
            stepId: settings.STEP_ID,
            compId: settings.COMP_ID,
            function: settings.FUNCTION,
            start: new Date().getTime()
        };
        let module;
        try {
            module = await this.componentReader.loadTriggerOrAction(settings.FUNCTION);
        } catch (e) {
            log.error(e);
            outgoingMessageHeaders.end = new Date().getTime();
            self.amqpConnection.sendError(e, outgoingMessageHeaders, message);
            self.amqpConnection.reject(message);
            return;
        }

        const method = this.componentReader.findTriggerOrActionDefinition(settings.FUNCTION);

        if (method.autoResolveObjectReferences) {
            const { passthrough } = payload;

            try {
                await Promise.all([
                    (async () => {
                        logger.trace('Going to check if incoming message body is lightweight.');
                        payload.body = await this.fetchMessageBody(payload, logger);
                    })(),
                    ...(passthrough
                        ? Object.keys(passthrough).map(async stepId => {
                            logger.trace('Going to check if passthrough for step is lightweight.', { stepId });
                            payload.passthrough[stepId].body = await this.fetchMessageBody(
                                payload.passthrough[stepId],
                                logger
                            );
                        })
                        : [])
                ]);
            } catch (e) {
                logger.error(e);
                outgoingMessageHeaders.end = new Date().getTime();
                self.amqpConnection.sendError(e, outgoingMessageHeaders, message);
                self.amqpConnection.reject(message);
                return;
            }
        }

        await this.runExec(module, payload, message, outgoingMessageHeaders, stepData, timeStart, logger);
    }
}

exports.Sailor = Sailor;
