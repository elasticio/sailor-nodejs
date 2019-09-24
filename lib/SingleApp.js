const App = require('./App.js');

class SingleApp extends App {
    async _start() {
        const { ComponentLogger } = require('./logging.js');
        const Sailor = require('./sailor.js');
        const AmqpConnWrapper = require('./AmqpConnWrapper.js');
        const { AmqpCommunicationLayer } = require('./amqp.js');
        const { SingleSailorConfig } = require('./settings.js');

        this._config = SingleSailorConfig.fromEnv();
        this._logger = new ComponentLogger(this._config);
        this._amqpConn = new AmqpConnWrapper(this._config.AMQP_URI, this._logger);
        this._communicationLayer = new AmqpCommunicationLayer(this._amqpConn, this._config, this._logger);
        this._sailor = new Sailor(this._communicationLayer, this._config, this._logger);
        if (this._config.HOOK_SHUTDOWN) {
            await this._sailor.prepare();
            await this._sailor.shutdown();
            return;
        } else {
            await this._amqpConn.start();
            await this._sailor.prepare();

            if (this._config.STARTUP_REQUIRED) {
                await this._sailor.startup();
            }

            await this._sailor.init();
            await this._sailor.run();
        }
    }

    async _stop() {
        if (this._communicationLayer) {
            await this._communicationLayer.unlistenQueue();
        }
        if (this._amqpConn) {
            await this._amqpConn.stop();
            this._amqpConn = null;
        }
    }

    async _handleFatalError(error) {
        if (this._sailor && !this._config.HOOK_SHUTDOWN) {
            await this._sailor.reportError(error);
        }
    }

    _logError() {
        if (this._logger) {
            this._logger.error(...arguments);
        }
    }
}
module.exports = SingleApp;
