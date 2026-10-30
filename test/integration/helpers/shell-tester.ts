import { EventEmitter } from 'node:events';
import cp, { type ChildProcess, type ForkOptions } from 'node:child_process';

export interface ShellTesterOptions {
    timeout?: number;
    filename?: string;
    env?: NodeJS.ProcessEnv;
    args?: string[];
}

export interface ExitResult {
    code: number | null;
    signal: NodeJS.Signals | null;
}

/** Forks a sailor entrypoint, waits for its IPC events and exit, and can kill it with a signal. */
export class ShellTester extends EventEmitter {
    static readonly TIMEOUT_DEFAULT = 5000;

    readonly #filename: string;
    readonly #args: string[];
    readonly #env: NodeJS.ProcessEnv;
    readonly #promise: Promise<ExitResult>;
    #resolve!: (v: ExitResult) => void;
    #reject!: (e: Error) => void;
    #settled = false;
    #timeoutTimer: NodeJS.Timeout;
    #fork: ChildProcess | undefined;
    #exitResult: ExitResult | null = null;

    constructor({
        timeout = ShellTester.TIMEOUT_DEFAULT, filename = 'run.js', env = process.env, args = []
    }: ShellTesterOptions = {}) {
        super();
        this.#filename = filename;
        this.#args = args;
        this.#env = env;
        this.#promise = new Promise<ExitResult>((resolve, reject) => {
            this.#resolve = (v) => {
                if (!this.#settled) {
                    this.#settled = true;
                    resolve(v);
                }
            };
            this.#reject = (e) => {
                if (!this.#settled) {
                    this.#settled = true;
                    reject(e);
                }
            };
        });
        this.#timeoutTimer = setTimeout(() => this.#reject(new Error('ShellTester timeout')), timeout);
    }

    static init(options?: ShellTesterOptions): ShellTester {
        return new ShellTester(options);
    }

    run(): void {
        // To see the child's output, pass `stdio: ['ipc', fd, fd]` here with files opened for appending.
        const options: ForkOptions = { env: this.#env };
        this.#fork = cp.fork(this.#filename, this.#args, options);
        this.#fork.on('exit', (code, signal) => this.#onExit(code, signal));
    }

    waitForEvent(waitEvent: string): Promise<unknown> {
        const fork = this.#requireFork();
        return new Promise((resolve) => {
            const handler = (message: unknown) => {
                const { event, data } = (message ?? {}) as { event?: string; data?: unknown };
                if (event === waitEvent) {
                    fork.off('message', handler);
                    resolve(data);
                }
            };
            fork.on('message', handler);
        });
    }

    sendKill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
        return this.#requireFork().kill(signal);
    }

    getPromise(): Promise<ExitResult> {
        return this.#promise;
    }

    getExitResult(): ExitResult | null {
        return this.#exitResult;
    }

    #onExit(code: number | null, signal: NodeJS.Signals | null): void {
        this.#exitResult = { code, signal };
        this.emit('exit', this.#exitResult);
        clearTimeout(this.#timeoutTimer);
        if (code !== 0) {
            this.#reject(new Error(`Exited with an error code: ${code}`));
        } else {
            this.#resolve(this.#exitResult);
        }
    }

    #requireFork(): ChildProcess {
        if (!this.#fork) {
            throw new Error('ShellTester: run() was not called');
        }
        return this.#fork;
    }
}
