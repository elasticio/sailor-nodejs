import { Readable } from 'node:stream';
import { ObjectStorage } from '@elastic.io/maester-client';
import logging from '../logging/index.ts';
import type { Encryptor } from '../crypto/index.ts';
import type { Settings } from '../settings/index.ts';

/** Header carrying the Maester object id of a lightweight message body. */
export const OBJECT_ID_HEADER = 'x-ipaas-object-storage-id';

/** Component or sailor (bunyan) logger. */
export interface StorageLogger {
    info(msg: string, ...args: unknown[]): unknown;
    trace(msg: string, ...args: unknown[]): unknown;
}

export interface MessageWithBody {
    body?: unknown;
    headers?: Record<string, unknown> | null;
}

interface RequestOptions {
    jwtPayloadOrToken?: string;
    retryOptions?: RetryOptions;
}

/** The subset of maester-client's `ObjectStorage` used here (injectable for tests). */
export interface ObjectStore {
    getOne(objectId: string, options: RequestOptions): Promise<{ data: unknown }>;
    add(data: () => Promise<Readable>, options: RequestOptions): Promise<string>;
}

/** maester-client's `RetryOptions`: it retries 5xx/network errors with its own backoff. */
export interface RetryOptions {
    readonly retriesCount: number;
    readonly requestTimeout: number;
}

/**
 * Lightweight message bodies, stored directly in Maester (D10), encrypted with the
 * message Encryptor. Retries are maester-client's, configured by
 * `OBJECT_STORAGE_RETRY_ATTEMPTS` and `OBJECT_STORAGE_REQUEST_TIMEOUT`.
 */
export class MessageStorage {
    readonly #store: ObjectStore;
    readonly #token: string | undefined;
    readonly #retryOptions: RetryOptions;

    constructor(store: ObjectStore, token: string | undefined, retryOptions: RetryOptions) {
        this.#store = store;
        this.#token = token;
        this.#retryOptions = retryOptions;
    }

    static create(settings: Settings, encryptor: Encryptor): MessageStorage {
        const store = new ObjectStorage({
            uri: settings.OBJECT_STORAGE_URI!,
            jwtSecret: settings.OBJECT_STORAGE_TOKEN ?? undefined
        }).use(() => encryptor.createCipher(), () => encryptor.createDecipher());
        return new MessageStorage(store, settings.OBJECT_STORAGE_TOKEN ?? undefined, {
            retriesCount: settings.OBJECT_STORAGE_RETRY_ATTEMPTS,
            requestTimeout: settings.OBJECT_STORAGE_REQUEST_TIMEOUT
        });
    }

    /** Returns the message body, fetching it from Maester when the message is lightweight. */
    async fetchMessageBody(message: MessageWithBody, logger: StorageLogger): Promise<unknown> {
        const { body, headers } = message;

        logger.info('Checking if incoming messages is lightweight...');

        if (!headers) {
            logger.info('Empty headers so not lightweight.');
            return body;
        }

        const objectId = headers[OBJECT_ID_HEADER] as string | undefined;

        if (!objectId) {
            logger.trace('No object id header so not lightweight.');
            return body;
        }

        logger.info('Object id header found, message is lightweight.', { objectId });
        logger.info('Going to fetch message body.', { objectId });

        let object;
        try {
            object = await this.#store.getOne(objectId, this.#requestOptions());
        } catch (e) {
            logging.error(e);
            throw new Error(`Failed to get message body with id=${objectId}`);
        }

        logger.info('Successfully obtained message body.', { objectId });
        logger.trace('Message body object received');

        return object.data;
    }

    /** Uploads a serialised body; resolves with the Maester object id. */
    async uploadMessageBody(bodyBuf: Buffer): Promise<string> {
        return this.#store.add(async () => Readable.from(bodyBuf), this.#requestOptions());
    }

    #requestOptions(): RequestOptions {
        return { jwtPayloadOrToken: this.#token, retryOptions: this.#retryOptions };
    }
}
