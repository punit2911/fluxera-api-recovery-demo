# Architecture

Everything runs in one Node process with no dependencies. The pieces are separated the way they would be in a real deployment, and they talk over HTTP where a real system would.

```
 browser ── /api/state, /api/events (SSE) ──┐
                                            ▼
 ┌─────────────── app.js (HTTP server) ──────────────────────────┐
 │                                                               │
 │  customer integration            Fluxera side                 │
 │  ───────────────────             ────────────                 │
 │  integration.js  ── tracer.js ──► store.js ──► controlPlane.js│
 │   workflow, steps,   records      executions,   detect, diagnose,
 │   checkpoints,       nodes,       nodes,        decide, dispatch,
 │   recovery webhook   attempts     checkpoints   verify
 │        │                                            │         │
 │        ▼ HTTP                                       ▼ HTTP    │
 │  /stub/* sandbox APIs (stubs.js)        POST /integration/recovery-webhook
 └───────────────────────────────────────────────────────────────┘
```

## Modules

- `tracer.js` records the execution tree. `workflow`, `agent`, `memory`, `step`, `tool` open nodes; `track` records an API leaf with every attempt, status, duration and billed cost; `checkpoint` and `restored` record recovery points and steps skipped on resume. `AsyncLocalStorage` links nested calls to their parent without passing context around.
- `store.js` keeps executions, nodes, checkpoints and incidents in memory and emits change events.
- `integration.js` is the customer side. It declares the workflow plan with dependencies (`buildPlan`), runs it, and owns the recovery webhook. Fluxera never edits an in-flight request; it asks this module to recover.
- `controlPlane.js` listens for failed executions and opens an incident: diagnose, analyze continuity, decide, dispatch, then verify when the linked recovery execution ends.
- `analysis.js` holds the pure logic: failure categories, `diagnose`, `analyzeContinuity`, `decide`.
- `costs.js` builds the cost sheet from recorded leaf costs. `acceptance.js` derives the acceptance checks from recorded data.
- `stubs.js` is the sandbox. Mutating endpoints honour `Idempotency-Key`. The notification gateway fails the first `NOTIFY_FAIL_COUNT` calls per key and then succeeds, which makes the failure deterministic and repeatable. By default, the original run gets one failed attempt and the approved recovery makes the next call successfully.
- `signing.js` signs and verifies the webhook (HMAC-SHA256 over `timestamp.body`, five-minute tolerance).

## Flow of one run

1. `POST /api/demo/run` starts the workflow. Each step opens a node; each API call is a leaf with attempts.
2. The notification call fails once, the step and workflow end `failed`, and the store emits `execution:ended`.
3. The control plane opens an incident, diagnoses the failed leaf, builds the continuity view from the plan and node states, and picks an action.
4. For a recoverable failure it POSTs a signed payload to the recovery webhook. The integration checks the signature, drops duplicate deliveries, and starts a linked execution that restores completed steps from the checkpoint and runs the rest.
5. When the linked execution ends the control plane runs the verification checks. Only if all pass does the incident become `verified`; savings are then reported as Verified.
6. For an unsafe failure no webhook is sent. The incident is escalated and nothing is verified.

## Decisions

- Checkpoints are saved after every step, so the eligible recovery point is the one just before the failing step.
- Resume restores earlier steps as `skipped` nodes that keep their original cost. That is what makes the savings figure checkable against recorded data.
- Retry waste counts attempts after the first failed attempt on the same call.
- The UI only reads `GET /api/state`. It has no logic that decides success.
