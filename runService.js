/**
 * Entrypoint for starting service which will handle verifyCredentials and selectModel requests.
 * Thin shim into dist/ (D2).
 */
import { main } from './dist/entrypoints/run-service.js';

if (import.meta.main) {
    void main();
}
