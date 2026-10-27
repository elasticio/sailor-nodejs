// eslint-disable-next-line @typescript-eslint/no-explicit-any -- listeners take whatever the component emits
export type Listener = (this: AwaitableEmitter, ...args: any[]) => unknown;

type Registered = Listener & { listener?: Listener };

/**
 * Event emitter whose `emit` awaits every listener in turn (replaces `lib/emitter.js`).
 * Components rely on `await this.emit('data', ...)` resolving after the message is sent.
 */
export class AwaitableEmitter {
    readonly #events = new Map<string, Registered[]>();

    on(name: string, fn: Listener): this {
        const list = this.#events.get(name);
        if (list) {
            list.push(fn);
        } else {
            this.#events.set(name, [fn]);
        }
        return this;
    }

    addListener(name: string, fn: Listener): this {
        return this.on(name, fn);
    }

    once(name: string, fn: Listener): this {
        const wrapper: Registered = function (this: AwaitableEmitter, ...args: unknown[]) {
            this.removeListener(name, wrapper);
            return fn.apply(this, args);
        };
        wrapper.listener = fn;
        return this.on(name, wrapper);
    }

    removeListener(name: string, fn: Listener): this {
        const list = this.#events.get(name);
        if (list) {
            const pos = list.findIndex(l => l === fn || l.listener === fn);
            if (pos >= 0) {
                list.splice(pos, 1);
            }
            if (!list.length) {
                this.#events.delete(name);
            }
        }
        return this;
    }

    removeAllListeners(name?: string): this {
        if (name === undefined) {
            this.#events.clear();
        } else {
            this.#events.delete(name);
        }
        return this;
    }

    listeners(name: string): Listener[] {
        return [...this.#events.get(name) ?? []];
    }

    /** Calls the listeners one after another, awaiting each. Resolves `false` when there were none. */
    async emit(name: string, ...args: unknown[]): Promise<boolean> {
        const list = this.#events.get(name);
        if (!list?.length) {
            return false;
        }
        for (const listener of [...list]) {
            await listener.apply(this, args);
        }
        return true;
    }
}
