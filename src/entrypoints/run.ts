import http from 'node:http';
import https from 'node:https';
import logging from '../logging/index.ts';
import { readFrom, type Settings } from '../settings/index.ts';
import { Sailor, createSailor } from '../sailor.ts';

/** Sends events to the parent process, when there is one (`init:started`, `init:ended`). */
export class IPC {
    send(event: string, data?: unknown): void {
        process.send?.({ event, data });
    }
}

let sailor: Sailor | undefined;
let sailorInit: Promise<void> | undefined;
let disconnectRequired = false;

function prepareSandbox(): void {
    // keep-alive by default, see https://github.com/elasticio/elasticio/issues/4874
    http.globalAgent = new http.Agent({ keepAlive: true });
    https.globalAgent = new https.Agent({ keepAlive: true });
}

/**
 * connect → prepare → startup (if `STARTUP_REQUIRED`) → init → listen.
 * `HOOK_SHUTDOWN`: prepare → shutdown hook only.
 */
export async function putOutToSea(
    settings: Settings, ipc: IPC, instance: Sailor = createSailor(settings)
): Promise<void> {
    logging.trace({ settings }, 'putOutToSea called');
    ipc.send('init:started');
    const init = Promise.withResolvers<void>();
    sailorInit = init.promise;
    sailor = instance;

    if (settings.HOOK_SHUTDOWN) {
        logging.trace('Running hook shutdown');
        disconnectRequired = false;
        sailor.reportError = async () => {};
        await sailor.prepare();
        await sailor.runHookShutdown();
        return;
    }

    disconnectRequired = true;
    await sailor.connect();
    await sailor.prepare();

    if (settings.STARTUP_REQUIRED) {
        await sailor.startup();
    }

    await sailor.runHookInit();
    init.resolve();
    ipc.send('init:ended');

    await sailor.run();
}

/** Waits for init, lets in-flight messages finish, disconnects, exits 0. Failure exits 1 (B9). */
async function gracefulShutdown(): Promise<void> {
    if (!disconnectRequired) {
        return;
    }
    if (!sailor) {
        logging.warn('Something went wrong – sailor is falsy');
        return;
    }

    logging.trace('Checking/waiting for init before graceful shutdown');
    await sailorInit;
    logging.trace('Waited an init before graceful shutdown');

    try {
        logging.info('Scheduling shutdown...');
        await sailor.scheduleShutdown();
        logging.info('Finished shutdown. Disconnecting...');
        await sailor.disconnect();
        logging.info('Successfully disconnected');
        process.exit(0);
    } catch (err) {
        logging.error(err, 'Unable to disconnect');
        process.exit(1);
    }
}

export async function run(settings: Settings, ipc: IPC, instance?: Sailor): Promise<void> {
    prepareSandbox();
    try {
        await putOutToSea(settings, ipc, instance);
    } catch (e) {
        if (sailor?.isConnected()) {
            await sailor.reportError(e as Error);
        }
        logging.criticalErrorAndExit('putOutToSea.catch', e);
    }
}

export function addProcessListeners(): void {
    process.on('SIGTERM', () => {
        logging.info('Received SIGTERM');
        void gracefulShutdown();
    });
    process.on('SIGINT', () => {
        logging.info('Received SIGINT');
        void gracefulShutdown();
    });
    process.on('uncaughtException', err => logging.criticalErrorAndExit('process.uncaughtException', err));
    process.on('unhandledRejection', err => logging.error(err, 'process.unhandledRejection'));
}

/** What `node run.js` does. */
export function main(): void {
    addProcessListeners();
    void run(readFrom(process.env), new IPC());
}

if (import.meta.main) {
    main();
}
