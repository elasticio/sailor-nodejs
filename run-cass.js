const MultiSailor = require('./lib/Multisailor.js');
const AmqpConnWrapper = require('./lib/AmqpConnWrapper.js');
const { ContainerLogger } = require('./lib/logger.js');
const { MultisailorConfig } = require('./lib/settings.js');

(async () => {
    try {
        const config = MultisailorConfig.fromEnv();
        const logger = new ContainerLogger(config);
        process.on('uncaughtException', (e) => {
            console.error('Uncaught exception', e);
            logger.error(e, 'Uncaught exception');
            process.exit(2);
        });
        process.on('unhandledRejection', (e) => {
            console.error('unhandled rejection', e);
            logger.error(e, 'unhandled rejection');
            process.exit(3);
        });

        const amqpConn = new AmqpConnWrapper(config.get('AMQP_URI'));
        const multiSailor = new MultiSailor(amqpConn, logger, config);
        await amqpConn.start();
        await multiSailor.start();
        const gracefulShutdown = async () => {
            await multiSailor.stop();
            await amqpConn.stop();
        };
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
    } catch (e) {
        console.error('Failed to start', e);
        process.exit(2);
    }
})();
