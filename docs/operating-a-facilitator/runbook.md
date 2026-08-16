# Facilitator runbook

Operational procedures for a running Movo facilitator. Written for whoever is on call, not for
whoever wrote it.

## What this service can and cannot lose

**It cannot lose customer funds.** It never holds them. For any settled payment the facilitator
address appears as none of the operation source, the transfer `from`, or an address in any
authorization entry, and upstream rejects a payment that tries to put it in one of those
positions. The worst monetary outcome of a total compromise is that your sponsor accounts are
drained of XLM through transaction fees.

**It can lose availability, and it can waste XLM.** Those are the two things to watch.

**A settlement is never silently dropped.** Every rejection carries a machine-readable reason.
If a caller reports a failure, ask them for the `invalidReason` or `errorReason` — it names the
cause precisely.

## Dashboards and signals

| Signal | Source | Healthy | Act when |
|---|---|---|---|
| Liveness | `GET /health` | 200 | Non-200 → restart |
| Readiness | `GET /ready` | 200, `ready: true` | 503 → see *Sponsor below floor* |
| Sponsor balance | `/ready` → `networks[].signers[].balanceXlm` | above floor | approaching floor → top up |
| Queue depth | `GET /metrics` → `networks[].waiting` | 0 | sustained > 0 → add sponsors |
| In-flight | `/metrics` → per-signer `inFlight` | ≤ pool size | stuck non-zero → see *Stuck settlement* |
| Settle failures | `/metrics` → `callers[].settleFailed` | flat | rising → check reasons in logs |
| Rejections | `/metrics` → `callers[].rejectedTotal` | flat | spiking → a caller is misconfigured or probing |

Logs are structured JSON, one object per line, with a `correlationId` on every request. They
contain **no** payload, key, authorization header or Stellar secret — asserted by
`tests/integration/facilitator-service.test.ts`. They do contain settled transaction hashes,
which are public ledger data and the most useful field you have during reconciliation.

## Incident: `/ready` returns 503 — sponsor below floor

**Symptom.** Load balancer takes the instance out of rotation. `/ready` shows one or more
signers with `aboveFloor: false`.

1. Read `/ready`. Note the address and `balanceXlm`.
2. Fund it.
   - Testnet: `curl "https://friendbot.stellar.org?addr=<G…>"`
   - Pubnet: transfer XLM from treasury.
3. Balances are cached for 30s. Wait it out, or restart the instance to clear it.
4. Confirm `/ready` returns 200.

**Prevention.** Alert *below* the floor, not at it — by the time `/ready` fails you are already
shedding traffic. Set the floor to several days of expected fee spend. At ~23,000 stroops per
settlement, 100,000 settlements is about 230 XLM.

## Incident: `/ready` shows a sponsor with `balanceXlm: null` and an `error`

The balance could **not be read** — Horizon is unreachable or rate-limiting. This is treated as
unhealthy on purpose: an unknown balance is not a passing balance.

1. Check Horizon status for the network.
2. If Horizon is degraded but Soroban RPC is fine, the service can still settle. This is a
   *readiness* failure, not a settlement failure — consider taking the instance out of rotation
   manually rather than restarting in a loop.
3. If it persists and settlements are succeeding, the safe temporary action is to lower the
   floor to 0 for the affected network, which makes readiness depend only on a successful read.
   Restore it as soon as Horizon recovers, and record it as an incident action.

## Incident: callers report `signer_pool_exhausted`

**This is the pool doing its job, not a bug.** Every sponsor was busy for longer than the
60-second acquire timeout.

1. `/metrics` → `waiting`. A large number confirms it.
2. **Short term:** shed load. Lower `MOVO_FACILITATOR_RATE_LIMIT_PER_KEY` for the noisiest
   caller, or scale out replicas.
3. **Real fix:** add sponsors. Pool size is the concurrency ceiling — see
   [signers-and-channel-accounts.md](signers-and-channel-accounts.md). Provision, fund, append to
   `MOVO_FACILITATOR_<NET>_SIGNER_SEEDS` (or the injected signer list) and deploy. No downtime.

Do **not** raise `maxInFlightPerSigner` to make this go away. It will appear to work and will
re-introduce sequence-number collisions, which fail as opaque
`settle_exact_stellar_transaction_submission_failed`. That is strictly worse: a queued payment
becomes a failed one.

## Incident: settlements failing with `settle_exact_stellar_transaction_submission_failed`

Upstream's catch-all for "the network did not accept the submission". It does not distinguish
causes, so work through them in order:

1. **Soroban RPC health.** Most common. Check your provider; check
   `MOVO_FACILITATOR_<NET>_RPC_URL`.
2. **Sponsor unfunded.** `/ready` — a sponsor at zero cannot pay a fee.
3. **Sequence collision.** Only possible if `maxInFlightPerSigner` was raised above 1. Set it
   back.
4. **Fee ceiling.** If network fees have risen above `MOVO_FACILITATOR_<NET>_MAX_TX_FEE_STROOPS`,
   payments are rejected before submission with
   `invalid_exact_stellar_payload_fee_exceeds_maximum` — a different reason, so if you are seeing
   *that* one, raise the ceiling deliberately.

## Incident: suspected sponsor key compromise

Treat as a security incident. The blast radius is XLM, not customer funds.

1. **Remove the affected sponsor from configuration and deploy immediately.** The pool shrinks;
   the service keeps running at lower concurrency.
2. Sweep remaining XLM from the compromised account to treasury.
3. Provision and fund a replacement; add it to the pool; deploy.
4. Destroy the compromised key.
5. Audit: which settled transactions used that source account? Every hash is in the logs
   (`event: facilitator.settle`, field `transaction`) and on-chain.
6. If the key was in an environment variable, this incident is the argument for the KMS path.

## Incident: a caller's key is abusing the service

1. Identify from `/metrics` → `callers[]`. The `caller` field is the key **id**, never the
   secret.
2. Lower that key's limit: `MOVO_FACILITATOR_API_KEYS=…,noisy:secret:10`, deploy.
3. To revoke, remove the entry entirely and deploy. The next request gets 401 `unauthorized`.

## Degraded mode

What still works when a dependency fails:

| Failure | `/verify` | `/settle` | `/supported` | `/health` | `/ready` |
|---|---|---|---|---|---|
| Horizon down | works | works | works | 200 | **503** (balances unreadable) |
| Soroban RPC down | fails, reasoned | fails, reasoned | works | 200 | 200 |
| One sponsor unfunded | works | works at reduced concurrency | works | 200 | **503** |
| All sponsors unfunded | works | fails, reasoned | works | 200 | **503** |

`/supported` and `/health` never depend on a chain, so a monitoring system can always distinguish
"the service is down" from "the network it talks to is down".

Note the second row: with Soroban RPC down, `/ready` still reports ready because sponsor balances
are read from Horizon. That is a deliberate separation — readiness answers "can this instance
pay fees", not "is the whole network healthy" — but it means an RPC outage is detected through
settle failure rates, not through readiness. Alert on `settleFailed`.

## Rejection reasons

Two families. Only the second is Movo's.

**Protocol reasons** come from `@x402/stellar` unaltered. The payment itself is wrong:

| Reason | Meaning |
|---|---|
| `invalid_exact_stellar_payload_wrong_amount` / `_wrong_asset` / `_wrong_recipient` | Signed payload disagrees with the seller's requirements |
| `invalid_exact_stellar_payload_malformed` | Transaction XDR unparseable |
| `invalid_exact_stellar_payload_no_auth_entries` / `_missing_payer_signature` | Not signed by the payer |
| `invalid_exact_stellar_payload_unexpected_pending_signatures` | An authorization is still unsigned |
| `invalid_exact_stellar_payload_unsupported_credential_type` | Auth credential is not an address credential |
| `invalid_exact_stellar_signature_expiration_too_far` | Authorization valid too far into the future |
| `invalid_exact_stellar_payload_has_subinvocations` | Auth tree contains nested calls |
| `invalid_exact_stellar_payload_facilitator_in_auth` / `_facilitator_is_payer` / `_unsafe_tx_or_op_source` | **Non-custody violation** — the payload tried to place the facilitator in a forbidden position |
| `invalid_exact_stellar_payload_simulation_failed` | Simulation failed; commonly a replayed or expired authorization |
| `invalid_exact_stellar_payload_fee_exceeds_maximum` | Simulated fee above `MAX_TX_FEE_STROOPS` |
| `settle_exact_stellar_transaction_submission_failed` / `_transaction_failed` | Network did not accept or did not confirm |
| `network_mismatch` / `unsupported_scheme` / `invalid_network` | Wrong network or scheme |

**Transport reasons** are this service's, for requests that never reached the payment scheme:

| Reason | Status | Meaning |
|---|---|---|
| `invalid_request_body` | 400 | Body was not JSON |
| `invalid_request_shape` | 400 | Missing `paymentPayload` / `paymentRequirements` |
| `invalid_payment_payload` / `invalid_payment_requirements` | 400 | Failed upstream's schema |
| `payload_too_large` | 413 | Over `MAX_BODY_BYTES` |
| `unsupported_network` | 400 | No signer configured for that network |
| `unauthorized` | 401 | Missing or unknown bearer key |
| `rate_limited` | 429 | Over budget; `Retry-After` set |
| `signer_pool_exhausted` | 503 | No sponsor free within the acquire timeout |
| `service_not_ready` | 503 | Service declined before attempting settlement |

## Routine: adding a sponsor (no downtime)

1. Provision and fund a new account. It needs XLM only — no trustline, no USDC.
2. Append its seed to `MOVO_FACILITATOR_<NET>_SIGNER_SEEDS`, or its signer to the injected list.
3. Deploy. It joins the pool and starts taking work immediately.
4. Confirm it appears in `/supported` → `signers["stellar:*"]` and in `/ready`.

## Routine: upgrading `@x402/*`

The protocol layer is upstream's, and it ships roughly weekly with tight cross-package pins.

1. Bump all `@x402/*` together — they pin each other with `~`.
2. `pnpm check:licenses && pnpm check:protocol-purity && pnpm build && pnpm test`
3. `MOVO_E2E=1 pnpm test:e2e` against testnet. A real settlement is the only acceptable evidence.
4. Re-run the `/supported` comparison against the public reference facilitator (AC6.3). A shape
   change there is the failure that breaks every client at once.
5. `pnpm generate:compat` and commit `docs/COMPATIBILITY.md`.

## Multi-replica caveats, stated plainly

Rate limiting and metering are **in-memory and per-instance**. Three replicas means three times
the configured rate and three partial views of per-caller usage. Divide the limits by the replica
count, or put a shared limiter at the ingress. This is a deliberate trade — a distributed limiter
would put a datastore in the hot path of a service whose value is being cheap to self-host — and
it is documented rather than hidden.

The signer pool is also per-instance, and that one is **not** merely a caveat: two replicas
configured with the *same* sponsor seeds will collide on sequence numbers exactly as two
concurrent settlements on one account would. **Give each replica a disjoint sponsor set**, or run
a single instance and scale it vertically.
