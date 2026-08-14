# Buyer budgets

**A 402 is a claim, not a fact.**

A server can name any `payTo` it likes and any amount it likes. Nothing in the x402 protocol
prevents it. The facilitator will faithfully settle whatever the buyer signed, because settling
what was signed is precisely its job. **The buyer is the only party in the exchange that can
refuse.**

That makes budget controls security controls, not conveniences, and it makes the moment of
refusal load-bearing.

## Refusal happens before signing

```ts no-check
import { createBudget, createMovoClient } from "@movoframework/client";

const budget = createBudget({
  maxAmountPerRequest: "500000",        // 0.05 USDC at 7 decimals
  maxTotalSpend: "10000000",            // 1 USDC for this process
  allowedNetworks: ["stellar:testnet"],
  allowedPayTo: ["GCQQ…2NAM"],
  onRefusal: (refusal) => console.warn(refusal.code, refusal.reason),
});

const client = createMovoClient({ signer, network: "stellar:testnet", budget });
```

The budget is registered as an upstream `PaymentPolicy`, which upstream applies **before**
creating a payment. A refused offer therefore leaves **no signature in existence**.

That ordering is the whole design. A budget that rejected after signing would leave a valid,
signed authorisation lying around — one a server could retry, or that could leak from a log — and
"we chose not to submit it" is a far weaker guarantee than "it was never created". The test suite
asserts it with a signer spy, because the difference is invisible in a response body.

## The four controls

| Control | Stops |
|---|---|
| `maxAmountPerRequest` | A single inflated charge |
| `maxTotalSpend` | Slow drain across many small, individually plausible charges |
| `allowedPayTo` | Payment to an address you never intended, however reasonable the amount |
| `allowedNetworks` | A testnet-only buyer being talked onto mainnet by a 402 |

`allowedPayTo` deserves emphasis. Amount caps stop a server overcharging you; only an address
allowlist stops it redirecting a correctly-priced payment to somebody else's account. An agent
paying arbitrary discovered endpoints has no other defence.

## Cumulative spend is Movo's only addition

Upstream's `PaymentPolicy` is `(x402Version, requirements[]) => requirements[]` — stateless by
design, so it can enforce a per-request cap but has nowhere to keep a running total.
`createBudget` builds **on** that policy rather than replacing it, and adds the accountant.

Spend is recorded only when a payment **settles**, and from the amount the facilitator reports
settling. Counting at offer-selection time would charge you for payments that failed
verification.

```ts no-check
budget.spent();      // "500000"
budget.remaining();  // "9500000", or undefined when no total was set
budget.reset();
budget.refusals;     // every refusal, in order
```

All amounts are base units and all arithmetic is BigInt. A 7-decimal asset passes
`Number.MAX_SAFE_INTEGER` at roughly 900 million units, which is not a large balance — floating
point here would be a rounding bug waiting for a sufficiently rich buyer.

## Selection, not rejection

A 402 may carry several payment options. The policy is a **filter**: it keeps the offers you are
willing to pay and drops the rest, so an acceptable option is still paid rather than the whole
exchange being refused.

## Keys

**The signer is always supplied by the caller.** No Movo package generates, derives, stores or
persists a key, and CI greps for a keypair-generation path in every package.

`STELLAR_PRIVATE_KEY` belongs to a **buyer**. A Movo resource server never needs one — it names an
address to be paid, and the buyer signs. If you find yourself putting a secret seed in a server's
configuration, something has gone wrong; see `SECURITY.md`.
