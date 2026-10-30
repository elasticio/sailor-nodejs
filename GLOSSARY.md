# Sailor — Context

Vocabulary for sailor-nodejs. Glossary only: no implementation details.
Decisions live in [docs/adr/](docs/adr/). Terms shared with the proxy (**Client**, **Session**,
**Message**, **Delivery**, **Attempt**) mean exactly what the sailor-proxy glossary says.

## The actors

**Sailor** — this library: the runner that hosts one **Component** function for one **Step** and
talks to the platform on its behalf. A sailor is a **Client** of the proxy.

**Proxy** — Sailor Proxy, the mediator between sailors and the message broker. Sailor never talks to
the broker directly.

**Component** — third-party code (described by its `component.json`) that a sailor loads and runs.

**Trigger** / **Action** — the two kinds of component function. A trigger starts a flow; an action
reacts to a message. To the sailor both are a module with a `process` function.

**Step** — one position of a component function inside a flow. A sailor instance serves exactly one
step.

**Service** — a one-shot sailor run that is not part of message processing: verifying credentials,
fetching a metamodel, or selecting a model.

## Lifecycle

**Startup hook** — runs once, when a flow is started, before the first trigger instance; its result
is the **Startup data**.

**Init hook** — runs at the beginning of every sailor instance, before any message is processed.

**Shutdown hook** — runs once, when a flow is stopped, receiving the startup data.

**Graceful shutdown** — on a stop signal, the sailor stops taking new messages, lets in-flight
processing finish, then disconnects.

## Processing

**Emit** — the component handing an event to the sailor while processing a message. Kinds: **data**,
**error**, **rebound**, **snapshot**, **updateSnapshot**, **updateKeys**, **httpReply**, **end**.

**Snapshot** — per-step state a component persists between messages.

**Rebound** — the component asking for the input message to be retried later.

**Passthrough** — the bodies of earlier steps' messages, carried along on every outgoing message so
later steps can read them.

**Lightweight message** — a message whose body lives in object storage and travels only as a
reference; the opposite is an inline body.

**Flow variables** — read-only key/values configured on the flow, visible to the component.
