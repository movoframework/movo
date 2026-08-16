# Signers and channel accounts

Two things live on this page: how to keep the sponsor key safe, and how many sponsor accounts
you need. They are the two decisions that determine whether a facilitator is safe and whether it
is fast.

## The sponsor key is the highest-value secret in the system

It pays every transaction fee and is the source account of every settled transaction. Someone
holding it can drain your sponsor accounts through fees. It cannot move a buyer's funds — that
is the non-custody invariant, and it holds — but "cannot steal customer money" is not the same
as "safe to leave in an environment variable".

### Production: inject a signer, never a seed

`FacilitatorStellarSigner` is a **structural** type:

```ts no-check
type FacilitatorStellarSigner = {
  address: string;
  signAuthEntry: SignAuthEntry;
  signTransaction: SignTransaction;
};
```

Anything satisfying those three members is a valid sponsor. Movo never asks where a signature
came from, so a KMS, an HSM, a remote signing service or a hardware wallet works with no Movo
code and no Movo release:

```ts no-check
import { createFacilitator, resolveFacilitatorConfig } from "@movoframework/facilitator";

const kmsSigner: FacilitatorStellarSigner = {
  address: await kms.publicAddress("facilitator-sponsor-1"),
  signAuthEntry: async (entryXdr, opts) => ({
    signedAuthEntry: await kms.signAuthEntry("facilitator-sponsor-1", entryXdr, opts),
    signerAddress: address,
  }),
  signTransaction: async (txXdr, opts) => ({
    signedTxXdr: await kms.signTransaction("facilitator-sponsor-1", txXdr, opts),
    signerAddress: address,
  }),
};

const facilitator = createFacilitator(
  resolveFacilitatorConfig({
    networks: [{
      network: "stellar:pubnet",
      signers: [kmsSigner /* , … */],
      rpcUrl: process.env.SOROBAN_RPC_URL,
      sponsorFloorXlm: 50,
    }],
  }),
);
```

No raw seed exists in the process. This is the production path, and it is the reason
`resolveFacilitatorConfig` — not `facilitatorConfigFromEnv` — is the primary API.

### Development: seeds from the environment

`facilitatorConfigFromEnv(process.env)` reads
`MOVO_FACILITATOR_<NET>_SIGNER_SEEDS` and derives signers with upstream's `createEd25519Signer`.
It is convenient, it is what testnet uses, and **it is not suitable for pubnet**. Configuring
pubnet this way logs a warning on every start; it is not blocked, because an operator running a
KMS sidecar that materialises a seed in-memory has made an informed choice, but the warning is
there so nobody arrives at it by accident.

Movo never generates a key. `scripts/check-key-generation.ts` fails the build on `Keypair.random`
anywhere in `packages/` or `tests/`. Provision sponsors with the Stellar CLI or your KMS, and
fund them yourself.

### Rotation

Sponsors are a list, so rotation is a rolling configuration change with no downtime:

1. Add the new sponsor to the list and deploy. It starts taking a share of traffic immediately.
2. Wait for in-flight settlements on the old sponsor to drain (`/metrics` → `inFlight` reaches 0
   for that address).
3. Remove the old sponsor and deploy.
4. Sweep its remaining XLM and destroy the key.

Never remove a sponsor whose `inFlight` is non-zero: its settlement is mid-submission and you
will lose the ability to observe the outcome.

## Channel accounts: why pool size is your concurrency ceiling

### The constraint

Stellar serialises transactions per source account by sequence number.
`ExactStellarScheme.settle()` reads the chosen sponsor's sequence number with
`getAccount(address)` and builds a transaction from it. Two settlements that read the same
account at the same instant read the **same** sequence number, and the network accepts exactly
one of them.

This is not a tuning issue. It is the throughput ceiling, and it arrives long before RPC or CPU.

### What we measured

With five funded sponsors, on Stellar testnet, against a pool that merely spread load across
accounts by picking the least-loaded one:

| Concurrent settlements | Settled | Failed |
|---|---|---|
| 5 | 5 | 0 |
| 10 | 5 | 5 |
| 200 | 5 | 195 |

Exactly one per account. Spreading distributes collisions; it prevents none.

### What the pool does instead

An account is a **mutex**, not a weight. `SignerPool.acquire()` hands out one lease per account
and *waits* when every account is busy. Excess concurrency queues rather than colliding.

With 25 sponsors, 200 concurrent settlements produce **200 settlements and zero failures**
(AC6.8).

### Sizing

```
sustained settlements per second  ≈  pool size ÷ settlement latency
```

Settlement latency on testnet is roughly 1–3 seconds, dominated by submission and confirmation
polling. So:

| Sponsors | Rough sustained throughput | Rough burst absorbed within the 60s acquire timeout |
|---|---|---|
| 5 | ~2–5 /s | ~120–300 |
| 25 | ~8–25 /s | ~600–1500 |
| 50 | ~16–50 /s | ~1200–3000 |

Size for peak concurrency, not average. Agent traffic is bursty by nature — that assumption is
recorded in spec §8.2 and it is why this was designed in rather than retrofitted.

### The failure mode, and why it is a good one

Beyond capacity, settlements **queue**. Beyond the acquire timeout (60s), they are rejected with
`signer_pool_exhausted` — a 503 with a machine-readable reason. They are never silently dropped
and never lost. `/metrics` reports `waiting` per network; sustained non-zero queue depth is the
signal to add sponsors, and adding sponsors is a configuration change.

### Fee-bump signers

Setting `MOVO_FACILITATOR_<NET>_FEE_BUMP_SEED` makes upstream wrap each settled transaction in a
`FeeBumpTransaction` whose fee source is that account. This decouples *paying* the fee from
*holding the sequence number*: the pool accounts advance sequence numbers, one funded account
pays for all of them.

Use it when you would rather top up one account than twenty-five. Note that the fee-bump signer
is itself advertised in `/supported`'s `signers` block and is subject to the same non-custody
invariant. It does not raise the concurrency ceiling — sequencing is still per pool account.

### Funding

Each sponsor needs XLM for fees and the base reserve. Fees observed on testnet are ~23,000
stroops (0.0023 XLM) per settlement.

- **Testnet:** fund from `https://friendbot.stellar.org?addr=<G…>`. Free and keyless.
- **Pubnet:** fund from treasury. Set `sponsorFloorXlm` well above one day of expected fee spend
  so `/ready` sheds traffic before an account actually runs dry, and alert *below the floor*,
  not at it.

A sponsor needs **no trustline** and **no USDC**. It never holds the asset being transferred —
it only pays the fee and sources the transaction.
