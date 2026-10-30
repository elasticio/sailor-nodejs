// Public types for component authors. Type-only: sailor is started through `run.js`/`runService.js`.
import type { TaskExec } from './execution/task-exec.ts';
import type { IncomingPayload, OutgoingDataMessage } from './execution/outgoing.ts';
import type { Hook, HookContext } from './hooks/lifecycle.ts';

export type { Settings, ServiceSettings } from './settings/index.ts';
export type { ComponentLogger } from './logging/index.ts';
export type { ApiClient, StepData } from './execution/task-exec.ts';
export type { MessageMetadata } from './proxy/codec.ts';
export type { HookContext, HookName } from './hooks/lifecycle.ts';
export type { ServiceExec, VerifyCredentialsResult } from './service/index.ts';
export type { LegacyCallback } from './component/compat.ts';

/** A message as `process` receives it (body already fetched for lightweight messages). */
export type IncomingMessage = IncomingPayload;

/** What a component emits as `data`. */
export type OutgoingMessage = OutgoingDataMessage;

/** Step snapshot: the third argument of `process`, and what `snapshot`/`updateSnapshot` emit. */
export type Snapshot = Record<string, unknown>;

/** The `this` of `process`: `emit` (awaitable), `logger`, `getApiClient()`, `getConfig()`, `getFlowVariables()`. */
export type TaskExecContext = TaskExec;

/** `process(msg, cfg, snapshot)`. A truthy return value (or resolved promise) is emitted as `data`, then `end`. */
export type ProcessFunction<Cfg = Record<string, unknown>> =
    (this: TaskExecContext, msg: IncomingMessage, cfg: Cfg, snapshot: Snapshot) => unknown;

/** `startup(cfg)`: its result is stored as startup data. */
export type StartupHook<Cfg = Record<string, unknown>> = (this: HookContext, cfg: Cfg) => unknown;

/** `init(cfg)`: runs once before the first message. */
export type InitHook<Cfg = Record<string, unknown>> = (this: HookContext, cfg: Cfg) => unknown;

/** `shutdown(cfg, startupData)`: runs when the flow is stopped. */
export type ShutdownHook<Cfg = Record<string, unknown>, Data = unknown> =
    (this: HookContext, cfg: Cfg, data: Data) => unknown;

/** Any hook (`startup`/`init`/`shutdown`). */
export type AnyHook = Hook;
