const EventEmitter = require('events').EventEmitter;
const RestApiClient = require('elasticio-rest-node');
const _ = require('lodash');
const assert = require('assert');
const request = require('requestretry');
const util = require('util');
const debug = require('debug')('sailor');
const ComponentReader = require('./component_reader').ComponentReader;
const log = require('./logging');

exports.processService = processService;

async function processService (serviceMethod, env) {
    const ALLOWED_METHODS = {
        verifyCredentials: verifyCredentials,
        getMetaModel: getMetaModel,
        selectModel: selectModel
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

    try {
        const [cfg, params] = await init();
        const data = await execService(cfg, params);

        return sendResponse({ status: 'success', data: data });
    } catch (err) {
        if (err.sendable === false) {
            throw new Error(err.message);
        }

        const errorData = { message: err.message };
        log.error(err, err.stack);
        return sendResponse({ status: 'error', data: errorData });
    }

    async function init () {
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
            getModelMethod: GET_MODEL_METHOD
        };

        return [cfg, params];
    }

    async function execService (cfg, params) {
        debug('Init is complete. About to start execution.');
        await compReader.init(COMPONENT_PATH);

        return ALLOWED_METHODS[serviceMethod](cfg, params);
    }

    async function sendResponse (responseBody) {
        const opts = {
            url: POST_RESULT_URL,
            json: true,
            rejectUnauthorized: false,
            body: responseBody,
            simple: false,
            maxAttempts: parseInt(env.ELASTICIO_API_REQUEST_RETRY_ATTEMPTS),
            retryDelay: parseInt(env.ELASTICIO_API_REQUEST_RETRY_DELAY),
            retryStrategy: request.RetryStrategies.NetworkError,
            fullResponse: true
        };

        debug('About to send response back to the API');

        const response = await request.post(opts);
        if (response.statusCode !== 200) {
            debug('Unable to reach API :(');

            const error = new Error(util.format(
                'Failed to POST data to %s (%s, %s)',
                POST_RESULT_URL, response.statusCode, response.body
            ));
            error.sendable = false;
            throw error;
        }

        return responseBody;
    }

    function verifyCredentials (cfg, params) {
        function doVerification (verify) {
            return new Promise((resolve, reject) => {
                function legacyCallback (e, result) {
                    if (e) {
                        return reject(e);
                    }
                    resolve(result);
                }
                const result = verify(cfg, legacyCallback);

                if (result) {
                    resolve(result);
                }
            });
        }

        /**
         * In will allow developers to return Promise.resolve(ANYTHING) in verifyCredentials.
         */
        function toVerifyCredentialsResponse (result) {
            if (!_.has(result, 'verified')) {
                return {
                    verified: true
                };
            }

            return result;
        }

        function error (e) {
            return {
                verified: false,
                reason: e.message
            };
        }

        return compReader.loadVerifyCredentials()
            .then(doVerification)
            .then(toVerifyCredentialsResponse)
            .catch(error);
    }

    function getMetaModel (cfg, params) {
        return callModuleMethod(params.triggerOrAction, 'getMetaModel', cfg);
    }

    function selectModel (cfg, params) {
        return callModuleMethod(params.triggerOrAction, params.getModelMethod, cfg);
    }

    async function callModuleMethod (triggerOrAction, method, cfg) {
        const subPromises = [];
        const callScope = new EventEmitter();
        callScope.on('updateKeys', onUpdateKeys);

        try {
            const module = await compReader.loadTriggerOrAction(triggerOrAction);
            assert(_.isFunction(module[method]), `Method "${method}" is not found in "${triggerOrAction}" action or trigger`);

            const data = await new Promise((resolve, reject) => module[method].bind(callScope)(cfg, (error, result) => error ? reject(error) : resolve(result)));
            const [response] = await Promise.all(subPromises);

            _(response)
                .filter({ state: 'rejected' })
                .map(result => result.reason)
                .each(log.error.bind(log));

            return data;
        } catch (e) {
            throw e;
        }

        function onUpdateKeys (keys) {
            const apiClient = RestApiClient(API_USERNAME, API_KEY);
            addPromise(apiClient.accounts.update(cfg._account, { keys: keys }));
        }

        function addPromise (p) {
            subPromises.push(p);
        }
    }
}
