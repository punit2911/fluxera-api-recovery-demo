# Safety and labeling

## What the demo guarantees

- **No live operations.** Every API is a local stub. Messages go to an in-memory outbox, refunds record a ledger row and never move funds, and the page shows the sandbox ledger with the counts.
- **No irreversible replay.** The refund step is declared non-idempotent and irreversible. When it fails with an unknown outcome the policy escalates and nothing is replayed.
- **Completed work is not repeated.** Recovery restores earlier steps from the checkpoint. Verification fails if any step that had already completed is executed again.
- **Idempotent recovery only.** The recovered step carries an idempotency key, and the stubs return the stored result for a repeated key. The ledger check reports duplicate side effects and the tests assert zero.
- **Controlled and repeatable failure.** The notification gateway fails the first `NOTIFY_FAIL_COUNT` calls per idempotency key with a 503 and a known category, then succeeds. Reset restores that state.
- **No fabricated success.** An incident is `verified` only after a linked recovery execution succeeds and every check passes. Savings show as Pending until then. An escalation reports no savings.

## Labels used on the page

| Label | Meaning |
| --- | --- |
| Observed | Recorded leaf cost or telemetry from this run |
| Observed after recovery | Observed, but only complete once the recovery execution has ended |
| Estimated | A projection, with its assumption stated next to it |
| Verified | Backed by a successful linked recovery execution |
| Sandbox | Local stub that behaves like a real API |
| Simulated | Deterministic imitation (the model API) |
| Illustrative | Shown to explain a concept, not measured |

## Known limits

- The tracer is a local stand-in for the Fluxera SDK, not a connection to a Fluxera tenant.
- Prices are a sandbox price card.
- State is held in memory and is shared by everyone using the same instance. Runs are refused while another is in flight.
