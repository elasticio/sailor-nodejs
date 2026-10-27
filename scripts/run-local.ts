/**
 * Runs the sailor against a local sailor-proxy with env from `config/local.json`.
 * Usage: `npm run dev:local`
 */
import config from '../config/local.json' with { type: 'json' };

for (const [key, value] of Object.entries(config)) {
    process.env[key] = String(value);
}

// Imported after the env is set: logging reads `LOG_LEVEL` on load.
const { main } = await import('../src/entrypoints/run.ts');
main();
