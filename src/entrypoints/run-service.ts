import logging from '../logging/index.ts';
import { processService } from '../service/index.ts';

/** What `node runService.js <method>` does: run the service method, exit 0, or exit 1 on failure. */
export async function main(serviceMethod = process.argv[2] ?? ''): Promise<void> {
    process.on('uncaughtException', err => logging.criticalErrorAndExit('process.uncaughtException', err));
    process.on('unhandledRejection', err => logging.error(err, 'process.unhandledRejection'));

    logging.trace('About to execute %s', serviceMethod);
    try {
        await processService(serviceMethod, process.env);
    } catch (err) {
        logging.criticalErrorAndExit('processService.catch', err);
    }
    process.exit(0);
}

if (import.meta.main) {
    void main();
}
