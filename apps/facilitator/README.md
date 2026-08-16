# Movo facilitator service

A self-hostable, Apache-2.0 Stellar x402 facilitator. It verifies and settles `exact`-scheme
payments on `stellar:testnet` and `stellar:pubnet`, sponsors the transaction fee, and holds no
customer funds.

It contains no cryptography of its own. Auth-entry validation, simulation, expiry checking,
transaction rebuild, signing, fee bumping, submission and confirmation all belong to
[`@x402/stellar`](https://github.com/x402-foundation/x402). This service adds the operational
tier: a signer pool with channel accounts, balance floors, readiness, metering, rate limiting
and the HTTP surface.

## Run it on testnet in two minutes

Testnet is free and keyless. You need one funded account to sponsor fees.

```bash
# 1. Provision a sponsor and fund it (Friendbot is free; no captcha, no key).
#    Use the Stellar CLI, or any wallet — Movo never generates a key for you.
stellar keys generate sponsor-1 --network testnet --fund
SEED=$(stellar keys show sponsor-1)

# 2. Run.
docker build -t movo-facilitator -f apps/facilitator/Dockerfile .
docker run --rm -p 8402:8402 \
  -e MOVO_FACILITATOR_NETWORKS=stellar:testnet \
  -e MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS="$SEED" \
  movo-facilitator
```

Or without Docker, from the repository root:

```bash
pnpm install && pnpm build
MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS="$SEED" node apps/facilitator/dist/server.js
```

Check it:

```bash
curl -s localhost:8402/supported | jq
# {"kinds":[{"x402Version":2,"scheme":"exact","network":"stellar:testnet",
#            "extra":{"areFeesSponsored":true}}],
#  "extensions":[],"signers":{"stellar:*":["G…"]}}

curl -s localhost:8402/ready | jq   # 200 when every sponsor is above its XLM floor
curl -s localhost:8402/health       # liveness; never touches a chain
```

Then point any x402 resource server at `http://localhost:8402` and take a payment.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/verify` | Verify a signed payment against requirements |
| `POST` | `/settle` | Verify and submit on-chain |
| `GET` | `/supported` | Advertised networks, schemes and the Stellar `extra` |
| `GET` | `/health` | Liveness. Process state only |
| `GET` | `/ready` | Readiness. Reads real sponsor balances; 503 below the floor |
| `GET` | `/metrics` | Per-caller counters, sponsor addresses, floors, queue depth |

`/verify`, `/settle` and `/supported` implement the x402 wire contract exactly as
`HTTPFacilitatorClient` expects it. Requests and responses are upstream's shapes, unextended —
this service adds no field to any protocol response.

**Every rejection carries a non-null, machine-readable reason**, at every status code, in the
protocol's own response shape. A caller branches on `invalidReason` / `errorReason` rather than
parsing prose. The full vocabulary is in
[the runbook](../../docs/operating-a-facilitator/runbook.md#rejection-reasons).

## Configuration

Full table in [deployment.md](../../docs/operating-a-facilitator/deployment.md). The four that
matter most:

| Variable | Default | |
|---|---|---|
| `MOVO_FACILITATOR_NETWORKS` | `stellar:testnet` | Networks to serve |
| `MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS` | — | **Required.** One seed per channel account |
| `MOVO_FACILITATOR_TESTNET_SPONSOR_FLOOR_XLM` | `5` | `/ready` fails below this |
| `MOVO_FACILITATOR_AUTH_MODE` | `open` | `bearer` to require an API key |

The service refuses to start rather than start wrong: an empty seed list, a duplicate sponsor,
pubnet without an RPC URL, or bearer mode with no keys each fail at boot with a message naming
the field.

## Two things to know before production

**Pool size is your concurrency ceiling.** Stellar serialises transactions per source account,
so one sponsor settles one payment at a time. The pool queues rather than colliding — measured:
25 sponsors, 200 concurrent settlements, 200 settled, zero failures. Beyond capacity, requests
queue and then fail with `signer_pool_exhausted`; they are never lost. See
[signers-and-channel-accounts.md](../../docs/operating-a-facilitator/signers-and-channel-accounts.md).

**Do not put a pubnet sponsor seed in an environment variable.** `FacilitatorStellarSigner` is a
structural type, so a KMS or HSM signer plugs into `resolveFacilitatorConfig` with no Movo code.
The service logs a warning on every start if you configure pubnet from seeds.

## Self-facilitation

The same facilitator runs in-process inside your resource server, with no HTTP hop:

```ts
const facilitator = createFacilitator(facilitatorConfigFromEnv(process.env));
await mountExpress(app, movoApp, { facilitator: facilitator.asFacilitatorClient() });
```

`asFacilitatorClient()` returns upstream's `FacilitatorClient`, so it works with any x402
resource server, Movo's or not.

## Licence

Apache-2.0. There is no AGPL, SSPL or GPL anywhere in the dependency path, and
`pnpm check:licenses` fails the build if that ever changes. The OpenZeppelin Relayer and its
x402 facilitator plugin are AGPL-3.0-or-later and are **not** used as a dependency, a base, a
fork or a vendored source — which is the reason this service exists as its own implementation.
See [ADR-0012](../../docs/adr/0012-facilitator-architecture.md).
