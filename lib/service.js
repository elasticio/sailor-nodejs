const assert = require('assert');
const { EventEmitter } = require('events');
const util = require('util');

const _ = require('lodash');
const request = require('requestretry');
const debug = require('debug')('sailor');

const RestApiClient = require('elasticio-rest-node');

const { ComponentReader } = require('./component_reader');
const { OneTimeExecutionLogger } = require('./logging.js');
const { OneTimeExecutionConfig } = require('./settings.js');
const ALLOWED_METHODS = {
    verifyCredentials: verifyCredentials,
    getMetaModel: getMetaModel,
    selectModel: selectModel
};

function init(config, serviceMethod) {
    debug('About to init');

    if (!config.POST_RESULT_URL) {
        const err = new Error('ELASTICIO_POST_RESULT_URL is not provided');
        err.sendable = false;
        throw err;
    }

    assert(ALLOWED_METHODS[serviceMethod], util.format('Unknown service method "%s"', serviceMethod));

    if (serviceMethod === 'getMetaModel' || serviceMethod === 'selectModel') {
        assert(config.ACTION_OR_TRIGGER, 'ELASTICIO_ACTION_OR_TRIGGER is not provided');
    }
    if (serviceMethod === 'selectModel') {
        assert(config.GET_MODEL_METHOD, 'ELASTICIO_GET_MODEL_METHOD is not provided');
    }

    let cfg;
    try {
        cfg = JSON.parse(config.CFG);
    } catch (e) {
        throw new Error('Unable to parse CFG');
    }

    debug('Config: %j', cfg);

    const params = {
        triggerOrAction: config.ACTION_OR_TRIGGER,
        getModelMethod: config.GET_MODEL_METHOD
    };

    return [cfg, params];
}
async function sendResponse(config, responseBody) {
    const opts = {
        url: config.POST_RESULT_URL,
        json: true,
        forever: true,
        headers: {
            Connection: 'Keep-Alive'
        },
        rejectUnauthorized: false,
        body: responseBody,
        simple: false,
        maxAttempts: parseInt(config.API_REQUEST_RETRY_ATTEMPTS),
        retryDelay: parseInt(config.API_REQUEST_RETRY_DELAY),
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        fullResponse: true
    };

    debug('About to send response back to the API');
    const response = await request.post(opts);
    // eslint-disable-next-line eqeqeq
    if (response.statusCode != '200') {
        debug('Unable to reach API :(');

        const error = new Error(util.format(
            'Failed to POST data to %s (%s, %s)',
            config.POST_RESULT_URL, response.statusCode, response.body
        ));
        error.sendable = false;
        throw error;
    }
    return responseBody;
}
async function verifyCredentials(apiClient, compReader, logger, cfg, params) {
    try {
        const verify = await compReader.loadVerifyCredentials();
        const result = await new Promise((resolve, reject) => {
            const callScope = new EventEmitter();
            callScope.logger = logger;
            const result = verify.call(callScope, cfg, (e, result) => {
                if (e) {
                    return reject(e);
                }
                resolve(result);
            });

            if (result) {
                resolve(result);
            }
        });

        /**
         * In will allow developers to return Promise.resolve(ANYTHING) in verifyCredentials.
         */
        if (!_.has(result, 'verified')) {
            return {
                verified: true
            };
        }
        return result;
    } catch (e) {
        return {
            verified: false,
            reason: e.message
        };
    }
}

function getMetaModel(apiClient, compReader, logger, cfg, params) {
    return callModuleMethod(apiClient, compReader, logger, params.triggerOrAction, 'getMetaModel', cfg);
}

function selectModel(apiClient, compReader, logger, cfg, params) {
    return callModuleMethod(apiClient, compReader, logger, params.triggerOrAction, params.getModelMethod, cfg);
}

async function callModuleMethod(apiClient, compReader, logger, triggerOrAction, method, cfg) {
    const subPromises = [];
    const callScope = new EventEmitter();
    callScope.on('updateKeys', (keys) => subPromises.push(apiClient.accounts.update(cfg._account, { keys: keys })));
    callScope.logger = logger;

    const module = await compReader.loadTriggerOrAction(triggerOrAction);
    const errorMsg = `Method "${method}" is not found in "${triggerOrAction}" action or trigger`;
    assert(_.isFunction(module[method]), errorMsg);
    try {
        const data = await new Promise((resolve, reject) => {
            const result = module[method].bind(callScope)(cfg, (e, result) => {
                if (e) {
                    return reject(e);
                }
                resolve(result);
            });

            if (result) {
                resolve(result);
            }
        });

        await Promise.all(subPromises.map(async (promise) => {
            try {
                await promise;
            } catch (e) {
                logger.error(e);
            }
        }));
        return data;
    } catch (e) {
        console.log('on exec fail');
        throw e;
    }
}

async function processService(serviceMethod) {
    const config = OneTimeExecutionConfig.fromEnv();
    const logger = new OneTimeExecutionLogger(config);

    try {
        const compReader = new ComponentReader(logger);
        // eslint-disable-next-line new-cap
        const apiClient = RestApiClient(config.API_USERNAME, config.API_KEY, {
            retryCount: parseInt(config.API_REQUEST_RETRY_ATTEMPTS),
            retryDelay: parseInt(config.API_REQUEST_RETRY_DELAY)
        });

        const [cfg, params] = init(config, serviceMethod);
        debug('Init is complete. About to start execution.');
        await compReader.init(config.COMPONENT_PATH);
        const data = await ALLOWED_METHODS[serviceMethod](apiClient, compReader, logger, cfg, params);
        return sendResponse(config, { status: 'success', data: data });
    } catch (err) {
        if (err.sendable === false) {
            throw new Error(err.message);
        }
        const errorData = {
            message: err.message
        };
        logger.error(err, err.stack);
        return sendResponse(config, { status: 'error', data: errorData });
    }
}

exports.processService = processService;
