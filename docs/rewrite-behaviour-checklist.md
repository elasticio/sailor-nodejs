# Rewrite behaviour checklist

Items marked 🔧 change on purpose: see D14 (B1–B9) in the
[plan](typescript-rewrite-plan.md). Test the **new** behaviour for those.

Everything the old `lib/` does, which the TS rewrite must keep doing. Built from reading `lib/`, `run.js`,
`runService.js` and the existing specs at commit `a27eb67`. Tick each item once a new unit or
integration test covers it.

## Baseline (Phase 0, step 1)

Node 18.16.1 (local) · `npm ci && npm test` → exit 0.
- jasmine `spec/`: 47 tests, 139 assertions, 0 failures.
- mocha `mocha_spec/`: 141 passing, 3 pending:
  - `should shutdown after processing of the last message`
  - `should not execute shutdown hook`
  - `should not thrown error and just finish process`

Specs that import internals: `mocha_spec/run.spec.js` (`lib/logging`, `lib/encryptor`, `lib/settings`,
`lib/sailor`, `lib/ipc`, spies on `Sailor.prototype`), `mocha_spec/integration_helpers/index.js`
(`lib/encryptor`), all `mocha_spec/unit/*` and `spec/*`. Fully black-box: `mocha_spec/graceful_shutdown.spec.js`.

## Settings (`lib/settings.js`)

- [ ] Mandatory always: `FLOW_ID EXEC_ID STEP_ID CONTAINER_ID WORKSPACE_ID USER_ID COMP_ID FUNCTION API_URI API_USERNAME API_KEY SAILOR_PROXY_JWT_SECRET OUTGOING_MESSAGE_SIZE_LIMIT` (all `ELASTICIO_`-prefixed); missing one throws `ELASTICIO_X is missing`.
- [ ] Also mandatory unless `ELASTICIO_HOOK_SHUTDOWN` is truthy: `SAILOR_PROXY_URI MESSAGE_CRYPTO_PASSWORD MESSAGE_CRYPTO_IV`.
- [ ] 🔧 B1 Mandatory values stay **strings** (e.g. `OUTGOING_MESSAGE_SIZE_LIMIT` is never parsed; it is compared with `>` and divided).
- [ ] 🔧 B2 Optional numbers: `parseInt(v) || default`, applied only when the env var is non-empty (so `"0"` → default).
- [ ] 🔧 B3 Optional booleans: unset → default; `""` or `"false"` → false; anything else → true.
- [ ] Optional strings/null: `v || default`.
- [ ] Defaults exactly as in `getOptionalEnvVars` (incl. `PROXY_RECONNECT_MAX_RETRIES` / `PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS` = `Infinity`).
- [ ] `ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS`: comma list, trimmed, `ELASTICIO_` prefix stripped from the key, value read from the full name; `additionalVars` is `undefined` if not set.
- [ ] `PROXY_CLIENT_ID`: one random UUID per process, shared by settings and the logger.

## Logging (`lib/logging.js`)

- [ ] bunyan logger `name: 'sailor'`, std serializers; level `LOG_LEVEL` or `info`; under `NODE_ENV=test` default is FATAL+1 (silent).
- [ ] Context fields: the 16 `ELASTICIO_*` env vars (only those set), `tag` = `ELASTICIO_FLOW_ID`, `PROXY_CLIENT_ID`.
- [ ] Logger methods are bound (can be passed around as bare functions).
- [ ] `criticalErrorAndExit(reason, err)`: Error → `fatal(err, reason)`, otherwise `fatal({err, reason}, 'Error happened')`; then `process.exit(1)`.
- [ ] `ComponentLogger(options)`: bunyan `name: 'component'`, same level and context + `options` (threadId/messageId/parentMessageId); a non-string first argument is coerced with `String()`; `child()` returns a logger decorated the same way.

## Encryptor (`lib/encryptor.js`)

- [ ] aes-256-cbc, key = sha256(password, utf-8), IV used as given.
- [ ] Password set but IV missing → throws.
- [ ] No password → plain text both ways (logs a warning on encrypt).
- [ ] `encryptMessageContent(payload, enc?)`: JSON.stringify → encrypt → if `enc`, `Buffer.from(buf.toString(enc))`.
- [ ] `decryptMessageContent(buf, enc?)`: empty/null → `null`; failure → throws `Failed to decrypt message: …`.
- [ ] `createCipher/createDecipher` are used by Maester as stream transforms.
- [ ] Ciphertext compatible with the old implementation (add a fixed-vector test).

## Component reader (`lib/component_reader.js`)

- [ ] Component path = `cwd + COMPONENT_PATH`; reads `component.json`; failure → `Failed to load component.json from <path>`.
- [ ] Definition lookup: triggers first, then actions; missing → `Trigger or action "<name>" is not found in component.json!`; `autoResolveObjectReferences` defaults to `true`.
- [ ] Load errors: `MODULE_NOT_FOUND` → `Failed to load file '<file>': <msg>`; other → `Trigger or action '<name>' is found, but can not be loaded. Please check if the file '<file>' is correct.`
- [ ] `verifyCredentials` loaded from `<component>/verifyCredentials`; if missing → stub that answers `{ verified: true }`.
- [ ] Module cache: the same module object is returned on every load (component module state survives between messages).

## Component calling convention

- [ ] Sailor does **not** run generator functions itself; components use their own `co`. A component function returning a generator object is not specially handled.
- [ ] `process.call(taskExec, msg, cfg, snapshot)`: a truthy return value is awaited; if it resolves truthy it is emitted as `data`; then `end`. A falsy return value means the component will emit `end` itself.
- [ ] A sync throw or rejection → `error` then `end`. A missing `process` → error `Process function is not found` + `end`.
- [ ] 🔧 B7 Hooks (`startup`, `init`, `shutdown`) are called as `module[fn](cfg, data)` **without** `this`; a missing hook logs a warning and resolves to `undefined`.
- [ ] `verifyCredentials`, `getMetaModel` and select-model methods: called with `this = ServiceExec`, `(cfg, callback)`; resolved by either the callback or a truthy return value.

## TaskExec / emitter (`lib/executor.js`, `lib/emitter.js`)

- [ ] `this.logger` (ComponentLogger), `getApiClient()`, `getConfig()` (the sailor settings object), `getFlowVariables()` (a copy of step variables, `{}` by default), `errorCount`.
- [ ] `emit` is async and awaits listeners **sequentially**; resolves `true`/`false` (whether there was a handler).
- [ ] `on/addListener/once/removeListener/listeners` work as in the custom emitter.

## Message processing (`lib/sailor.js`)

- [ ] `prepare`: `apiClient.tasks.retrieveStep(FLOW_ID, STEP_ID)`, keep `stepData` and `snapshot` (`{}` default), then init the component reader.
- [ ] `messagesCount` goes up when processing starts and down on the first `end`.
- [ ] Outgoing metadata = incoming metadata + snake_cased `additionalVars` + `parentMessageId` = incoming `messageId`, `threadId`, `execId`, `taskId`=FLOW_ID, `workspaceId`, `containerId`, `userId`, `stepId`, `compId`, `function`, `start`; `messageId` removed.
- [ ] Module load failure → `sendError` + `finishProcessing(error)`, no exec.
- [ ] `autoResolveObjectReferences` on: fetch the lightweight body and every passthrough body in parallel; failure → `sendError` + `finishProcessing(error)`.
- [ ] `cfg` and snapshot are deep-cloned per message; the original passthrough too.
- [ ] **data**: `data.id` → outgoing `messageId`; `end` timestamp; passthrough rules (`is_passthrough`, 🔧 B4 `NO_SELF_PASSTRHOUGH` puts the *incoming* message under the incoming `stepId`, otherwise the *outgoing* data goes under `STEP_ID`); `headers` defaults to `{}`; send `type: 'data'`; send failure → treated like an `error` emit.
- [ ] Lightweight outgoing (`EMIT_LIGHTWEIGHT_MESSAGE`): total size = body + passthrough bodies; above `OBJECT_STORAGE_SIZE_THRESHOLD` upload them (re-using an existing passthrough object id), replace the body with `{}` and set the `x-ipaas-object-storage-id` header; an upload failure → error `Lightweight message/passthrough body upload error`.
- [ ] Lightweight disabled: download any passthrough body that is empty.
- [ ] **error**: `formatError` (Error-like → `{message, stack||'Not Available', name||'Error'}`; otherwise `{message: err||'Not Available', …}`), `errorCount++`, `end` timestamp, `sendError(err, meta, payload, metadata)`.
- [ ] **rebound**: formatted error → `sendRebound` (sets `end`, `reboundReason`).
- [ ] **snapshot**: replace the local snapshot, send with `snapshotEvent: 'snapshot'`.
- [ ] **updateSnapshot**: only plain objects; `$set` → warn and ignore; merge into the local snapshot; send with `snapshotEvent: 'updateSnapshot'`; a non-object → log an error.
- [ ] **updateKeys**: `apiClient.accounts.update(cfg._account, { keys })`; failure → error emit.
- [ ] **httpReply**: `sendMessage type 'http-reply'` (protocol v1).
- [ ] **customType** `{type, payload, protocolVersion=2}` → `sendMessage` with a forced protocol version.
- [ ] **end**: only the first one counts (later ones warn); `finishProcessing(error if errorCount>0 else success)`.
- [ ] `processMessageAndMaybeShutdownCallback`: catches and logs everything; after each message, if shutdown is scheduled and `messagesCount === 0`, resolve it.
- [ ] 🔧 B11 `scheduleShutdown`: if already scheduled, replace the callback (new: return the same promise); else `stopListeningForMessages`, resolve now if idle, otherwise when the last message ends.
- [ ] `reportError`: base metadata (no message) + `sendError`.

## Hooks (`lib/sailor.js`, `lib/hooksData.js`)

- [ ] `startup`: result → `POST {API_URI}/sailor-support/hooks/task/{FLOW_ID}/startup/data` (empty result → `{}`); 409 → warn, DELETE, POST again (🔧 B8 with the raw result); other errors rethrown.
- [ ] `init`: called before listening; its failure is fatal.
- [ ] `shutdown` (`HOOK_SHUTDOWN` mode): no proxy connection, GET startup data → `shutdown(cfg, data)` → DELETE; `reportError` is a no-op.
- [ ] Hooks-data HTTP: basic auth, `Connection: Keep-Alive`, retries via `axiosReqWithRetryOnServerError` (`API_REQUEST_RETRY_*`), status ≥400 → `Error(body.error)` with `statusCode`.

## Proxy client (`lib/proxy-client.js`)

- [ ] Constructor fails without `PROXY_CLIENT_ID`, `API_USERNAME/API_KEY`, `SAILOR_PROXY_JWT_SECRET`.
- [ ] JWT (HS256 default) payload: `username password stepId clientId execId containerId workspaceId userId compId function`; `authorization: Bearer <jwt>` on every request.
- [ ] Session `maxSessionMemory = max(10, ceil(OUTGOING_MESSAGE_SIZE_LIMIT MB × 1.2))`.
- [ ] Reconnect on session `error`/`close`/`goaway`/`timeout`/PING failure (unless closed): kill message streams, destroy the session, backoff `min(initial × mult^(n-1), max)` ± jitter; after success: reset attempts, restart PING, call `resumeProcessing`; when max retries are used up → `closed = true` (health check fails).
- [ ] PING every `PROXY_PING_INTERVAL_MS`.
- [ ] `isHealthy()` is true while reconnecting; `isConnected()` = not closed and the session is alive.
- [ ] `_ensureConnection`: while reconnecting, poll every 100 ms for up to 30 s; closed → throws.
- [ ] Request retries: retryable = `isNetworkError`, status ≥500, `ECONNRESET`, `ETIMEDOUT`; delay `min(delay × 2^attempt, max)`; reconnect if disconnected.
- [ ] `GET /message?prefetch=N`: N parallel streams per round; 204 → loop again; metadata from the `message-metadata` header (missing/invalid → error); `x-eio-meta-*` keys lower-cased; `threadId` falls back to `x-eio-meta-trace-id`, then a new UUID; `reply_to` is copied to metadata and to `message.headers`.
- [ ] Decoding: `INPUT_FORMAT=error` → JSON with base64-encrypted `error`/`errorInput`; otherwise decrypt (base64 if protocol < 2).
- [ ] Tracks in-flight message metadata; `resumeProcessing` POSTs `[{messageId, stepId, taskId}]`; a non-200 response → `process.exit(1)` (🔧 B6).
- [ ] `POST /message?incomingMessageId&type[&customRoutingKey]`: throttle per type (`data`/`error`/`snapshot` limits per `RATE_INTERVAL`); `x-eio-routing-key` header taken from data headers (case-insensitive) and stripped; protocol version = forced, or `PROTOCOL_VERSION` for data, or 1 for http-reply, otherwise none (body sent as is); size > `OUTGOING_MESSAGE_SIZE_LIMIT` → throw before sending; `message-metadata` header = JSON metadata.
- [ ] `sendError`: `{error: base64-encrypted {name,message,stack}, errorInput?}` (errorInput: base64 if protocol ≥2, else per-protocol encoding).
- [ ] `sendSnapshot`: body = JSON string, sent as-is (no protocol version).
- [ ] `POST /finish-processing?incomingMessageId&status` (`success`|`error`, anything else throws); untracked metadata → warn.
- [ ] `stopListeningForMessages`: gracefully close the open GET streams, end the loop.
- [ ] `disconnect`: closed, stop PING, abort throttles, clear the reconnect timer, close the session.

## Entrypoint `run.js`

- [ ] Global http/https agents with `keepAlive: true`.
- [ ] IPC: `init:started` before connecting, `init:ended` after the init hook (only when `process.send` exists).
- [ ] Order: connect → prepare → startup (if `STARTUP_REQUIRED`) → init → listen.
- [ ] Error in init → `reportError` if connected, then `criticalErrorAndExit`.
- [ ] SIGTERM/SIGINT → graceful shutdown: wait for init, `scheduleShutdown`, disconnect, `exit(0)`; failure → `exit(-1)` (🔧 B9); no-op in shutdown-hook mode.
- [ ] `uncaughtException` → `criticalErrorAndExit`; `unhandledRejection` → log only.
- [ ] Exports `run`, `putOutToSea`, `addProcessListeners`, `__test__.disconnectOnly`.

## Entrypoint `runService.js` (`lib/service.js`)

- [ ] `argv[2]` ∈ `verifyCredentials | getMetaModel | selectModel`.
- [ ] Required env: `POST_RESULT_URL` (missing → thrown, not sent), `CFG` (JSON), `API_URI`, `API_USERNAME`, `API_KEY`; `ACTION_OR_TRIGGER` for model methods; `GET_MODEL_METHOD` for selectModel.
- [ ] 🔧 B5 `ServiceExec` = Node `EventEmitter` + `logger`, `getApiClient()`, `getConfig()` (**raw env**, not settings).
- [ ] verifyCredentials: a result without `verified` → `{verified: true}`; a throw → `{verified: false, reason}`.
- [ ] Model methods: `updateKeys` emits are collected; result is sent after all of them settle (rejections logged).
- [ ] Result POSTed as `{status: 'success'|'error', data}`; credentials in the URL → moved to basic auth; non-200 → throws (not sent); 🔧 B5 `API_REQUEST_RETRY_*` parsed with `parseInt` (NaN allowed).
- [ ] Process exits 0 on success, `criticalErrorAndExit` on failure.
