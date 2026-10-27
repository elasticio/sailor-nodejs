/** Node-style callback handed to component functions as their last argument. */
export type LegacyCallback<T = unknown> = (err?: unknown, result?: T) => void;

/**
 * Calls a component function (`verifyCredentials`, model methods) that may answer either way:
 * through the callback appended to `args`, or by returning a truthy value / promise.
 * Whichever comes first wins. A sync throw or a rejected promise rejects.
 * A function that returns a falsy value and never calls back never settles (as before).
 */
export function callComponentFunction<T = unknown>(
    fn: (...args: never[]) => unknown,
    thisArg: unknown,
    ...args: unknown[]
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const callback: LegacyCallback<T> = (err, result) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(result as T);
        };
        const result = (fn as (...a: unknown[]) => unknown).call(thisArg, ...args, callback);
        if (result) {
            resolve(result as T | PromiseLike<T>);
        }
    });
}
