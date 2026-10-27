import { expect } from 'chai';
import { PROXY_CLIENT_ID, readFrom, readServiceSettings, type Env } from '../../../src/settings/index.ts';

const MANDATORY: Record<string, string> = {
    ELASTICIO_FLOW_ID: 'flow',
    ELASTICIO_EXEC_ID: 'exec',
    ELASTICIO_STEP_ID: 'step',
    ELASTICIO_CONTAINER_ID: 'container',
    ELASTICIO_WORKSPACE_ID: 'workspace',
    ELASTICIO_USER_ID: 'user',
    ELASTICIO_COMP_ID: 'comp',
    ELASTICIO_FUNCTION: 'fn',
    ELASTICIO_API_URI: 'http://api',
    ELASTICIO_API_USERNAME: 'name',
    ELASTICIO_API_KEY: 'key',
    ELASTICIO_SAILOR_PROXY_JWT_SECRET: 'secret',
    ELASTICIO_OUTGOING_MESSAGE_SIZE_LIMIT: '10485760',
    ELASTICIO_SAILOR_PROXY_URI: 'http://proxy',
    ELASTICIO_MESSAGE_CRYPTO_PASSWORD: 'pass',
    ELASTICIO_MESSAGE_CRYPTO_IV: 'iv'
};

const env = (extra: Env = {}): Env => ({ ...MANDATORY, ...extra });

describe('settings', () => {
    describe('readFrom', () => {
        for (const name of Object.keys(MANDATORY)) {
            it(`throws when ${name} is missing`, () => {
                expect(() => readFrom(env({ [name]: undefined }))).to.throw(`${name} is missing`);
            });
        }

        it('throws when a mandatory var is empty', () => {
            expect(() => readFrom(env({ ELASTICIO_FLOW_ID: '' }))).to.throw('ELASTICIO_FLOW_ID is missing');
        });

        it('relaxes message processing vars when HOOK_SHUTDOWN is set', () => {
            const settings = readFrom(env({
                ELASTICIO_HOOK_SHUTDOWN: 'true',
                ELASTICIO_SAILOR_PROXY_URI: undefined,
                ELASTICIO_MESSAGE_CRYPTO_PASSWORD: undefined,
                ELASTICIO_MESSAGE_CRYPTO_IV: undefined
            }));
            expect(settings.HOOK_SHUTDOWN).to.equal(true);
            expect(settings.SAILOR_PROXY_URI).to.equal('');
        });

        it('B3: HOOK_SHUTDOWN=false does not relax the required list', () => {
            expect(() => readFrom(env({ ELASTICIO_HOOK_SHUTDOWN: 'false', ELASTICIO_MESSAGE_CRYPTO_IV: undefined })))
                .to.throw('ELASTICIO_MESSAGE_CRYPTO_IV is missing');
        });

        it('returns defaults', () => {
            const s = readFrom(env());
            expect(s).to.deep.include({
                FLOW_ID: 'flow',
                COMPONENT_PATH: '',
                PROXY_PREFETCH_SAILOR: 1,
                STARTUP_REQUIRED: false,
                HOOK_SHUTDOWN: false,
                API_REQUEST_RETRY_ATTEMPTS: 3,
                API_REQUEST_RETRY_DELAY: 100,
                PROXY_RECONNECT_MAX_RETRIES: Infinity,
                PROXY_RECONNECT_INITIAL_DELAY: 1000,
                PROXY_RECONNECT_MAX_DELAY: 30000,
                PROXY_RECONNECT_BACKOFF_MULTIPLIER: 2,
                PROXY_RECONNECT_JITTER_FACTOR: 0.3,
                PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS: Infinity,
                PROXY_OBJECT_REQUEST_RETRY_DELAY: 100,
                PROXY_OBJECT_REQUEST_MAX_RETRY_DELAY: 300000,
                PROXY_PING_INTERVAL_MS: 10000,
                DATA_RATE_LIMIT: 10,
                ERROR_RATE_LIMIT: 2,
                SNAPSHOT_RATE_LIMIT: 2,
                RATE_INTERVAL: 100,
                OBJECT_STORAGE_SIZE_THRESHOLD: 1048576,
                OBJECT_STORAGE_RETRY_ATTEMPTS: 2,
                OBJECT_STORAGE_REQUEST_TIMEOUT: 10000,
                NO_SELF_PASSTHROUGH: false,
                PROTOCOL_VERSION: 1,
                INPUT_FORMAT: 'default',
                EMIT_LIGHTWEIGHT_MESSAGE: false,
                OBJECT_STORAGE_URI: null,
                OBJECT_STORAGE_TOKEN: null,
                additionalVars: undefined,
                PROXY_CLIENT_ID
            });
        });

        it('B1: parses mandatory numbers', () => {
            expect(readFrom(env()).OUTGOING_MESSAGE_SIZE_LIMIT).to.equal(10485760);
            expect(() => readFrom(env({ ELASTICIO_OUTGOING_MESSAGE_SIZE_LIMIT: 'big' })))
                .to.throw('ELASTICIO_OUTGOING_MESSAGE_SIZE_LIMIT must be a number');
            expect(() => readFrom(env({ ELASTICIO_OUTGOING_MESSAGE_SIZE_LIMIT: '0' })))
                .to.throw('ELASTICIO_OUTGOING_MESSAGE_SIZE_LIMIT must be >= 1');
        });

        describe('B2: optional numbers', () => {
            it('honours 0 where allowed', () => {
                expect(readFrom(env({ ELASTICIO_API_REQUEST_RETRY_ATTEMPTS: '0' })).API_REQUEST_RETRY_ATTEMPTS)
                    .to.equal(0);
            });
            it('rejects values below the minimum', () => {
                expect(() => readFrom(env({ ELASTICIO_DATA_RATE_LIMIT: '0' })))
                    .to.throw('ELASTICIO_DATA_RATE_LIMIT must be >= 1');
            });
            it('rejects values above the maximum', () => {
                expect(() => readFrom(env({ ELASTICIO_OBJECT_STORAGE_RETRY_ATTEMPTS: '5' })))
                    .to.throw('ELASTICIO_OBJECT_STORAGE_RETRY_ATTEMPTS must be <= 4');
                expect(readFrom(env({ ELASTICIO_OBJECT_STORAGE_RETRY_ATTEMPTS: '4' })).OBJECT_STORAGE_RETRY_ATTEMPTS)
                    .to.equal(4);
            });
            it('throws on garbage', () => {
                expect(() => readFrom(env({ ELASTICIO_RATE_INTERVAL: '10ms' })))
                    .to.throw('ELASTICIO_RATE_INTERVAL must be a number');
            });
            it('rejects fractions for integers, accepts them for floats', () => {
                expect(() => readFrom(env({ ELASTICIO_RATE_INTERVAL: '1.5' })))
                    .to.throw('ELASTICIO_RATE_INTERVAL must be an integer');
                expect(readFrom(env({ ELASTICIO_PROXY_RECONNECT_JITTER_FACTOR: '0.5' })).PROXY_RECONNECT_JITTER_FACTOR)
                    .to.equal(0.5);
            });
            it('accepts Infinity', () => {
                expect(readFrom(env({ ELASTICIO_PROXY_RECONNECT_MAX_RETRIES: 'Infinity' })).PROXY_RECONNECT_MAX_RETRIES)
                    .to.equal(Infinity);
            });
            it('empty means default', () => {
                expect(readFrom(env({ ELASTICIO_DATA_RATE_LIMIT: '' })).DATA_RATE_LIMIT).to.equal(10);
            });
            it('accepts non-string values in a plain env object', () => {
                const extra = { ELASTICIO_PROTOCOL_VERSION: 2, ELASTICIO_STARTUP_REQUIRED: true } as unknown as Env;
                const s = readFrom(env(extra));
                expect(s.PROTOCOL_VERSION).to.equal(2);
                expect(s.STARTUP_REQUIRED).to.equal(true);
            });
        });

        describe('B3: optional booleans', () => {
            for (const [value, expected] of [['true', true], ['TRUE', true], ['1', true],
                ['false', false], ['False', false], ['0', false], ['', false]] as const) {
                it(`"${value}" → ${expected}`, () => {
                    expect(readFrom(env({ ELASTICIO_STARTUP_REQUIRED: value })).STARTUP_REQUIRED).to.equal(expected);
                });
            }
            it('throws on anything else', () => {
                expect(() => readFrom(env({ ELASTICIO_STARTUP_REQUIRED: 'no' })))
                    .to.throw('ELASTICIO_STARTUP_REQUIRED must be one of true, false, 1, 0');
            });
        });

        it('B4: reads NO_SELF_PASSTHROUGH and ignores the misspelled name', () => {
            expect(readFrom(env({ ELASTICIO_NO_SELF_PASSTHROUGH: 'true' })).NO_SELF_PASSTHROUGH).to.equal(true);
            expect(readFrom(env({ ELASTICIO_NO_SELF_PASSTRHOUGH: 'true' })).NO_SELF_PASSTHROUGH).to.equal(false);
        });

        it('reads optional strings', () => {
            const s = readFrom(env({ ELASTICIO_COMPONENT_PATH: '/comp', ELASTICIO_OBJECT_STORAGE_URI: 'http://m' }));
            expect(s.COMPONENT_PATH).to.equal('/comp');
            expect(s.OBJECT_STORAGE_URI).to.equal('http://m');
        });

        it('reads ADDITIONAL_VARS_FOR_HEADERS', () => {
            const s = readFrom(env({
                ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS: 'ELASTICIO_FOO, BAR ,ELASTICIO_MISSING',
                ELASTICIO_FOO: 'foo',
                BAR: 'bar'
            }));
            expect(s.additionalVars).to.deep.equal({ FOO: 'foo', BAR: 'bar', MISSING: undefined });
        });
    });

    describe('readServiceSettings (B5)', () => {
        it('returns defaults and nulls', () => {
            expect(readServiceSettings({})).to.deep.equal({
                POST_RESULT_URL: null,
                CFG: null,
                ACTION_OR_TRIGGER: null,
                GET_MODEL_METHOD: null,
                COMPONENT_PATH: '',
                API_URI: null,
                API_USERNAME: null,
                API_KEY: null,
                API_REQUEST_RETRY_ATTEMPTS: 3,
                API_REQUEST_RETRY_DELAY: 100,
                PROXY_CLIENT_ID
            });
        });
        it('parses retry settings strictly', () => {
            expect(readServiceSettings({ ELASTICIO_API_REQUEST_RETRY_ATTEMPTS: '5' }).API_REQUEST_RETRY_ATTEMPTS)
                .to.equal(5);
            expect(() => readServiceSettings({ ELASTICIO_API_REQUEST_RETRY_DELAY: 'x' }))
                .to.throw('ELASTICIO_API_REQUEST_RETRY_DELAY must be a number');
        });
    });
});
