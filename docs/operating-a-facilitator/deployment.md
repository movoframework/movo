# Deploying a Movo facilitator

A Movo facilitator is a small stateless HTTP service that verifies and settles x402 payments on
Stellar. It holds no customer funds, keeps no database, and stores nothing between requests
except in-memory counters. What it *does* hold is the sponsor keys that pay every transaction
fee, which is why most of this page is about them.

There are two deployment shapes, and both are supported deliverables.

## Shape 1 — the standalone service

`apps/facilitator` is a Hono service exposing `/verify`, `/settle`, `/supported`, `/health`,
`/ready` and `/metrics`.

```bash
docker build -t movo-facilitator -f apps/facilitator/Dockerfile .
docker run --rm -p 8402:8402 \
  -e MOVO_FACILITATOR_NETWORKS=stellar:testnet \
  -e MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS=S...,S...,S... \
  movo-facilitator
```

Point any x402 resource server at it:

```ts no-check
// Movo
await mountExpress(app, movoApp, {
  config: { argument: { facilitator: { url: "http://localhost:8402" } } },
});

// Or any stock x402 resource server
new HTTPFacilitatorClient({ url: "http://localhost:8402" });
```

## Shape 2 — self-facilitation inside your resource server

Run the facilitator in the same process as your paid API. There is no HTTP hop, no second
container, and no second thing to monitor — you settle your own payments with your own sponsor
accounts.

```ts no-check
import { createFacilitator, facilitatorConfigFromEnv } from "@movoframework/facilitator";
import { mountExpress } from "@movoframework/server";

const facilitator = createFacilitator(facilitatorConfigFromEnv(process.env));

await mountExpress(app, movoApp, {
  facilitator: facilitator.asFacilitatorClient(),
});
```

`asFacilitatorClient()` returns upstream's `FacilitatorClient`, so it drops into any x402
resource server, Movo's or not. It is the same composition, the same signer pool and the same
readiness as the standalone service — proven by the same stock client completing a real testnet
payment against it (AC6.12).

Choose this shape when you are the only seller using the facilitator. Choose shape 1 when
several services share one sponsor pool, or when you want the facilitator scaled and monitored
separately.

## Configuration

Everything is `MOVO_FACILITATOR_*`. `<NET>` is `TESTNET` or `PUBNET`.

| Variable | Default | Meaning |
|---|---|---|
| `MOVO_FACILITATOR_NETWORKS` | `stellar:testnet` | Comma-separated CAIP-2 networks to serve |
| `MOVO_FACILITATOR_<NET>_SIGNER_SEEDS` | — | **Required.** Comma-separated sponsor seeds, one per channel account |
| `MOVO_FACILITATOR_<NET>_FEE_BUMP_SEED` | — | Optional fee source; decouples fee payment from sequencing |
| `MOVO_FACILITATOR_<NET>_RPC_URL` | upstream default | Soroban RPC. **Required on pubnet** — there is no public mainnet default |
| `MOVO_FACILITATOR_<NET>_SPONSOR_FLOOR_XLM` | `5` | `/ready` fails below this |
| `MOVO_FACILITATOR_<NET>_MAX_TX_FEE_STROOPS` | `50000` | Fee ceiling; a payment simulating above it is rejected |
| `MOVO_FACILITATOR_<NET>_ARE_FEES_SPONSORED` | `true` | Advertised on `/supported` as `extra.areFeesSponsored` |
| `MOVO_FACILITATOR_AUTH_MODE` | `open` | `open` or `bearer` |
| `MOVO_FACILITATOR_API_KEYS` | — | `id:secret[:limit]`, comma-separated. Setting this implies `bearer` |
| `MOVO_FACILITATOR_RATE_LIMIT` | on | Set to `off` to disable |
| `MOVO_FACILITATOR_RATE_LIMIT_PER_KEY` | `600` | Requests per window per caller |
| `MOVO_FACILITATOR_RATE_LIMIT_PER_IP` | `120` | Requests per window per source address |
| `MOVO_FACILITATOR_RATE_LIMIT_WINDOW_MS` | `60000` | Window length |
| `MOVO_FACILITATOR_SETTLE_FEE_STROOPS` | `0` | **Your** fee per settlement, accrued on `/metrics` |
| `MOVO_FACILITATOR_MAX_BODY_BYTES` | `131072` | Request body cap |
| `PORT` | `8402` | Listen port |

The service refuses to start rather than start wrong. An empty seed list, a duplicate sponsor,
pubnet without an RPC URL, or bearer mode with no keys each fail at boot with
`MOVO_E_FACILITATOR_CONFIG_INVALID` and a message naming the field.

### Testnet is free and keyless, by default and on purpose

`MOVO_FACILITATOR_AUTH_MODE` defaults to `open`. A testnet facilitator that demanded an API key
would not be the thing the RFP asks for. Turn on bearer auth for pubnet, or for any deployment
whose sponsor accounts hold real XLM.

### The operator fee is a configuration value, never a hard-coded one

`MOVO_FACILITATOR_SETTLE_FEE_STROOPS` defaults to zero. When set, it accrues per caller on
`/metrics` as `accruedFeeStroops`. It is deliberately **not** a field on any protocol response —
the x402 verify/settle/supported shapes are upstream's and this service adds nothing to them.
Movo ships the accounting; billing on it is between you and your callers. A fork that wants to
remove the fee entirely deletes nothing: it leaves the default.

## Production checklist

- [ ] Sponsor keys injected from a KMS/HSM, not from environment seeds — see
      [signers-and-channel-accounts.md](signers-and-channel-accounts.md)
- [ ] Enough sponsors for your peak concurrency (**pool size is the concurrency ceiling**)
- [ ] `MOVO_FACILITATOR_<NET>_RPC_URL` set to an RPC provider you have an agreement with
- [ ] `/ready` wired to your load balancer; `/health` wired to your liveness probe
- [ ] Sponsor balance alerting below the floor, not at it
- [ ] `MOVO_FACILITATOR_AUTH_MODE=bearer` and per-key limits set
- [ ] Behind a proxy that sets `X-Forwarded-For` (per-IP limiting reads it; exposed directly, it
      becomes caller-controlled and only the per-key limit is real)
- [ ] Rate limits divided by replica count, or a shared limiter at the ingress — the built-in
      limiter is in-memory and therefore per-instance
- [ ] `pnpm check:licenses` green in your fork's CI if you add dependencies

## Health, readiness and metrics

`/health` is liveness. It answers from process state and touches no chain — a Horizon blip must
not restart a healthy container.

`/ready` is readiness, and it reads **real sponsor balances from Horizon**. It returns 503 when
any sponsor is below its floor or when a balance could not be read at all. An unknown balance is
not a passing balance: a facilitator that accepts payments it cannot pay the fee for is worse
than one that declines them.

`/metrics` reports per-caller counters, sponsor addresses, floors, and **queue depth**. Queue
depth is the number that tells you the pool is undersized.

## What this service is not

It never holds customer funds. It is not a wallet, not a custodian, and not a settlement
database. For any settled payment the facilitator address appears as none of the operation
source, the transfer `from`, or any address in an authorization entry — asserted by test
(AC6.6). It *is* the settled transaction's source account, because that is what paying the fee
means; see [ADR-0012](../adr/0012-facilitator-architecture.md) §6.
