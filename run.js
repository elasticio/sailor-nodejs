//const { ComponentLogger } = require('./lib/logging.js');
//const Sailor = require('./lib/sailor.js');
//const AmqpConnWrapper = require('./lib/AmqpConnWrapper.js');
//const { AmqpCommunicationLayer } = require('./lib/amqp.js');
//const { SingleSailorConfig } = require('./lib/settings.js');
//
//(async () => {
//    let sailor;
//    try {
//        const config = SingleSailorConfig.fromEnv();
//        const logger = new ComponentLogger(config);
//        process.on('uncaughtException', (e) => {
//            console.error('Uncaught exception', e);
//            logger.error(e, 'Uncaught exception');
//            process.exit(2);
//        });
//        process.on('unhandledRejection', (e) => {
//            console.error('unhandled rejection', e);
//            logger.error(e, 'unhandled rejection');
//            process.exit(3);
//        });
//
//        const amqpConn = new AmqpConnWrapper(config.AMQP_URI, logger);
//        await amqpConn.start();
//        const communicationLayer = new AmqpCommunicationLayer(amqpConn, config, logger);
//        sailor = new Sailor(communicationLayer, config, logger);
//        const gracefulShutdown = async () => {
//            logger.info('Got signal, graceful shutdown');
//            await amqpConn.stop();
//            process.exit(0);
//        };
//        process.on('SIGTERM', gracefulShutdown);
//        process.on('SIGINT', gracefulShutdown);
//        // FIXME pack all this shit into inside sailor
//        // FIXME optimization. There is no need to connect to amqp if it's shutdown hook,
//        // or it event may be not possible: no env vars
//        if (config.HOOK_SHUTDOWN) {
//            //eslint-disable-next-line no-empty-function
//            sailor.reportError = () => {
//            };
//            await sailor.prepare();
//            await sailor.shutdown();
//            return;
//        }
//
//        await amqpConn.start();
//        await sailor.prepare();
//
//        if (config.STARTUP_REQUIRED) {
//            await sailor.startup();
//        }
//
//        await sailor.init();
//        console.log('call sailor run');
//        await sailor.run();
//    } catch (e) {
//        console.error('Failed to start', e);
//        sailor && sailor.reportError(e);
//        process.exit(2);
//    }
//})();
const SingleApp = require('./lib/SingleApp.js');
const app = new SingleApp();
app.stop();
