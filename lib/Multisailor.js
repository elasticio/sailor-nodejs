const assert = require('assert');
const { ComponentLogger } = require('./logging.js');
const { AmqpCommunicationLayer } = require('./amqp.js');
const { Sailor } = require('./sailor.js');


class MultiSailor {
    constructor(amqpConn, config, logger) {
        this._amqpConn = amqpConn;
        this._logger = logger; // not context aware logger
        this._sharedCommunicationLayer = new AmqpCommunicationLayer(this._amqpConn, this._logger, config);
        this._config = config;
        this._sailors = {};
    }
    async start() {
        await this._sharedCommunicationLayer.listenQueue(this._dispatch.bind(this));
    }
    async stop() {
        await this._sharedCommunicationLayer.unlistenQueue();
    }

    async _dispatch(msg) {
        try {
            const sailor = await this._getSailor(msg);
            sailor.processMessage(msg);
        } catch (e) {
            this._logger.error(e, 'Can not handle message');
        }
    }

    async _getSailor(msg) {
        let sailor;
        const { taskId: flowId, stepId } = msg.properties.headers;
        assert(flowId && stepId, 'Incorrect message format, no taskId/stepId');
        try {
            this._sailors[flowId] = this._sailors[flowId] || {};
            if (this._sailors[flowId][stepId]) {
                return this._sailors[flowId][stepId];
            }
            const config = this._restoreExecContext(msg);
            const logger = new ComponentLogger(config); // FIXME defaults. Prooperly create it
            const communicationLayer = new AmqpCommunicationLayer(this._amqpConn, logger, config);
            const sailor = new Sailor(
                communicationLayer,
                logger,
                config
            );
            await sailor.prepare();
            /**
             * TODO skip atm. Generally it's possible to fetch data from api.
             * to handle if startup is requried.
             * Startup is requried if no hooks data and sailor supports startup hook
             * if (STARTUP_REQUERD)
             *     await sailor.startup();
             * }
            */
            await sailor.init();
            // NOTICE do not call sailor.run here.
            // message dispatching is done in different ways in MultiSailor and SingleSailor modes
            return this._sailors[flowId][stepId] = sailor;
        } catch (e) {
            sailor && sailor.reportError(e);
            // FIXME try to log error in context of current message
            throw e;
        }
    }

    _restoreExecContext(msg) {
        const manadatoryValues = Object.assign({}, this._config);
        manadatoryValues.FLOW_ID = msg.properties.headers.taskId;
        manadatoryValues.STEP_ID = msg.properties.headers.stepId;
        manadatoryValues.EXEC_ID = msg.properties.headers.execId;
        manadatoryValues.USER_ID = msg.properties.headers.userId;

        //// used by communication layer only
        //manadatoryValues.PUBLISH_MESSAGES_TO
        //manadatoryValues.DATA_ROUTING_KEY
        //manadatoryValues.ERROR_ROUTING_KEY
        //manadatoryValues.REBOUND_ROUTING_KEY
        //manadatoryValues.SNAPSHOT_ROUTING_KEY

        //manadatoryValues.CONTAINER_ID = //STUB randomize


        //manadatoryValues.WORKSPACE_ID = stepData.
        //manadatoryValues.COMP_ID = stepData.comp_id;
        //manadatoryValues.FUNCTION = stepData.function;


        //manadatoryValues.COMP_NAME = stepData.comp_name; // FIXME
        //manadatoryValues.EXEC_TYPE = 'flow-step'; // FIXME should match admiral ENV_VARS_CREATOR
        //manadatoryValues.FLOW_VERSION = stepData.flow_version; // FIXME
        //manadatoryValues.TENANT_ID = stepData.tenant_id
        //manadatoryValues.TASK_USER_EMAIL = stepData.XXXX
        //manadatoryValues.EXECUTION_RESULT_ID  = 'ZZZZ'// FIXME skip ATM one time execs
        return manadatoryValues;
    }
}
module.exports = MultiSailor;
