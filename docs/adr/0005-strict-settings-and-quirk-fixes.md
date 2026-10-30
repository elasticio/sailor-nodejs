# 5. Strict typed settings; old quirks fixed in the major

Status: accepted (2026-10-30)

## Context

Old env parsing was lenient and buggy (e.g. `"0"` → default, `"no"` → true). A few runtime paths also
had quirks. 3.0.0 is a major, so they can be fixed.

## Decision

Every `ELASTICIO_*` env var keeps its name and default (except B4). Parsing is strict and fails fast
at startup. Intentional behaviour changes (all in the CHANGELOG):

| # | Old | New |
|---|-----|-----|
| B1 | Mandatory settings stay strings (`OUTGOING_MESSAGE_SIZE_LIMIT` never parsed). | Numeric mandatory settings are parsed as positive integers; invalid → throw at startup. |
| B2 | Optional number: `parseInt(v) \|\| default` (`"0"`, garbage → default). | Strict: `"0"` honoured where it makes sense; non-numeric → throws. `Infinity` defaults stay. |
| B3 | Optional boolean: anything but `""`/`"false"` is true. | `true/1`, `false/0` (case-insensitive), empty → default, else throws. |
| B4 | `NO_SELF_PASSTRHOUGH` (typo). | `ELASTICIO_NO_SELF_PASSTHROUGH` only; the typo is ignored (the platform must set the new name). |
| B5 | `runService` `getConfig()` returns raw `process.env`; retry vars parsed with bare `parseInt`. | Same typed parser; `getConfig()` returns typed settings. Raw env is still in `process.env`. |
| B6 | `/resume-processing` non-200 → `process.exit(1)` inside the client. | Throws `ResumeProcessingFailedError`, handled through `criticalErrorAndExit` (exit 1, logged fatal). |
| B7 | Hooks called without `this`. | Hooks get `this.logger/getApiClient()/getConfig()` (additive). |
| B8 | Startup data 409 → re-create with the raw hook result. | Re-create with the normalised state (`{}` for empty). |
| B9 | Graceful shutdown failure → `exit(-1)` (255). | `exit(1)`. |
| B10 | Any `verifyCredentials` load error → stub, always `verified: true`. | Stub only if the file is missing; a load error → `verified: false` with reason. |
| B11 | `scheduleShutdown` again replaces the callback (earlier promise hangs); a race could miss the last message. | Idempotent shared promise, re-checks in-flight messages after stopping listening. |

## Consequences

- Deployments with sloppy env values fail at startup instead of running with silent defaults.
- The platform must set `ELASTICIO_NO_SELF_PASSTHROUGH` before rolling out 3.0.0.
- New behaviour changes need a new ADR or an amendment here, plus a CHANGELOG entry.
