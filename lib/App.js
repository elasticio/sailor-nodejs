class App {
    /**
     * Start application
     * Implemented as SAFE in terms of exception
     */
    async start() {
        process.on('uncaughtException', (e) => {
            try {
                this._safeLogError(e, 'Uncaught exception');
                this._safeFatalErrorHook(e);
            } catch (error) {
                console.error('Error handling uncaught exception', error);
            } finally {
                process.exit(this.constructor.EXIT_CODES.UNCAUGHT_EXCEPTION);
            }
        });
        process.on('unhandledRejection', (e) => {
            try {
                this._safeLogError(e, 'Uncaught rejection');
                this._safeFatalErrorHook(e);
            } catch (error) {
                console.error('Error handling uncaught rejection', error);
            } finally {
                process.exit(this.constructor.EXIT_CODES.UNCAUGHT_REJECTION);
            }
        });
        process.on('SIGTERM', this.stop.bind(this));
        process.on('SIGINT', this.stop.bind(this));

        try {
            await this._start();
        } catch (e) {
            this._safeLogError(e, 'Failed to start');
            this._safeFatalErrorHook(e);
            process.exit(this.constructor.EXIT_CODES.FAILED_TO_START);
        }
    }

    /**
     * Gracefully stop application.
     * part of standard shutdown procedure
     * Implemented as SAFE in terms of exception
     */
    async stop() {
        try {
            await this._stop();
        } catch (e) {
            this._safeLogError(e, 'Failed to stop gracefully');
            process.exit(this.constructor.EXIT_CODES.FAILED_TO_STOP);
        } finally {
            // FIXME unsubscribe more preciesly
            process.removeAllListeners('SIGTERM');
            process.removeAllListeners('SIGINT');
            process.removeAllListeners('uncaughtException');
            process.removeAllListeners('unhandledRejection');
        }
    }

    /**
     * Start procedure implementation.
     * Not safe in terms of exceptions. May throw.
     * In case of error, exception will be caught, logged
     * and process will be destroyed in "cruel" way
     */
    _start() {
        throw new Error('implement me');
    }

    /**
     * Graceful stop procedure implementation.
     * Not safe in terms of exceptions. May throw.
     * In case of error, exception will be caught, logged
     * and process will be destroyed in "cruel" way
     */
    _stop() {
        throw new Error('implement me');
    }

    _logError() {
        throw new Error('implement me');
    }

    async _handleFatalError() {
        throw new Error('implement me');
    }

    _safeLogError() {
        console.error(...arguments);
        try {
            this._logError(...arguments);
        } catch (e) {
            console.error('Uncaught rejection', e);
        }
    }

    _safeFatalErrorHook() {
        try {
            this._handleFatalError(...arguments);
        } catch (e) {
            this._safeLogError(e, 'Uncaught rejection');
        }
    }

    static get EXIT_CODES() {
        return {
            SUCCESS: 0,
            FAILED_TO_START: 1,
            FAILED_TO_STOP: 2,
            UNCAUGHT_EXCEPTION: 3,
            UNCAUGHT_REJECTION: 4
        };
    }
}
module.exports = App;
