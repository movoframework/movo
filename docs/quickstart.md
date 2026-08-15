# Quickstart — zero to a settled testnet payment

What you will have at the end: an HTTP API with one paid route, and a real USDC payment settled
on Stellar testnet, confirmed on-chain.

You need Node ≥22 and about fifteen minutes — most of it waiting on a captcha.

## 1. Accounts, funding, trustlines

Do [the Stellar setup](stellar/setup.md) first. It is four steps and the third one — the USDC
trustline — is the one that, if skipped, produces a payment failure whose message says nothing
about the account that caused it.

You need two accounts: a **seller** (receives; needs a trustline) and a **buyer** (pays; needs a
trustline *and* a USDC balance from [Circle's faucet](https://faucet.circle.com), which is
captcha-gated).

Keep both addresses to hand. You do not need to configure anything yet.

## 2. Create the project

```bash
npm create movo-app my-api
cd my-api
npm install
```

That is a real, working project: `movo.config.ts`, one resource, a server, a test, an
`.env.example`, and a README with these same commands. `--template discoverable` gives you the
same thing plus Bazaar discovery metadata and a buyer script.

```bash
cp .env.example .env
```

Then set `MOVO_PAY_TO` in `.env` to your **seller's** `G…` address. It is a public address, never
a secret — a Movo resource server signs nothing.

## 3. Run the doctor

```bash
npx movo doctor
```

This is the step that saves the afternoon. It checks your Node version, your `@x402/*` pins, your
configuration, whether the `payTo` account exists and is funded, whether it has a trustline for
the asset you are charging in, whether the asset contract resolves, whether your facilitator is
reachable and advertises your network — and prints a fix for each thing it finds.

```text
Resolved configuration
  env                         testnet                                                   from config
  network                     stellar:testnet                                           from config
  payTo                       GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E  from env
  facilitator.url             https://www.x402.org/facilitator                          from config
  ...

Environment
  ok    Node.js version
        v24.14.0 (minimum 22).
  ok    @x402/* versions match docs/COMPATIBILITY.md

Configuration
  ok    configuration resolves
  ok    resources compile
        1 paid route(s).

Stellar
  ok    payTo account exists and is funded
  ok    trustline to the configured asset
  ...

11 ok  0 warning  0 error
```

**Fix everything at `error` level before continuing.** Each finding carries a copy-pasteable
remedy — friendbot's URL for an unfunded account, the Circle faucet for a missing balance.

The `from …` column is worth a second look. Five configuration layers
(`default < config < env < resource < argument`) and this table says which one supplied each
value. When a payment goes somewhere unexpected, this is the answer.

## 4. Start the server

```bash
npx movo dev
```

```text
Facilitator  config

Paid resources  1
  GET /weather/:city  $0.001  stellar:testnet  →  GCQQ4LGCX…MK4AMQ4E

  listening on http://localhost:4021
```

## 5. See the 402

```bash
curl -i localhost:4021/weather/SFO
```

```text
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Miwi...
```

The body is empty. That is the protocol's shape, not an omission — the payment requirements
travel in the header. Decode it to see what is being asked for:

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

`areFeesSponsored: true` means the facilitator pays the Stellar network fee. Your buyer pays the
asset amount and nothing else.

## 6. Pay it

Set `STELLAR_PRIVATE_KEY` in `.env` to your **buyer's** seed. This is a buyer key; a resource
server never needs one.

```ts no-check
import { createBudget, createMovoClient } from "@movoframework/client";
import { createEd25519Signer } from "@movoframework/core/client";

const budget = createBudget({
  maxAmountPerRequest: "10000",          // 0.001 USDC at 7 decimals
  maxTotalSpend: "100000",
  allowedNetworks: ["stellar:testnet"],
});

const client = createMovoClient({
  signer: createEd25519Signer(process.env["STELLAR_PRIVATE_KEY"], "stellar:testnet"),
  network: "stellar:testnet",
  budget,
});

const paid = await client.fetch("http://localhost:4021/weather/SFO");
console.log(paid.status);            // 200
console.log(await paid.json());      // { city: "SFO", tempC: 14, conditions: "foggy" }
```

The budget is not decoration. A 402 is a **claim**: a server can name any `payTo` and any amount,
and the facilitator will faithfully settle whatever was signed. The buyer is the only party that
can refuse, and refusal happens **before** signing — so a refused offer leaves no signed
authorisation in existence. See [buyer budgets](security/buyer-budgets.md).

If you used `--template discoverable`, all of this is already in `src/buyer.ts`:

```bash
npm run buyer
```

## 7. Confirm it on-chain

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

Look at `source_account` on that transaction. It is the facilitator's, not the buyer's — fee
sponsorship, visible.

**You are done.** A real payment, settled on Stellar, confirmed independently.

## Running your tests

```bash
npm test
```

The generated test needs no keys, no funds and no network — it uses `MockFacilitator`, which makes
orchestration deterministic. It is not a settlement simulator and does not pretend to be one.

For real settlement in a hermetic loop, with no third-party facilitator:

```bash
npx movo dev --facilitator in-process
```

That performs genuine verification and genuine on-chain settlement using your
`STELLAR_PRIVATE_KEY`. It refuses to run on mainnet.

## When something goes wrong

Run `npx movo doctor`; it catches most of it and explains what it finds. Beyond that:

| Symptom | Likely cause |
|---|---|
| 402 that never becomes 200 | Buyer has no USDC, or no trustline |
| Payment rejected, message about the asset | **Seller** has no trustline — the account at fault is not the one named |
| `MOVO_E_PAYTO_INVALID` at startup | `MOVO_PAY_TO` holds an `S…` seed instead of a `G…` address |
| `MOVO_E_PUBNET_NOT_ENABLED` | `env: "pubnet"` without `MOVO_ALLOW_PUBNET=1`. Deliberate friction |
| `MOVO_E_FACILITATOR_PUBNET_REFUSED` | `--facilitator in-process` on mainnet. Use a real facilitator |
| Cannot find module `./app.js` | Node does not rewrite specifiers. Import `./app.ts` |
| Payments expire intermittently | Clock skew, or `maxTimeoutSeconds` too small. Both are doctor checks |

Every error code has a page: [error reference](reference/errors.md).

## What to read next

- [The CLI](cli/overview.md) — all four commands
- [`movo doctor`](cli/doctor.md) — every check, what it means, how to fix it
- [Resources](concepts/resources.md) — prices, paths, typed input and output
- [Configuration](concepts/configuration.md) — the five layers and their provenance
- [The payment lifecycle](concepts/payment-lifecycle.md) — including why a paid route cannot
  stream, and why a route that 404s costs the buyer nothing
- [Discovery](bazaar/overview.md) — being found by agents, and what Movo cannot promise
