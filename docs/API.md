# HTTP API

## Demo control

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/healthz` | | Liveness |
| GET | `/api/state` | | Full snapshot the UI renders from |
| GET | `/api/events` | | Server-sent events, `tick` with the store revision |
| POST | `/api/demo/run` | `{ scenario, pace, autoRecover }` | `scenario`: `resume`, `fallback`, `escalate`. `pace`: `fast`, `normal`, `presenter`. `409` if a run is in flight |
| POST | `/api/demo/reset` | | Clears executions, incidents and sandbox state. `409` while a run is in flight |
| POST | `/api/incidents/:id/approve` | | Dispatches a recovery that was held for approval |

## Recovery webhook (owned by the integration)

`POST /integration/recovery-webhook`

Headers: `x-fluxera-timestamp`, `x-fluxera-signature` (`sha256=` + HMAC-SHA256 of `timestamp.body`), `x-fluxera-recovery-id`.

Body:

```json
{
  "recoveryId": "rec_...",
  "incidentId": "inc_001",
  "executionId": "exe_...",
  "runId": "run-001",
  "scenario": "resume",
  "workflow": "support.refund_inquiry_resolution",
  "failedStepId": "s6",
  "action": { "type": "resume_from_checkpoint", "checkpointId": "cp_s5", "fallbackIntegration": null },
  "issuedAt": "2026-01-01T00:00:00.000Z"
}
```

Responses: `202` accepted, `200` with `duplicate: true` for a repeated `recoveryId`, `401` bad signature, `400` bad JSON, `404` unknown execution, `409` unknown checkpoint.

## Sandbox APIs

Served under `/stub/<service>/...`. Every service has `GET /stub/<service>/health`. Responses carry `x-sandbox: true` and `x-sandbox-cost-usd`.

| Service | Category | Endpoint |
| --- | --- | --- |
| `ai` | AI / model | `POST /v1/complete` |
| `memory` | Memory | `GET /v1/customers/{id}/context` |
| `internal` | Internal | `GET /v1/accounts/{id}` |
| `db` | Database | `GET /v1/orders/{id}`, `POST /v1/audit` |
| `crm` | Third-party | `POST /v1/cases` |
| `notify` | Tool | `POST /v1/messages` (controlled failure) |
| `email` | Tool | `POST /v1/messages` (approved fallback) |
| `analytics` | Third-party | `POST /v1/events` |
| `payments` | Third-party | `POST /v1/refunds` |
