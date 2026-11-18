# Test evidence

Generated 2026-11-18T07:25:22.578Z on Node v24.13.0.
Command: `npm run test:evidence`

## Automated tests

```
✔ static site and health endpoint are served (77.8731ms)
✔ integrations expose six API categories and are probed live (326.3507ms)
✔ resume scenario: fail, analyze, recover from checkpoint, verify (186.5263ms)
✔ cost sheet is labeled and internally consistent after recovery (140.0457ms)
✔ fallback scenario recovers through the approved fallback integration (146.3322ms)
✔ escalate scenario never replays and never claims verification (103.3921ms)
✔ manual approval holds recovery until a person approves (108.6232ms)
✔ a second run is refused while one is in flight, reset works afterwards (126.3307ms)
✔ the run is repeatable after reset with the same outcome (228.639ms)
✔ unknown scenario is rejected (25.6379ms)
✔ recovery webhook rejects bad signatures and de-duplicates deliveries (125.3593ms)
✔ sandbox APIs honour idempotency keys (25.8397ms)
✔ acceptance checks are computed from recorded data (141.1994ms)
✔ signature verifies for a fresh, untampered body (2.7244ms)
✔ signature rejects a tampered body, wrong secret and stale timestamp (0.5442ms)
✔ policy: transient failure on idempotent call resumes from checkpoint (0.4906ms)
✔ policy: provider outage with approved fallback uses the fallback (0.215ms)
✔ policy: provider outage without a fallback escalates (0.1567ms)
✔ policy: non-idempotent operation is never replayed (0.1751ms)
✔ policy: plain retry only when nothing was committed and no checkpoint exists (0.1913ms)
✔ policy: non-recoverable categories escalate (0.3423ms)
✔ policy: missing webhook blocks automatic recovery (0.3107ms)
✔ cost sheet: verified savings stay empty until recovery is verified (1.9278ms)
✔ model cost is computed from token usage (0.3818ms)
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2032.6423
```

## Smoke run (all three scenarios, end to end over HTTP)

```
ok   resume    -> verified (action: resume_from_checkpoint, executions: 2)
ok   fallback  -> verified (action: fallback, executions: 2)
ok   escalate  -> escalated (action: escalate, executions: 1)
```

Exit codes: tests 0, smoke 0.
