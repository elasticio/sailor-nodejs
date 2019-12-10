/* eslint-disable no-inner-declarations */
/* eslint-disable no-underscore-dangle, consistent-return */
const Q = require('q');
const _ = require('lodash');
const assert = require('assert');
const request = require('requestretry');
const util = require('util');
const { EventEmitter } = require('events');
const debug = require('debug')('sailor');
const RestApiClient = require('elasticio-rest-node');
const { ComponentReader } = require('./component_reader');
const log = require('./logging');

const { ComponentLogger } = log;

exports.processService = function processService(serviceMethod, env) {
    const ALLOWED_METHODS = {
    // eslint-disable-next-line no-use-before-define
        verifyCredentials,
        // eslint-disable-next-line no-use-before-define
        getMetaModel,
        // eslint-disable-next-line no-use-before-define
        selectModel,
    };

    const POST_RESULT_URL = env.ELASTICIO_POST_RESULT_URL;
    const CFG = env.ELASTICIO_CFG;
    const ACTION_OR_TRIGGER = env.ELASTICIO_ACTION_OR_TRIGGER;
    const GET_MODEL_METHOD = env.ELASTICIO_GET_MODEL_METHOD;
    const COMPONENT_PATH = env.ELASTICIO_COMPONENT_PATH;
    const API_URI = env.ELASTICIO_API_URI;
    const API_USERNAME = env.ELASTICIO_API_USERNAME;
    const API_KEY = env.ELASTICIO_API_KEY;

    const compReader = new ComponentReader();

    function init() {
        debug('About to init');

        if (!POST_RESULT_URL) {
            const err = new Error('ELASTICIO_POST_RESULT_URL is not provided');
            err.sendable = false;
            throw err;
        }

        assert(ALLOWED_METHODS[serviceMethod], util.format('Unknown service method "%s"', serviceMethod));
        assert(CFG, 'ELASTICIO_CFG is not provided');
        assert(API_URI, 'ELASTICIO_API_URI is not provided');
        assert(API_USERNAME, 'ELASTICIO_API_USERNAME is not provided');
        assert(API_KEY, 'ELASTICIO_API_KEY is not provided');

        if (serviceMethod === 'getMetaModel' || serviceMethod === 'selectModel') {
            assert(ACTION_OR_TRIGGER, 'ELASTICIO_ACTION_OR_TRIGGER is not provided');
        }
        if (serviceMethod === 'selectModel') {
            assert(GET_MODEL_METHOD, 'ELASTICIO_GET_MODEL_METHOD is not provided');
        }

        let cfg;
        try {
            cfg = JSON.parse(CFG);
        } catch (e) {
            throw new Error('Unable to parse CFG');
        }

        debug('Config: %j', cfg);

        const params = {
            triggerOrAction: ACTION_OR_TRIGGER,
            getModelMethod: GET_MODEL_METHOD,
        };

        return [cfg, params];
    }

    function execService(cfg, params) {
        debug('Init is complete. About to start execution.');

        return compReader.init(COMPONENT_PATH).then(() => ALLOWED_METHODS[serviceMethod](cfg, params));
    }

    function sendResponse(responseBody) {
        const opts = {
            url: POST_RESULT_URL,
            json: true,
            forever: true,
            headers: {
                Connection: 'Keep-Alive',
            },
            rejectUnauthorized: false,
            body: responseBody,
            simple: false,
            maxAttempts: parseInt(env.ELASTICIO_API_REQUEST_RETRY_ATTEMPTS, 10),
            retryDelay: parseInt(env.ELASTICIO_API_REQUEST_RETRY_DELAY, 10),
            retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
            fullResponse: true,
        };

        debug('About to send response back to the API');

        return request.post(opts)
            .then((response) => {
                // eslint-disable-next-line eqeqeq
                if (response.statusCode != '200') {
                    debug('Unable to reach API :(');
                    const error = new Error(util.format(
                        'Failed to POST data to %s (%s, %s)',
                        POST_RESULT_URL, response.statusCode, response.body,
                    ));
                    error.sendable = false;
                    throw error;
                }
            })
            .then(() => responseBody);
    }

    function onSuccess(data) {
        return sendResponse({ status: 'success', data });
    }

    function onError(err) {
        if (err.sendable === false) {
            throw new Error(err.message);
        }
        const errorData = {
            message: err.message,
        };
        log.error(err, err.stack);
        return sendResponse({ status: 'error', data: errorData });
    }

    return Q.fcall(init)
        .spread(execService)
        .then(onSuccess)
        .catch(onError);

    function verifyCredentials(cfg, params) {
        const callScope = new EventEmitter();
        callScope.logger = new ComponentLogger();

        function doVerification(verify) {
            // eslint-disable-next-line no-async-promise-executor
            return new Promise(async (resolve, reject) => {
                async function legacyCallback(e, result) {
                    if (e) {
                        reject(e);
                    }
                    resolve(result);
                }

                try {
                    let result = verify.call(callScope, cfg, legacyCallback);
                    /**
                     * Runs verify with an await statement if and only if it requires one, depending on if the existing
                     * result statement has resolved or not. BUGFIX to handle both cases component4 and component12, based on
                     * https://stackoverflow.com/a/35820220
                     * @param {Promise} p
                     */
                    async function resolvePromise(p) {
                        const t = {};
                        return Promise.race([p, t])
                            .then(async (v) => {
                                if (v === t) result = await verify.call(callScope, cfg, legacyCallback);
                            });
                    }
                    await resolvePromise(result);

                    if (result) {
                        resolve(result);
                    }
                } catch (e) {
                    reject(e);
                }
            });
        }

        /**
           * In will allow developers to return Promise.resolve(ANYTHING) in verifyCredentials.
           */
        function toVerifyCredentialsResponse(result) {
            if (!_.has(result, 'verified')) {
                return {
                    verified: true,
                };
            }

            return result;
        }

        function error(e) {
            return {
                verified: false,
                reason: e.context || e.message,
            };
        }

        return compReader.loadVerifyCredentials()
            .then(doVerification)
            .then(toVerifyCredentialsResponse)
            .catch(error);
    }

    function callModuleMethod(triggerOrAction, method, cfg) {
        const callScope = new EventEmitter();
        // eslint-disable-next-line no-use-before-define
        callScope.on('updateKeys', onUpdateKeys);
        callScope.logger = new ComponentLogger();

        const finished = Q.defer();
        const subPromises = [];

        function validateMethod(module) {
            const errorMsg = `Method "${method}" is not found in "${triggerOrAction}" action or trigger`;
            assert(_.isFunction(module[method]), errorMsg);
            return module;
        }

        function executeMethod(module) {
            return new Promise((resolve, reject) => {
                function legacyCallback(e, result) {
                    if (e) {
                        return reject(e);
                    }
                    resolve(result);
                }
                const result = module[method].bind(callScope)(cfg, legacyCallback);

                if (result) {
                    resolve(result);
                }
            });
        }

        function onExecutionSuccess(data) {
            Q.allSettled(subPromises).then((res) => {
                _(res)
                    .filter({
                        state: 'rejected',
                    })
                    .map((result) => result.reason)
                    .each(log.error.bind(log));
                finished.resolve(data);
            }).catch((err) => log.error(err));
        }

        function onExecutionFail(err) {
            finished.reject(err);
        }

        function onUpdateKeys(keys) {
            // eslint-disable-next-line new-cap
            const apiClient = RestApiClient(API_USERNAME, API_KEY, {
                retryCount: parseInt(env.ELASTICIO_API_REQUEST_RETRY_ATTEMPTS, 10),
                retryDelay: parseInt(env.ELASTICIO_API_REQUEST_RETRY_DELAY, 10),
            });
            subPromises.push(apiClient.accounts.update(cfg._account, { keys }));
        }

        compReader.loadTriggerOrAction(triggerOrAction)
            .then(validateMethod)
            .then(executeMethod)
            .then(onExecutionSuccess)
            .catch(onExecutionFail)
            .done();

        return finished.promise;
    }

    function getMetaModel(cfg, params) {
        return callModuleMethod(params.triggerOrAction, 'getMetaModel', cfg);
    }

    function selectModel(cfg, params) {
        return callModuleMethod(params.triggerOrAction, params.getModelMethod, cfg);
    }
};
