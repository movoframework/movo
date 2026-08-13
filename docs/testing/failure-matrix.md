# Payment failure matrix

The unmodified baseline payload must succeed before any mutation is meaningful. Payload cases
start with a real upstream-client-signed payload and mutate it; structurally invented payloads
are not admissible evidence.

| Scenario | Runner | Expected result |
|---|---|---|
| wrongNetwork | Mock and gated in-process | Non-null rejection reason |
| wrongAsset | Mock and gated in-process | Non-null rejection reason |
| wrongAmount | Mock and gated in-process | Non-null rejection reason |
| expired | Mock and gated in-process | Non-null rejection reason |
| replayed | Mock and gated in-process | Second use rejected |
| facilitator5xx | Mock | Deterministic facilitator failure |
| facilitatorTimeout | Mock | Deterministic timeout |
| facilitatorMalformed | Mock | Deterministic malformed-response failure |
| handlerFailureAfterVerify | Mock | Handler failure; settlement is cancelled upstream |
