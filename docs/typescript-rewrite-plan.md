# TypeScript rewrite plan

Branch: `ts-rewrite` (off `proxy`). Ships as part of `3.0.0`.
Vocabulary: [GLOSSARY.md](../GLOSSARY.md). Decisions: [docs/adr/](adr/).

## Decisions (settled)

| # | Decision |
|---|----------|
| D1 | Component-facing runtime API stays 100% compatible: `this.emit/logger/getApiClient/getConfig/getFlowVariables`, callback-style `verifyCredentials`/model methods, returning data or a promise. (Sailor never ran generators itself: components wrap them in their own `co`.) |
| D2 | `run.js` and `runService.js` stay at the package root as thin shims into `dist/`. |
| D3 | `tsc` → `dist/`, only `dist/` + shims are published. `erasableSyntaxOnly: true` (no `enum`, `namespace`, parameter properties) so `.ts` also runs natively in Node for tests/scripts. |
| D4 | ESM output; components loaded with dynamic `import()` (ADR 0001). |
| D5 | Big-bang rewrite, not file-by-file. |
| D6 | Drop `q`, `co`, `lodash`, `uuid`, `event-to-promise`, `debug`. Keep `bunyan` (log format must stay identical), `p-throttle` (latest), `jsonwebtoken`, `elasticio-rest-node`, `@elastic.io/maester-client`. |
| D7 | One test runner: mocha + chai + sinon, `.ts` specs run via Node native type stripping (no ts-node). |
| D8 | Existing tests are valid: they verify the rewrite first, then are rewritten themselves. |
| D9 | New `src/` layout (below); collaborators injected through constructors. |
| D10 | Lightweight bodies keep going directly to Maester (proxy has no `/object` endpoint; references to it in the proxy are leftovers). |
| D11 | Every `ELASTICIO_*` env var keeps its name (except B4) and default. Parsing quirks are fixed (see D14). All are live. |
| D12 | Port `run.local.js`, `local-dev-helpers.js`, `postpublish.js` (GitHub tag creation) to `scripts/*.ts`. |
| D13 | `engines.node: ">=24.22.1"`, `strict: true`, eslint 9 flat config + typescript-eslint. CI migration (CircleCI → GH Actions) is out of scope. |

| D14 | Quirks get fixed (major bump). Intentional breaking changes are listed below and go into the CHANGELOG. |

### D14 — intentional behaviour changes

| # | Old | New |
|---|-----|-----|
| B1 | Mandatory settings stay strings (`OUTGOING_MESSAGE_SIZE_LIMIT` never parsed). | Typed: numeric mandatory settings are parsed as positive integers; an invalid value throws at startup. |
| B2 | Optional number: `parseInt(v) \|\| default`, so `"0"` and garbage silently become the default. | Strict parse: `"0"` is honoured where it makes sense; a non-numeric value throws `ELASTICIO_X must be a number`. `Infinity` defaults stay. |
| B3 | Optional boolean: anything except `""`/`"false"` is true (`"0"`, `"no"` → true). | `true/1` → true, `false/0` → false (case-insensitive), empty → default, anything else throws at startup (intended: fail fast). |
| B4 | `NO_SELF_PASSTRHOUGH` (typo). | `ELASTICIO_NO_SELF_PASSTHROUGH` only. The misspelled name is ignored (hard break: the platform must set the new name). |
| B5 | `runService` `getConfig()` returns raw `process.env`; `API_REQUEST_RETRY_*` parsed with bare `parseInt` (NaN possible). | Service env goes through the same typed settings parser (with defaults); `getConfig()` returns that typed settings object, the same as in `TaskExec`. Components needing raw env use `process.env`. |
| B6 | `/resume-processing` non-200 calls `process.exit(1)` inside the proxy client. | The client throws a typed `ResumeProcessingFailedError`; the entrypoint catches it and goes through `criticalErrorAndExit` (still exits 1, now logged as fatal and testable). |
| B7 | Hooks (`startup`/`init`/`shutdown`) are called without `this`. | Hooks get a context: `this.logger`, `this.getApiClient()`, `this.getConfig()`. Additive: hooks that ignore `this` still work. |
| B8 | Startup data 409 → delete, then re-create with the **raw** result (`undefined` if the hook returned nothing). | Re-create with the same normalised state (`{}` for empty), as the first attempt does. |
| B9 | Graceful shutdown failure → `process.exit(-1)` (exit code 255). | `process.exit(1)`, like every other fatal path. |
| B10 | Any `verifyCredentials` load error (syntax error, missing dependency) → stub, credentials always `verified: true`. | Stub only when the component has no `verifyCredentials`; a load error rejects, so the service reports `verified: false` with the reason. |
| B11 | `scheduleShutdown` called again while pending replaces the callback: the earlier caller's promise never resolves. A message finishing during `stopListeningForMessages` is missed. | Idempotent: every call returns the same promise, resolved when no message is in flight (re-checked after stopping to listen); rejects if stopping to listen fails. |

Old specs that assert the old behaviour for B1–B11 are the **only** assertions allowed to change in
Phase 3 (step 22). Each such change is listed in the PR description.

## Target layout

```
src/
  index.ts                 public types + exports for component authors
  settings/                env → typed Settings (mandatory/optional/additionalVars, PROXY_CLIENT_ID)
  logging/                 bunyan sailor logger, ComponentLogger, criticalErrorAndExit
  crypto/                  Encryptor (cipher/decipher, encrypt/decryptMessageContent)
  proxy/
    session.ts             http2 connect, PING keepalive, reconnect w/ jittered backoff, health
    auth.ts                JWT signing for proxy requests
    client.ts              typed endpoints: GET/POST /message, /finish-processing, /resume-processing;
                           size check, throttling (data/error/snapshot rate limits), retries
  storage/                 Maester wrapper: fetchMessageBody / uploadMessageBody (lightweight messages)
  component/
    reader.ts              component.json, resolve trigger/action/verifyCredentials paths
    loader.ts              import() + CJS default unwrapping
    compat.ts              call a component fn: callback adapter + promise/return-value handling
  execution/
    task-exec.ts           TaskExec (the `this` of process): emitter, logger, services, flow vars
    emitter.ts             awaitable emit (replaces lib/emitter.js)
    outgoing.ts            onData pipeline: passthrough, NO_SELF_PASSTHROUGH, lightweight upload/download
    handlers.ts            error / rebound / snapshot / updateSnapshot / updateKeys / httpReply / end
    message-processor.ts   processMessage: decrypt, fetch body, run exec, finishProcessing
  hooks/
    hooks-data.ts          startup data API (create/retrieve/delete)
    lifecycle.ts           startup / init / shutdown runners
  sailor.ts                orchestration: connect, prepare, run, scheduleShutdown, disconnect, reportError
  service/                 verifyCredentials, getMetaModel, selectModel + POST_RESULT_URL reporting
  entrypoints/
    run.ts                 putOutToSea, signals, graceful shutdown, IPC, keep-alive agents
    run-service.ts
scripts/                   run-local.ts, encode-decode.ts, postpublish.ts
test/
  unit/…                   mirrors src/
  integration/             FakeSailorProxy, ShellTester, fixture components, run + graceful shutdown
```

`lib/emitter.js`, `lib/ipc.js`, `lib/utils.js`, `lib/cipher.js` (empty) disappear into the modules above.

---

## Step-by-step

### Phase 0 — Baseline (old code, nothing rewritten yet) ✅ done — see [checklist](rewrite-behaviour-checklist.md)

1. `npm ci && npm test` on `ts-rewrite`. Record which specs pass. Fix or note any that fail
   **before** touching code, so later failures can be blamed on the rewrite.
2. Write `docs/rewrite-behaviour-checklist.md`: one line per behaviour taken from the old specs plus
   a read of `lib/sailor.js#runExec` and `lib/proxy-client.js` (each emit kind, reconnect, retry,
   size limit, lightweight thresholds, hook ordering, shutdown waiting on init, exit codes, IPC
   events `init:started`/`init:ended`). This checklist is the scope of the rewrite.
3. Note which specs import internals: `mocha_spec/run.spec.js` imports `lib/logging`, `lib/encryptor`,
   `lib/settings`, `lib/sailor`, `lib/ipc` and spies on `Sailor`; `integration_helpers/index.js`
   imports `lib/encryptor`. `graceful_shutdown.spec.js` is fully black-box (forks `run.js`).

### Phase 1 — Tooling skeleton ✅ done

0. ✅ Local Node is 18: `mise use node@24` (pin it in `mise.toml`/`.nvmrc`) before anything else.

4. ✅ `package.json`: `"type": "module"`, `engines.node >=24.22.1`, `"files": ["dist", "run.js", "runService.js"]`,
   `exports` with `"."` → `dist/index.js` + types. Remove runtime deps from D6, bump `p-throttle`.
5. ✅ Dev deps: `typescript@latest`, `@types/node@24`, `mocha@11`, `chai@5`, `sinon`, `sinon-chai`,
   `nock`, `express`, `eslint@9`, `typescript-eslint`, `better-npm-audit`. Drop jasmine-node, gulp*,
   ts-node, old eslint plugins, `request*`, `del`, `rabbitmq-stats` (if unused after Phase 5).
   *Deviations:* `typescript@6.0.3`, not latest (7.x is outside typescript-eslint's peer range
   `<6.1`). `q`, `co`, `uuid`, `request`, `request-promise-native` kept as **dev** deps because the
   old spec fixtures `require` them; remove in Phase 4 (step 29). All versions pinned exact.
   Also added `@eslint/js`, `globals`, `@types/{mocha,chai,sinon,sinon-chai}`; `express` is now 5.x.
6. ✅ `tsconfig.json`: `target ES2024`, `module/moduleResolution nodenext`, `strict`,
   `erasableSyntaxOnly`, `verbatimModuleSyntax`, `rewriteRelativeImportExtensions`, `declaration`,
   `outDir dist`, `rootDir src`. Separate `tsconfig.test.json` (noEmit) covering `test/` + `scripts/`.
7. ✅ `eslint.config.js` flat config. Scripts: `build`, `typecheck`, `lint`, `test:unit`,
   `test:integration`, `test` (`build` → lint → both), `prepublishOnly: build`.
   *Deviation:* lint ignores the old JS (`lib/`, `spec/`, `mocha_spec/`, root `*.js`) until it is
   replaced by shims (step 19) or deleted (step 29). `.eslintignore` removed; `.eslintrc.json` stays until step 29.
8. ✅ `.mocharc` running `test/**/*.spec.ts` (Node strips types natively).
   *Known issue:* the `.mocharc` spec glob is merged with the CLI glob, so `test:integration` also runs
   unit specs. Fix when the first integration spec lands (Phase 4).

### Phase 2 — Rewrite `src/` (big-bang, one module group at a time, compiling as you go)

Order goes leaf to root so each module compiles against real dependencies:

9. ✅ `settings/` — port `readFrom` with B1–B5 applied (typed numbers with per-key minimums, strict
   booleans, `HOOK_SHUTDOWN` relaxes the required list, `ADDITIONAL_VARS_FOR_HEADERS`,
   `readServiceSettings` for `runService`). Export a `Settings` type.
   `PROXY_CLIENT_ID` = `crypto.randomUUID()` once per process.
10. ✅ `logging/` — same bunyan fields and level env (`LOG_LEVEL`), same context keys as README lists.
    Replace `debug('sailor')` calls with `logger.trace`.
11. ✅ `crypto/` — Encryptor byte-for-byte compatible (same algorithm, IV handling, encodings, protocol v1/v2).
12. ✅ `proxy/` — split `proxy-client.js`: session lifecycle (connect, PING every
    `PROXY_PING_INTERVAL_MS`, reconnect with backoff/jitter settings, max-session-memory rule) vs
    endpoint calls (`listenForMessages` with prefetch, `sendMessage` with size check vs
    `OUTGOING_MESSAGE_SIZE_LIMIT`, `finishProcessing`, `resumeProcessing`, `sendError/Rebound/Snapshot`,
    throttling via `p-throttle`, abort pending throttled sends on disconnect).
    Use `events.once` instead of `event-to-promise`. Export `MESSAGE_PROCESSING_STATUS` as `as const`.
    Check headers/query params against `../elasticio/src/sailor-proxy/docs/API.md`.
    *Done as:* `auth.ts`, `session.ts`, `client.ts` plus `errors.ts` (`ProxyRequestError`,
    `ResumeProcessingFailedError`, `isRetryable`) and `codec.ts` (metadata extraction, decoding).
    B6 reaches the entrypoint through the `onFatalError` option (default: `criticalErrorAndExit`).
    API.md lists a `clientId` query param, but the proxy reads `clientId` from the JWT (`src/auth.ts`),
    so the doc is stale; the client keeps sending it in the JWT only.
    *Small fixes:* content-length/size check counts bytes, not string chars (snapshots with non-ASCII);
    routing-key stripping no longer mutates the caller's `data`; the retry loop no longer opens a
    second session while a reconnect is in progress or after `disconnect()`; throttles are recreated
    after `disconnect()` (p-throttle 8 aborts via `AbortSignal`, permanently).
13. ✅ `storage/` — Maester wrapper with Encryptor cipher/decipher, retry settings
    `PROXY_OBJECT_REQUEST_*`.
    *Done as:* `MessageStorage` (`fetchMessageBody`, `uploadMessageBody`, `OBJECT_ID_HEADER`), store
    injected via constructor, `MessageStorage.create(settings, encryptor)` wires the real `ObjectStorage`.
    *Deviation:* `PROXY_OBJECT_REQUEST_*` never applied to Maester in the old code (they drive proxy
    request retries, already in `proxy/client.ts`). New env vars instead, passed to maester-client's
    native `retryOptions` (its own backoff, 5xx/network only), with its defaults and ranges:
    `ELASTICIO_OBJECT_STORAGE_RETRY_ATTEMPTS` → `retriesCount` (2, 0–4),
    `ELASTICIO_OBJECT_STORAGE_REQUEST_TIMEOUT` → `requestTimeout` (10000, 500–20000).
    Out-of-range values throw at startup (maester-client would silently use its default).
    Defaults keep old behaviour; add the two vars to the README/CHANGELOG.
14. `component/` — reader + `import()` loader (unwrap `default` for CJS; keep module caching so
    component module state survives between messages) + `compat.ts`: resolve on callback **or** a
    truthy return value (`verifyCredentials`, model methods), same as today. Internal `co` usage
    becomes plain `async/await`.
    ✅ *Done as:* `reader.ts` (`ComponentReader`, same API/messages as `lib/component_reader.js`),
    `loader.ts` (`require.resolve` first so extensionless/dir `main` and `verifyCredentials` still
    resolve, then `import()`; `default ?? namespace`), `compat.ts` (`callComponentFunction`).
    `ERR_MODULE_NOT_FOUND` (ESM) is reported as `MODULE_NOT_FOUND`, like CJS.
    B10: the always-verified stub is used only when `verifyCredentials` does not exist. Fixture components in `test/unit/component/fixtures/` (CJS + ESM).
    *Note for Phase 3:* package is `type: module`, so the old CJS fixtures in `spec/` need a
    `{"type":"commonjs"}` package.json.
15. `execution/` — `TaskExec` (keep the `process` semantics: a returned truthy value is emitted as
    `data`, then `end`; a throw becomes `error` + `end`), awaitable emitter, then break
    `runExec` into `outgoing.ts` + `handlers.ts` + `message-processor.ts`. Replace `_.cloneDeep` with
    `structuredClone`, `_.pick/_.omit/_.isEmpty` with small local helpers.
    ✅ *Done as:* `emitter.ts` (`AwaitableEmitter`), `task-exec.ts` (`TaskExec` + `ApiClient`/`StepData`
    types), `outgoing.ts` (`prepareOutgoingData`), `handlers.ts` (`createHandlers`, `formatError`),
    `message-processor.ts` (`MessageProcessor`: owns `snapshot`, `stepData`, `messagesCount`; Sailor
    will delegate to it), plus `metadata.ts` (outgoing/step metadata, reused by `reportError`) and
    `utils.ts` (`pick/omit/isEmpty/isPlainObject/snakeCase`). Collaborators are `Pick<>` ports.
    *Small fix:* `messagesCount` is now decremented when the trigger fails to load or a lightweight
    body can't be fetched (old code leaked it, so a later graceful shutdown waited forever).
16. `hooks/` — hooks-data client (via `elasticio-rest-node` retry helper) + startup/init/shutdown runners.
    ✅ *Done as:* `hooks-data.ts` (`HooksData`, `HooksDataError` with `statusCode`; request fn injectable,
    default `axiosReqWithRetryOnServerError`), `lifecycle.ts` (`Lifecycle`: `startup`/`init`/`shutdown`/
    `invoke`; module loader, step config getter, hooks data, `HookContext` and logger injected).
    B7: hooks run with `this` = `HookContext` (`logger`, `getApiClient`, `getConfig`). B8: 409 re-creates
    with the normalised state. `src/types/elasticio-rest-node.d.ts` declares the untyped package.
17. `sailor.ts` — orchestration only; every collaborator comes in through the constructor
    (a `createSailor(settings)` factory wires the real ones).
    ✅ *Done as:* `Sailor` takes `{settings, proxyClient, componentReader, apiClient, processor, lifecycle}`
    (`Pick<>` ports) and keeps the old method names (`connect`, `isConnected`, `prepare`, `disconnect`,
    `reportError`, `startup`, `runHookInit`, `runHookShutdown`, `run`, `scheduleShutdown`,
    `processMessageAndMaybeShutdownCallback`) so `run.spec` can spy on `Sailor.prototype`.
    B11: `scheduleShutdown` is idempotent (one shared promise).
    `messagesCount` is read from `MessageProcessor`. `createSailor(settings, { proxyClientOptions })`
    shares one Encryptor between proxy client and storage. The `HOOK_SHUTDOWN` `reportError` no-op
    stays in the entrypoint (step 19).
    *Note for Phase 3:* `mocha_spec/unit/sailor.spec.js` uses `sailor.apiClient/proxyClient/snapshot/
    processMessage/fetchMessageBody/uploadMessageBody`. Those now live on the collaborators, so build them
    in the spec and inject them (or point the spec at `MessageProcessor`).
18. `service/` — port `processService` (POST_RESULT_URL, ACTION_OR_TRIGGER, GET_MODEL_METHOD,
    `verifyCredentials` result normalisation, sub-promise settling). Replace `Q.allSettled` with
    `Promise.allSettled`.
    ✅ *Done as:* `service/index.ts`: `processService(method, env, deps?)` (same signature as the old
    module, so `spec/service.spec.js` can call it; `deps` injects `componentReader`, `createApiClient`,
    `request`), `ServiceExec` (`EventEmitter` + `logger`, `getApiClient()`, `getConfig()` → typed
    `ServiceSettings`, B5). Model methods and `verifyCredentials` go through `callComponentFunction`.
    Env is parsed with `readServiceSettings` after the `POST_RESULT_URL` check; a parse error rejects
    without posting (fail fast).
    *Small fix:* old code sent the success result through the same `.catch` as execution errors, so a
    failed success POST (network error after retries) was retried as an `error` POST. Now a POST
    failure just rejects.
19. `entrypoints/` + root shims: `run.js` = `import('./dist/entrypoints/run.js')`; keep the
    `__test__.disconnectOnly`, `run`, `putOutToSea`, `addProcessListeners` exports that the tests use.
    Replace the `require.main`/`process.mainModule` check with an `import.meta.main` check (Node 24).
    ✅ *Done as:* `entrypoints/run.ts` (`run`, `putOutToSea`, `addProcessListeners`, `__test__`, `IPC`
    (was `lib/ipc.js`), `main`) and `entrypoints/run-service.ts` (`main`). Root `run.js`/`runService.js`
    are ESM shims: re-export from `dist/` and call `main()` under `import.meta.main` (the `dist/` module
    checks it too, for direct runs). CJS `require('./run.js')` still works (Node 24 `require(esm)`).
    B9: graceful shutdown failure → `exit(1)`. B6 needs nothing here: `ProxyClient`'s default
    `onFatalError` is `criticalErrorAndExit`. `createSailor` is used, so `Sailor.prototype` stubs still apply.
    *Note for Phase 3:* the old specs (`mocha_spec/`, `spec/`, `lib/`) are CJS and do not load under
    `type: module` at all (`require is not defined`): they need `{"type":"commonjs"}` package.json files.
    Until step 22 the root shims point at `dist/`, so `npm run build` is needed before `graceful_shutdown.spec`.
20. `index.ts` — export public types: `TaskExecContext` (the `this`), `IncomingMessage`,
    `OutgoingMessage`, `Snapshot`, hook signatures, `Settings`.
    ✅ *Done as:* type-only `index.ts`: `TaskExecContext` (= `TaskExec`), `IncomingMessage`, `OutgoingMessage`,
    `Snapshot`, `ProcessFunction`, `StartupHook`/`InitHook`/`ShutdownHook`/`AnyHook`, `HookContext`, `HookName`,
    `Settings`, `ServiceSettings`, `ServiceExec`, `VerifyCredentialsResult`, `ComponentLogger`, `ApiClient`,
    `StepData`, `MessageMetadata`, `LegacyCallback`. Checked by compiling a consumer `.ts` against `dist/`.
    *Small fix:* `RetryRequestConfig`/`RetryResponse` now live in `hooks/hooks-data.ts`, so the published
    `.d.ts` no longer imports the untyped `elasticio-rest-node` (its declaration in `src/types/` is not emitted).

### Phase 3 — Gate: old tests against new code

21. `npm run build`.
22. Point the old specs at the new code with the **smallest** change possible: replace the `lib/*`
    imports in `run.spec.js` and `integration_helpers/index.js` with imports from `dist/` (or a
    temporary `lib/` → `dist/` re-export shim), convert `require` to `import` where ESM forces it.
    **No assertion changes** except those for B1–B11. `graceful_shutdown.spec.js` needs no changes at all.
23. Port the jasmine `spec/*.spec.js` (component_reader, executor, service) to mocha in place, keeping
    assertions identical, and run them against `dist/`.
24. Iterate until everything is green. Any assertion that genuinely has to change gets written down in
    the PR description with the reason.
25. Manual smoke: `scripts/run-local.ts` against a locally running sailor-proxy with a real component
    (e.g. petstore), covering an action, a trigger, a lightweight message and SIGTERM during processing.

✅ *Steps 21–24 done as:* `npm run test:legacy` (build first) runs `spec/` + `mocha_spec/` against `dist/`:
**125 passing, 3 pending**, which is the baseline (47 jasmine + 141 mocha) minus the 63 cases in `proxy-client.spec`.
- `lib/*.js` are now one-line CJS re-exports of `dist/` (`emitter`, `utils`, `cipher`, `hooksData` removed);
  `lib/`, `spec/`, `mocha_spec/` got `{"type":"commonjs"}` package.json files.
- `require('sinon-chai')` → `.default` (ESM-only now). `nock` pinned back to 13.5.6: nock 15 (mswjs) hijacks
  `http2.connect` sockets, so the sailor never reached `FakeSailorProxy`. Nothing in `test/` uses nock.
- jasmine `spec/*` run on mocha through `spec/jasmine-compat.js` (`expect().toEqual/…`, `spyOn().andCallThrough()`,
  `runs`/`waitsFor`, jasmine 1.3 equality), loaded with one `install()` line per file. Native promises have no
  `.done`/`isFulfilled`: `.done(done, done)` → `.then(() => done(), done)`, and `Q(...)` around
  4 promises in `component_reader.spec`.
- `mocha_spec/unit/sailor.spec.js` uses `mocha_spec/unit/legacy-sailor.js`, which builds the old `new Sailor(settings)`
  shape from the new collaborators. The spec only changes its import line.
- *Assertion changes:* B4 `NO_SELF_PASSTRHOUGH` → `NO_SELF_PASSTHROUGH` (`settings.spec`, `sailor.spec`,
  `run.spec`, only in setup and titles). `executor.spec` "should properly store variables": `taskexec._variables`
  → `taskexec.getFlowVariables()`, because the field is now a private `#variables`.
- *Not ported:* `mocha_spec/unit/proxy-client.spec.js` (47 of 63 cases fail). It is white-box: it puts a fake into
  `client.session` and stubs or calls `_startPingInterval`, `_reconnect`, `_scheduleReconnect`, `_handleDisconnection`
  and others, which now live inside `ProxySession`/`codec.ts`. Making it pass would mean rewriting it, which is Phase 4.
  Its behaviour is covered by `test/unit/proxy/*` and, black-box, by `run.spec` + `graceful_shutdown.spec`.
- *Small fix:* settings coerce non-string env values (`String(v)`). `run.spec` puts numbers into its env object,
  and the old `parseInt` accepted them.
- Step 25 (manual smoke) is still open: it needs `scripts/run-local.ts` (step 30) and a local sailor-proxy.

### Phase 4 — Rewrite the tests

26. Unit tests in `test/unit/` mirroring `src/`, injecting fakes through constructors, covering every
    line of the Phase 0 checklist. Use the old unit specs as the list of cases.
    ✅ *Done as:* gap pass over the specs written in Phase 2 (216 → 258 cases, all checklist lines ticked;
    c8 line coverage of `src/` 94.8% → 97.9%). New: `proxy/session.spec` (fake http2 session injected via
    `connect`: reconnect on error/close/goaway/timeout, backoff + max delay, give-up, PING, `ensureConnection`
    waiting, B6 paths), `entrypoints/run-service.spec`; `run.spec` gains signals/graceful shutdown/B9/
    process listeners/keep-alive agents; `client.spec` gains full JWT payload, http-reply/forced/no protocol
    version, GET non-200, `stopListeningForMessages`, untracked finish warning; `message-processor.spec`
    gains full metadata, data send failure → error, per-message deep copies.
    *Small fix:* `ProxySession` — a reconnect still connecting when `disconnect()` is called no longer keeps
    the new session (and its PING) alive or calls `onReconnect`/`criticalErrorAndExit` afterwards.
    Left uncovered on purpose: `main()` under `import.meta.main`, real-dependency defaults, defensive
    stream-destroy `catch`es.
27. Move integration helpers (`FakeSailorProxy`, `ShellTester`) and fixture components into
    `test/integration/`. The fixture components **stay JS (CJS)** to prove D1; add one ESM fixture
    component to prove D4.
    ✅ *Done as:* `test/integration/helpers/` (`index.ts`, `fake-sailor-proxy.ts`, `shell-tester.ts`; TS, `uuid` →
    `crypto.randomUUID`, Encryptor from `src/`, `DEBUG` env dropped). Fixtures: `test/integration/fixtures/component/`
    (moved as-is, `{"type":"commonjs"}`) and `fixtures/esm-component/` (`type: module`, named `async process`
    returning data). `esm-component.spec.ts` forks `run.js` with it (D4, needs `npm run build`).
    `mocha_spec/*.spec.js` `require()` the TS helpers (Node 24 `require(esm)` + type stripping): `test:legacy`
    still 125 passing / 3 pending. `.mocharc` `spec` removed (fixes the step 8 glob issue). Added `@types/express`.
28. Convert `run.spec` + `graceful_shutdown.spec` to TS.
    ✅ *Done as:* `test/integration/run.spec.ts` + `graceful-shutdown.spec.ts` (git-moved, assertions unchanged).
    `run.spec` imports `src/` (not `dist/`): `run.ts` statically instead of the `require.cache` reload (`putOutToSea`
    resets the module state each run), `randomUUID` for `uuid`, a typed `decrypt()` helper. Settings are readonly,
    so overrides are spreads (`{ ...readFrom(env), STARTUP_REQUIRED: true }`; the old `'1'` strings → `true`).
    `.deep.eql` → `.deep.equal` (chai types). `graceful-shutdown` uses a local `tester` per test.
    `test:integration`: 37 passing / 3 pending; `test:legacy`: 89 passing (125 − the 36 moved).
29. Delete `spec/`, `mocha_spec/`, `lib/`, the temporary shim, `.eslintrc.json`, gulp leftovers.
    ✅ *Done as:* deleted `lib/`, `spec/` (incl. `jasmine-compat.js`), `mocha_spec/` (incl. `legacy-sailor.js` and the
    never-ported `proxy-client.spec.js`), `.eslintrc.json`; dropped `test:legacy`, their eslint ignores and the
    `.npmignore` entry; removed dev deps `q`, `co`, `uuid`. No gulp leftovers were found.
    *Kept:* `request` + `request-promise-native` (dev): the CJS integration fixtures `require` them (step 31).
    `npm test`: 258 unit + 37 integration passing, 3 pending.

### Phase 5 — Scripts, docs, release ✅ done

30. Port `run.local.js`, `local-dev-helpers.js` (encode/decode), `postpublish.js` to `scripts/*.ts`
    and update the npm scripts (`dev:local`, `encode`, `decode`, `postpublish`).
    ✅ *Done as:* `scripts/run-local.ts` (env from `config/local.json`, then dynamic import of `src/entrypoints/run.ts`
    so `LOG_LEVEL` is read after it is set), `scripts/encode-decode.ts`, `scripts/postpublish.ts` (`git tag --list`
    instead of `grep`, `execFileSync`). Run natively from `src/` (no build). Old root scripts and their eslint ignores removed.
31. `npm run audit`, then remove deps that nothing imports anymore.
    ✅ *Done as:* `npm audit fix` (lockfile only) cleared all high findings. Left: moderate `file-type` via
    `@elastic.io/maester-client` (no fix without a maester major). Stale `.nsprc` exclude removed. Every dep is still
    imported (`request` is the peer of `request-promise-native`, used by CJS fixtures).
32. Rewrite the README: install, Node >= 24.22.1, ESM/CJS component support, typed `this`, env var
    table (from `settings/`), logging, flow control, hooks. Drop the travis/david badges.
    ✅ Also dropped the stale `ELASTICIO_PROCESS_AMQP_DRAIN`; added hook context (B7) and local dev commands.
33. CHANGELOG `3.0.0`: B1–B11, Node engine bump, TS + bundled types, ESM components, removed `q` (components
    that relied on sailor bringing `q` in transitively must add it themselves), and that `DEBUG=sailor`
    is replaced by `LOG_LEVEL=trace`.
    ✅ Plus the new object storage env vars and the user-visible small fixes.

## Risks to watch

- **Breaking components by accident**: transitive deps (`q`, `lodash`) that components used without
  declaring them. Grep a few official components before release.
- **Log format drift**: platform log parsing depends on bunyan JSON fields. Diff a log line before vs after.
- **Encryption compatibility**: the encryptor must decrypt messages produced by the old sailor and the
  other way round. Add a fixture-based test with ciphertext captured from the old code.
- **CJS `default` unwrapping**: `module.exports = fn` vs `exports.process = …` both have to work.
- **`this` binding** in `process` and hooks (hooks are called *without* `this`, per README).
