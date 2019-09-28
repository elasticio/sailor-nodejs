const amqplib = require('amqplib');
// FIXME TESTS
class AmqpConnWrapper {
    constructor(amqpUri, logger) {
        this._logger = logger;
        this._amqpUri = amqpUri;
    }
    async start() {
        // FIXME safety for double calls
        // TODO handle channel errors. Recoonect????
        this._amqp = await amqplib.connect(this._amqpUri);
        // FIXME
        // this.amqp.on('error', this._logger.criticalerrorandExit);
        // this.amqp.on('close', this._logger.criticalerrorandExit);
        this._logger.debug('Connected to amqp');

        this._subscribeChannel = await this._amqp.createChannel();
        // FIXME
        // this.subscribeChannel.on('error', this._logger.criticalErrorAndExit);
        this._logger.debug('Opened subscribe channel');

        this._publishChannel = await this._amqp.createConfirmChannel();
        // FIXME
        // this.publishChannel.on('error', this._logger.criticalErrorAndExit);
        this._logger.debug('Opened publish channel');
    }
    async stop() {
        // FIXME safety for double calls
        this._logger.trace('Close AMQP connections');
        try {
            await this._subscribeChannel.close();
        } catch (alreadyClosed) {
            this._logger.debug('Subscribe channel is closed already');
        }
        try {
            await this._publishChannel.close();
        } catch (alreadyClosed) {
            this._logger.debug('Publish channel is closed already');
        }
        try {
            await this._amqp.close();
        } catch (alreadyClosed) {
            this._logger.debug('AMQP connection is closed already');
        }
        this._logger.debug('Successfully closed AMQP connections');
    }
    getPublishChannel() {
        return this._publishChannel;
    }
    getSubscribeChannel() {
        return this._subscribeChannel;
    }
}
module.exports = AmqpConnWrapper;
