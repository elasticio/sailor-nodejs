/**
 * Entrypoint for starting task step. Thin shim into dist/ (D2).
 */
import { main } from './dist/entrypoints/run.js';

export { run, putOutToSea, addProcessListeners, IPC, __test__ } from './dist/entrypoints/run.js';

if (import.meta.main) {
    main();
}
