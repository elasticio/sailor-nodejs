const assert = require('assert');
const uuid = require('uuid');
const App = require('./App.js');

class MultiApp extends App {
    async _start() {
        const { MultiAppLogger } = require('./logging.js');
        const AmqpConnWrapper = require('./AmqpConnWrapper.js');
        const { AmqpCommunicationLayer } = require('./amqp.js');
        const { MultisailorConfig } = require('./settings.js');
        const RestApiClient = require('elasticio-rest-node');

        this._sailors = {};
        this._config = MultisailorConfig.fromEnv();
        this._logger = new MultiAppLogger(this._config);
        this._amqpConn = new AmqpConnWrapper(this._config.AMQP_URI, this._logger);
        await this._amqpConn.start();
        this._apiClient = RestApiClient( // eslint-disable-line
            this._config.API_USERNAME,
            this._config.API_KEY,
            {
                retryCount: this._config.API_REQUEST_RETRY_ATTEMPTS,
                retryDelay: this._config.API_REQUEST_RETRY_DELAY
            }
        );
        this._sharedCommunicationLayer = new AmqpCommunicationLayer(this._amqpConn, this._config, this._logger);
        // FIXME probably componetn should assert queue for itself???
        // at least until admirals (or any other microservice) will manage them properly
        await this._sharedCommunicationLayer.listenQueue(this._dispatch.bind(this));
    }

    async _stop() {
        if (this._sharedCommunicationLayer) {
            await this._sharedCommunicationLayer.unlistenQueue();
        }
        await this._stopAllSailors();
        if (this._amqpConn) {
            await this._amqpConn.stop();
            this._amqpConn = null;
        }
    }
    _stopAllSailors() {
        return Promise.all(Object.values(this._sailors).reduce(
            (promises, stepsTable) => Object.values(stepsTable).reduce(
                (promises, sailor) => promises.concat(sailor.stop()),
                promises
            ),
            []
        ));
    }
    async _handleFatalError() {
        // FIXME empty
    }
    _logError() {
        // FIXME empty
    }

    async _dispatch(payload, msg) {
        try {
            const sailor = await this._getSailor(msg);
            await sailor.processMessage(payload, msg);
        } catch (e) {
            console.error(e.stack);
            this._logger.error(e, 'Can not handle message');
        }
    }
    _parseRouingKey(rk) {
        // $workspaceId.$taskId/$taskType.$stepId.$queue_suffix
        const parts = rk.split('.');
        // FIXME handle incorrect routing key;  log error, skip and reject message to make it disappear in queue
        assert(parts.length === 4);
        // Traffic to service component should be forwarded with input routing key
        // because input routing key contains step id of CURRENT_STEP
        // (As opposite messages routing key contains previous step id);
        assert(parts[3] === 'input');
        return {
            flowId: parts[1].split('/')[0], // FIXME add asserts
            stepId: parts[2]
        };
    }
    async _getSailor(msg) {
        const { SingleAppLogger } = require('./logging.js'); // FIXME proper logger
        const Sailor = require('./sailor.js');
        const { AmqpCommunicationLayer } = require('./amqp.js');

        let sailor;
        const { flowId, stepId } = this._parseRouingKey(msg.fields.routingKey);
        try {
            this._sailors[flowId] = this._sailors[flowId] || {};
            if (this._sailors[flowId][stepId]) {
                return this._sailors[flowId][stepId];
            }
            const [config, stepData] = await this._restoreExecContext(flowId, stepId, msg);
            const logger = new SingleAppLogger(config);
            const communicationLayer = new AmqpCommunicationLayer(this._amqpConn, config, logger);
            sailor = new Sailor(
                communicationLayer,
                config,
                logger
            );
            sailor.stepData = stepData; // FIXME fucking ugly
            await sailor.prepare();
            /**
             * TODO skip atm. Generally it's possible to fetch data from api.
             * to handle if startup is requried.
             * Startup is requried if no hooks data and sailor supports startup hook
             * if (STARTUP_REQUIERD)
             *     await sailor.startup();
             * }
            */
            await sailor.init();
            // NOTICE do not call sailor.run here.
            // message dispatching is done in different ways in MultiSailor and SingleSailor modes
            return this._sailors[flowId][stepId] = sailor; // eslint-disable-line
        } catch (e) {
            console.log('got error', e);
            // FIXME hell knows if this works
            await sailor && sailor.reportError(e);
            // FIXME try to log error in context of current message
            throw e;
        }
    }

    async _restoreExecContext(flowId, stepId, msg) {
        // FIXME every step should be injected with it's own user + pass
        // retrieveStep should provide user + pass
        const manadatoryValues = Object.assign({}, this._config);
        manadatoryValues.FLOW_ID = flowId;
        manadatoryValues.STEP_ID = stepId;
        manadatoryValues.EXEC_ID = msg.properties.headers.execId;
        manadatoryValues.USER_ID = msg.properties.headers.userId;
        const stepData = await this._apiClient.tasks.retrieveStep(manadatoryValues.FLOW_ID, manadatoryValues.STEP_ID);
        const flowType = stepData.flow_type;
        // FIXME, probably that's not required anymore
        // Debug tasks works in different way, lookout does not consume all
        // messages with routing keys ends with debug;
        const suffix = flowType === 'debug' ? '_debug' : '';

        // NOTICE we generate one "pseudo-container" per flow + step;
        manadatoryValues.CONTAINER_ID = uuid.v4();

        manadatoryValues.WORKSPACE_ID = stepData.workspace_id;// FIXME assert
        manadatoryValues.COMP_ID = stepData.comp_id; // FIXME assert
        manadatoryValues.FUNCTION = stepData.function; // FIXME ASSERT

        manadatoryValues.COMP_NAME = stepData.comp_name; // FIXME assert
        manadatoryValues.EXEC_TYPE = 'flow-step'; // FIXME should match admiral ENV_VARS_CREATOR
        manadatoryValues.FLOW_VERSION = stepData.flow_version; // FIXME assert
        manadatoryValues.TENANT_ID = stepData.tenant_id; // FIXME assert
        manadatoryValues.CONTRACT_ID = stepData.contract_id; // FIXME assert
        // manadatoryValues.TASK_USER_EMAIL = stepData.XXXX
        // manadatoryValues.EXECUTION_RESULT_ID  = 'ZZZZ'// FIXME skip ATM one time execs

        // used by communication layer only
        // FIXME this knowledge is currently shared between this code and admiral.
        // have no idea how to fix it normally.
        // Probably sailor to monorepo, and reuse code between admiral and sailor.
        // Other option: step info endpoint should return this data
        manadatoryValues.PUBLISH_MESSAGES_TO = `${manadatoryValues.WORKSPACE_ID}_org`;
        manadatoryValues.DATA_ROUTING_KEY = `${manadatoryValues.WORKSPACE_ID}.` +
            `${manadatoryValues.FLOW_ID}/${flowType}.` +
            `${manadatoryValues.STEP_ID}.message${suffix}`;
        manadatoryValues.ERROR_ROUTING_KEY = `${manadatoryValues.WORKSPACE_ID}.` +
            `${manadatoryValues.FLOW_ID}/${flowType}.` +
            `${manadatoryValues.STEP_ID}.error${suffix}`;
        manadatoryValues.REBOUND_ROUTING_KEY = `${manadatoryValues.WORKSPACE_ID}.` +
            `${manadatoryValues.FLOW_ID}/${flowType}.` +
            `${manadatoryValues.STEP_ID}.rebound${suffix}`;
        manadatoryValues.SNAPSHOT_ROUTING_KEY = `${manadatoryValues.WORKSPACE_ID}.` +
            `${manadatoryValues.FLOW_ID}/${flowType}.` +
            `${manadatoryValues.STEP_ID}.snapshot${suffix}`;

        return [manadatoryValues, stepData];
    }
}
module.exports = MultiApp;
