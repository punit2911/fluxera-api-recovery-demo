# Requirements mapping

Each item in the assignment brief, and where it is met and tested.

## Deliverables

| # | Requirement | Where |
| --- | --- | --- |
| 1 | Live, deployed demo website | **Not yet deployed.** `docs/DEPLOYMENT.md`, `render.yaml` and `Dockerfile` provide deployment instructions/configuration only. |
| 2 | Visible Run Demo control starting the full scenario | Header button `#run-demo`; test "resume scenario" |
| 3 | Embedded walkthrough video | Video section, `public/media/walkthrough.mp4` |
| 4 | Instrumentation for multiple API categories | `src/integration.js`; test "six API categories" |
| 5 | Controlled, safe failure | `src/stubs.js` notification gateway; `docs/SAFETY.md` |
| 6 | Work continuity analysis | Continuity section; `analyzeContinuity` |
| 7 | Recovery action and linked recovery execution | Recovery section; `controlPlane.dispatch`; webhook tests |
| 8 | Recovery verification | Outcome section; `verifyRecovery` |
| 9 | Unified cost-recovery sheet | Cost sheet section; `src/costs.js` |
| 10 | Documentation and test evidence | `docs/`, `docs/TEST_EVIDENCE.md` |

## API categories

AI/model, memory, internal, third-party, database/data and tool APIs are all present (Model Gateway, Customer Memory, Accounts Service, CRM/Analytics/Payments, Orders Data API, Notification Gateway). Each shows API name and type, workflow and execution relationship, status, duration, attempt number, error category, observed cost and recovery status (tree, timeline, diagnosis and cost views).

## Website

| Requirement | Section |
| --- | --- |
| Overview of APIs, agents, workflows, tools, memory | Connect |
| Connection and health per integration | Connect cards |
| Live execution timeline | Run |
| Execution IDs, status, duration, attempts, costs | Run, executions table |
| Component relationship view | Relationships |
| Failure-diagnosis view | Diagnosis |
| Work-continuity view | Continuity |
| Recovery-action view | Recovery |
| Final verified-outcome view | Outcome |
| Cost-recovery view | Cost sheet |
| Embedded walkthrough video | Video |

## Controlled failure

Repeatable, safe and non-destructive, known temporary category (`TEMPORARY_UNAVAILABLE`, HTTP 503), recorded in the tracer, no live payment or message, idempotent retry or resume, resettable via Reset. Tests: "repeatable after reset", "idempotency keys".

## Work continuity

Completed, failed and why, waiting, unresolved, affected dependents, safe to continue, retry or resume possible, eligible checkpoint. All in the Continuity section; test asserts every bucket is populated.

## Recovery

Detect, identify, analyze, determine safety, dispatch, record, linked execution, verify only after success (incident timeline and verification checks). Actions: retry, resume from checkpoint, fallback, escalation (policy tests cover all four; the three runnable scenarios exercise resume, fallback and escalation).

## Cost recovery

Total observed cost, cost before failure, failed-call cost, retry cost, recovery cost, cost by model/API/tool/memory/workflow, potential avoidable cost (Estimated), verified savings only after linked success. Test "cost sheet is labeled and internally consistent".

## Demo flow and acceptance criteria

Connect, Run, Fail, Analyze, Recover, Verify, Account, Video follow the header stepper. The Evidence section computes each acceptance row (API coverage, instrumentation, failure, continuity, recovery, verification, costs, website, video, safety) from recorded data.

## Presenter rules

Simulated and sandbox values are tagged, estimates are tagged Estimated, no live payments or messages, no recovery success is shown unless recorded, and no integration is claimed beyond the nine sandboxed ones.
