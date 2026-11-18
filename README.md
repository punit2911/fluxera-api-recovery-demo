# Fluxera API Recovery Demo

A live demo of the failure-to-recovery path for API-driven work: observe the work, catch the failure, show what is still safe, recover through an approved path, verify it, and show what it cost.

One support workflow handles a delayed-order refund inquiry. It calls six kinds of API. A controlled, temporary failure hits the notification step, and the demo walks through diagnosis, work continuity, recovery and cost.

## Run it

Needs Node 20 or newer. There are no dependencies to install.

```
npm start
```

Open http://localhost:8080 and press **Run Demo**.

```
npm test          # 24 tests, about a second
npm run smoke     # runs all three scenarios end to end
npm run test:evidence   # regenerates docs/TEST_EVIDENCE.md
```

## What is on the page

| Section | What it shows |
| --- | --- |
| Connect | Agents, workflows, tools, memory, and nine integrations across six API categories with a live health probe each |
| Run | Per-integration timeline of every attempt, plus the executions table (ID, status, duration, attempts, cost) |
| Relationships | The execution tree: which memory, tool and API call belongs to which workflow step |
| Diagnosis | Failed step, error category, HTTP status, attempts, cost, cause, impact |
| Continuity | Completed, failed, waiting, unresolved and safe-to-continue work, plus the eligible checkpoint |
| Recovery | Safety checks, the decision, the signed webhook request and response, the incident timeline |
| Outcome | Original and recovery executions side by side, verification checks, sandbox ledger |
| Cost sheet | Observed, Estimated and Verified numbers by metric, area, integration and component |
| Video | The embedded walkthrough |
| Evidence | Acceptance checks computed from the recorded run |

## Scenarios

| Scenario | Failure | What Fluxera does |
| --- | --- | --- |
| Temporary failure | Notification gateway returns 503 twice | Resumes from the last checkpoint |
| Provider outage | Gateway reports a sustained outage | Resumes from the checkpoint using an approved fallback channel |
| Unsafe failure | Refund call times out with an unknown outcome | Refuses to replay it and escalates |

The default run uses the first one. Recovery can also be held for manual approval with the checkbox in the header.

## What is real and what is not

- The execution tree, attempts, durations, statuses and costs are recorded by the tracer in `src/tracer.js` as the workflow runs. Nothing on the page is a canned value.
- The tracer is a local stand-in shaped like the Fluxera Node SDK (workflow, agent, memory, step, tool, track, checkpoint). It is **not connected to a Fluxera tenant**, and the page says so. To use the real SDK, replace the calls in `src/tracer.js` and keep the same call sites in `src/integration.js`.
- All nine APIs are local sandbox stubs served by this process. The model API is a deterministic simulation and is labeled Simulated. Messages go to an in-memory outbox and no refund moves money.
- Costs come from a sandbox price card in `src/pricing.js`, not vendor invoices. Monthly projections assume 50 incidents and are labeled Estimated.

See `docs/SAFETY.md` for the full list of guarantees and `docs/REQUIREMENTS.md` for a line-by-line mapping to the assignment brief.

## Layout

```
server.js            entry point
src/                 server, tracer, store, sandbox APIs, control plane, cost sheet
public/              the site (plain ES modules, no build step)
public/media/        walkthrough video and poster
test/                unit and end-to-end tests
scripts/             smoke run, evidence generator, video recorder
docs/                architecture, API, deployment, safety, requirements, test evidence
```
