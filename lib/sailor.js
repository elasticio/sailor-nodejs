const uuid = require('uuid');
const ComponentReader = require('./component_reader.js').ComponentReader;
const { ProxyClient, MESSAGE_PROCESSING_STATUS } = require('./proxy-client.js');
const TaskExec = require('./executor.js').TaskExec;
const log = require('./logging.js');
const _ = require('lodash');
const hooksData = require('./hooksData');
const RestApiClient = require('elasticio-rest-node');
const assert = require('assert');
const co = require('co');

const OBJECT_ID_HEADER = 'x-ipaas-object-storage-id';

function convertSettingsToSnakeCase(settings) {
    return _.mapKeys(settings, (value, key) => _.snakeCase(key));
}

function getAdditionalMetadataFromSettings(settings) {
    return convertSettingsToSnakeCase(settings.additionalVars);
}

class Sailor {
    static get OBJECT_ID_HEADER() {
        return OBJECT_ID_HEADER;
    }
    constructor(settings) {
        this.settings = settings;
        this.messagesCount = 0;
        this.proxyClient = new ProxyClient(settings);
        this.componentReader = new ComponentReader();
        this.snapshot = {};
        this.stepData = {};
        this.shutdownCallback = null;
        // TODO move endpoint to proxy
        // eslint-disable-next-line new-cap
        this.apiClient = RestApiClient(
            settings.API_USERNAME,
            settings.API_KEY,
            {
                retryCount: settings.API_REQUEST_RETRY_ATTEMPTS,
                retryDelay: settings.API_REQUEST_RETRY_DELAY
            }
        );
    }

    async connect() {
        return this.proxyClient.connect();
    }

    async isConnected() {
        return this.proxyClient.isConnected();
    }

    async prepare() {
        log.trace('prepare sailor');
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
        return this.proxyClient.disconnect();
    }

    reportError(err) {
        const metadata = Object.assign({}, getAdditionalMetadataFromSettings(this.settings), {
            execId: this.settings.EXEC_ID,
            taskId: this.settings.FLOW_ID,
            workspaceId: this.settings.WORKSPACE_ID,
            containerId: this.settings.CONTAINER_ID,
            userId: this.settings.USER_ID,
            stepId: this.settings.STEP_ID,
            compId: this.settings.COMP_ID,
            function: this.settings.FUNCTION
        });
        return this.proxyClient.sendError(err, metadata);
    }

    startup() {
        return co(function * doStartup() {
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
        return co(function * doShutdown() {
            log.debug('About to shut down');
            const handle = hooksData.startup(this.settings);
            const state = yield handle.retrieve();
            yield this.invokeModuleFunction('shutdown', state);
            yield handle.delete();
            log.debug('Shut down successfully');
        }.bind(this));
    }

    runHookInit() {
        return co(function * doInit() {
            log.debug('About to initialize component for execution');
            const res = yield this.invokeModuleFunction('init');
            log.debug('Component execution initialized successfully');
            return res;
        }.bind(this));
    }

    invokeModuleFunction(moduleFunction, data) {
        const settings = this.settings;
        const stepData = this.stepData;
        return co(function * gen() {
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
        const handler = this.processMessageAndMaybeShutdownCallback.bind(this);
        log.debug('Start listening for messages');
        return this.proxyClient.listenForMessages(handler);
    }

    async processMessageAndMaybeShutdownCallback(metadata, body) {
        try {
            await this.processMessage(metadata, body);
        } catch (e) {
            log.error(e, 'Something very bad happened during message processing');
        } finally {
            log.debug({
                messagesCount: this.messagesCount
            }, 'Finished processing message, checking if shutdownCallback should be called');
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

        await this.proxyClient.stopListeningForMessages();
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

    async runExec(module, payload, metadata, outgoingMetadata, stepData, timeStart, logger) {
        log.debug({ metadata }, 'runExec started');
        const origPassthrough = _.cloneDeep(payload.passthrough) || {};
        const settings = this.settings;
        const cfg = _.cloneDeep(stepData.config) || {};
        const snapshot = _.cloneDeep(this.snapshot);

        const that = this;

        await new Promise(resolve => {
            let endWasEmitted;

            const taskExec = new TaskExec({
                loggerOptions: _.pick(metadata, ['threadId', 'messageId', 'parentMessageId']),
                variables: stepData.variables,
                services: {
                    apiClient: this.apiClient,
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
                .on('customType', onCustomType)
                .on('end', onEnd);

            taskExec.process(module, payload, cfg, snapshot);

            async function onData(data) {
                const metadataToSend = _.clone(outgoingMetadata);
                metadataToSend.messageId = data.id || metadataToSend.messageId;
                logger.trace({
                    messagesCount: that.messagesCount,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit data');

                metadataToSend.end = new Date().getTime();

                if (stepData.is_passthrough === true) {
                    data.passthrough = { ...origPassthrough };
                    if (settings.NO_SELF_PASSTRHOUGH) {
                        const { stepId } = metadata;
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
                                that.proxyClient.uploadMessageBody(bodyBuf),
                                ...passthroughBufs.map(async ({ stepId, body, id }) => {
                                    const bodyId = id || await that.proxyClient.uploadMessageBody(body);
                                    return { stepId, bodyId };
                                })
                            ]);
                        } catch (e) {
                            logger.error(e, 'Error during message/passthrough body upload');
                            return onError(new Error('Lightweight message/passthrough body upload error'));
                        }

                        logger.info({ id: bodyId }, 'Message body uploaded');
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
                            data.passthrough[stepId].body = await that.proxyClient.fetchMessageBody(
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
                    await that.proxyClient.sendMessage({
                        incomingMessageId: metadata.messageId,
                        data,
                        metadata: metadataToSend,
                        type: 'data'
                    });
                    log.trace('Outgoing message sent');
                } catch (err) {
                    return onError(err);
                }
            }

            async function onHttpReply(reply) {
                const metadataToSend = _.clone(outgoingMetadata);
                logger.trace({
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit HttpReply');

                return that.proxyClient.sendMessage({
                    incomingMessageId: metadata.messageId,
                    data: reply,
                    metadata: metadataToSend,
                    type: 'http-reply'
                });
            }

            async function onError(err) {
                const metadataToSend = _.clone(outgoingMetadata);
                err = formatError(err);
                taskExec.errorCount++;
                logger.trace({
                    err,
                    messagesCount: that.messagesCount,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit error');
                metadataToSend.end = new Date().getTime();
                return that.proxyClient.sendError(err, metadataToSend, payload, metadata);
            }

            async function onRebound(err) {
                const metadataToSend = _.clone(outgoingMetadata);
                err = formatError(err);
                logger.trace({
                    err,
                    messagesCount: that.messagesCount,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit rebound');
                return that.proxyClient.sendRebound(err, metadata, metadataToSend);
            }

            async function onSnapshot(data) {
                const metadataToSend = _.clone(outgoingMetadata);
                metadataToSend.snapshotEvent = 'snapshot';
                that.snapshot = data; // replacing `local` snapshot
                return that.proxyClient.sendSnapshot(data, metadataToSend);
            }

            async function onUpdateSnapshot(data) {
                const metadataToSend = _.clone(outgoingMetadata);
                metadataToSend.snapshotEvent = 'updateSnapshot';

                if (_.isPlainObject(data)) {
                    if (data.$set) {
                        return log.warn('ERROR: $set is not supported any more in `updateSnapshot` event');
                    }
                    _.extend(that.snapshot, data); // updating `local` snapshot
                    return that.proxyClient.sendSnapshot(data, metadataToSend);
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
                    logger.debug({ messageId: metadata.messageId }, 'Successfully updated keys');
                } catch (error) {
                    logger.debug({ messageId: metadata.messageId }, 'Failed to update keys');
                    await onError(error);
                }
            }

            async function onEnd() {
                if (endWasEmitted) {
                    logger.warn({
                        messagesCount: that.messagesCount,
                        errorCount: taskExec.errorCount,
                        messageProcessingTime: Date.now() - timeStart
                    }, 'processMessage emit end was called more than once');
                    return;
                }

                endWasEmitted = true;

                await that.proxyClient.finishProcessing(
                    metadata,
                    taskExec.errorCount > 0
                        ? MESSAGE_PROCESSING_STATUS.ERROR
                        : MESSAGE_PROCESSING_STATUS.SUCCESS
                );
                that.messagesCount -= 1;
                logger.trace({
                    messagesCount: that.messagesCount,
                    errorCount: taskExec.errorCount,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit end');
                resolve();
            }

            async function onCustomType({ type, payload, protocolVersion = 2 }) {
                const metadataToSend = _.clone(outgoingMetadata);
                logger.trace({
                    type,
                    messageProcessingTime: Date.now() - timeStart
                }, 'processMessage emit customType');
                return that.proxyClient.sendMessage({
                    incomingMessageId: metadata.messageId,
                    data: payload,
                    metadata: metadataToSend,
                    type,
                    forceProtocolVersion: protocolVersion
                });
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

    async processMessage(metadata, payload) {
        // eslint-disable-next-line consistent-this
        const self = this;
        const settings = this.settings;

        self.messagesCount += 1;

        const timeStart = Date.now();

        const logger = log.child({
            threadId: metadata.threadId || 'unknown',
            messageId: metadata.messageId || 'unknown',
            parentMessageId: metadata.parentMessageId || 'unknown'
        });

        logger.trace({ messagesCount: this.messagesCount }, 'processMessage received');

        const stepData = this.stepData;

        log.debug('Trigger or action: %s', settings.FUNCTION);
        const outgoingMessageId = uuid.v4();
        const outgoingMetadata = {
            ...metadata,
            ...getAdditionalMetadataFromSettings(settings),
            parentMessageId: metadata.messageId,
            threadId: metadata.threadId,
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
            outgoingMetadata.end = new Date().getTime();
            self.proxyClient.sendError(e, outgoingMetadata, payload, metadata);
            self.proxyClient.finishProcessing(metadata, MESSAGE_PROCESSING_STATUS.ERROR);
            return;
        }

        const method = this.componentReader.findTriggerOrActionDefinition(settings.FUNCTION);

        if (method.autoResolveObjectReferences) {
            const { passthrough } = payload;

            try {
                await Promise.all([
                    (async () => {
                        logger.trace('Going to check if incoming message body is lightweight.');
                        payload.body = await this.proxyClient.fetchMessageBody(payload, logger);
                    })(),
                    ...(passthrough
                        ? Object.keys(passthrough).map(async stepId => {
                            logger.trace('Going to check if passthrough for step is lightweight.', { stepId });
                            payload.passthrough[stepId].body = await this.proxyClient.fetchMessageBody(
                                payload.passthrough[stepId],
                                logger
                            );
                        })
                        : [])
                ]);
            } catch (e) {
                logger.error(e);
                outgoingMetadata.end = new Date().getTime();
                self.proxyClient.sendError(e, outgoingMetadata, payload, metadata);
                self.proxyClient.finishProcessing(metadata, MESSAGE_PROCESSING_STATUS.ERROR);
                return;
            }
        }

        await this.runExec(module, payload, metadata, outgoingMetadata, stepData, timeStart, logger);
    }
}

exports.Sailor = Sailor;
