# Quickstart — zero to a settled testnet payment

What you will have at the end: an HTTP API with one paid route, and a real USDC payment settled
on Stellar testnet, confirmed on-chain.

You need Node ≥22, pnpm 10.x, and about fifteen minutes — most of it waiting on a captcha.

## 1. Accounts, funding, trustlines

Do [the Stellar setup](stellar/setup.md) first. It is four steps and the third one — the USDC
trustline — is the one that, if skipped, produces a payment failure whose message says nothing
about the account that caused it.

You need two accounts: a **seller** (receives; needs a trustline) and a **buyer** (pays; needs a
trustline *and* a USDC balance).

## 2. Declare a resource

```ts
import { defineApp, defineResource } from "@movoframework/core";

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current weather conditions for a city",
  mimeType: "application/json",
  handler: (ctx) => ({ city: ctx.params["city"], tempC: 14, conditions: "foggy" }),
});

export default defineApp({ resources: [weather] });
```

One declaration carries the route, the price and the handler. There is no routes object to keep in
sync and no discovery metadata duplicating either.

## 3. Configure

```ts
import { defineConfig } from "@movoframework/core";

export default defineConfig({
  env: "testnet",
  network: "stellar:testnet",
  payTo: process.env["MOVO_PAY_TO"],
  facilitator: { url: "https://www.x402.org/facilitator" },
});
```

`MOVO_PAY_TO` is your seller's **public** address — the `G…` one. It is published in every 402
response. Movo rejects an `S…` secret seed here at startup rather than letting it reach the wire.

The default facilitator is free, needs no key, and sponsors network fees: your buyer pays the
asset amount and none of the Stellar fee.

## 4. Check before you run

```ts no-check
import { resolveConfig } from "@movoframework/core";
import { preflight } from "@movoframework/stellar";

for (const finding of await preflight(resolveConfig())) {
  console.log(`[${finding.level}] ${finding.title}`);
  if (finding.fix) console.log(`  fix: ${finding.fix}`);
}
```

Six checks, run most-fundamental-first. Fix anything at `error` level before continuing — each one
carries a copy-pasteable remedy.

## 5. Mount and run

```ts no-check
import express from "express";
import { mountExpress } from "@movoframework/server";
import app from "./app.js";
import config from "./movo.config.js";

const server = express();
server.use(express.json());

server.get("/health", (_request, response) => response.json({ ok: true }));

await mountExpress(server, app, { config: { config } });
server.listen(4021);
```

`/health` is an ordinary Express route the payment middleware never touches. Only paths declared
through `defineResource` are protected.

## 6. See the 402

```bash
curl -i localhost:4021/weather/SFO
```

```
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Miwi...
```

Decode it to see exactly what is being asked for:

```ts no-check
import { decodePaymentRequiredHeader } from "@movoframework/core";

const decoded = decodePaymentRequiredHeader(header);
console.log(decoded.accepts[0]);
// { scheme: "exact", network: "stellar:testnet",
//   asset: "CBIELTK6…DAMA", amount: "10000",
//   payTo: "GCQQ…2NAM", maxTimeoutSeconds: 60, extra: { areFeesSponsored: true } }
```

`amount` is `10000`, not `0.001`. USDC has 7 decimals, so that is `$0.001` in base units. Movo
never performs that conversion itself — `@x402/stellar` does it against the asset's real decimals.

## 7. Pay it

The buyer is an ordinary x402 client. Movo has no client package yet (that is M4), and nothing
here is Movo-specific:

```ts no-check
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";

const client = new x402Client().register(
  "stellar:testnet",
  new ExactStellarScheme(createEd25519Signer(process.env.STELLAR_PRIVATE_KEY, "stellar:testnet")),
);

const paid = await wrapFetchWithPayment(fetch, client)("http://localhost:4021/weather/SFO");
console.log(paid.status);            // 200
console.log(await paid.json());      // { city: "SFO", tempC: 14, conditions: "foggy" }
```

`STELLAR_PRIVATE_KEY` is the **buyer's** secret. It belongs to the client and never to the server.

## 8. Confirm it on-chain

Do not take the response header's word for it:

```ts no-check
import { decodePaymentResponseHeader } from "@movoframework/core";

const settle = decodePaymentResponseHeader(paid.headers.get("PAYMENT-RESPONSE"));
const tx = await fetch(`https://horizon-testnet.stellar.org/transactions/${settle.transaction}`);
console.log((await tx.json()).successful);   // true
```

This is the step Movo's own e2e suite treats as mandatory. Asserting on the header alone would let
a fabricated settlement pass; fetching the transaction from Horizon asks a source that is neither
the server nor the facilitator.

Look at `source_account` on that transaction. It is the facilitator's, not the buyer's — which is
fee sponsorship, visible.

## When something goes wrong

Run preflight first; it catches most of it. Beyond that:

| Symptom | Likely cause |
|---|---|
| 402 that never becomes 200 | Buyer has no USDC, or no trustline |
| Payment rejected, message about the asset | Seller has no trustline — the account at fault is not the one named |
| `MOVO_E_PAYTO_INVALID` at startup | `MOVO_PAY_TO` holds an `S…` seed instead of a `G…` address |
| `MOVO_E_PUBNET_NOT_ENABLED` | `env: "pubnet"` without `MOVO_ALLOW_PUBNET=1`. Deliberate friction |
| Payments expire intermittently | Clock skew, or `maxTimeoutSeconds` too small. Both are preflight checks |

Every error code has a page: [error reference](reference/errors.md).

## What to read next

- [Resources](concepts/resources.md) — prices, paths, typed input and output
- [Configuration](concepts/configuration.md) — the five layers and their provenance
- [The payment lifecycle](concepts/payment-lifecycle.md) — including why a paid route cannot
  stream, and why a route that 404s costs the buyer nothing
