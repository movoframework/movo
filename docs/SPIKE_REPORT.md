# Spike report — x402 payment settled on Stellar testnet

- **Branch:** `spike/x402-stellar-e2e` (deleted; never merged)
- **Date:** 2026-08-10
- **Milestone:** M0, gate 1 part A
- **Verdict:** **PASS** — all five success criteria met.

## Hypothesis

> A Movo-shaped resource can receive and settle a genuine x402 payment on Stellar testnet using
> only `@x402/core`, `@x402/stellar`, `@x402/express` and `@x402/fetch`, with zero
> reimplementation of protocol primitives.

**Confirmed.** A ~100-line server and client, composed entirely of official exports, took a
payment from an unpaid 402 through to a transaction confirmed on Stellar testnet. No XDR was
constructed, no signature was verified, and no header was built by hand.

## The transaction

| Field | Value |
|---|---|
| **Transaction hash** | `4f2677b2664200468e240234da837b87bca6505df84e47d9a9bf836be10a4d50` |
| Successful | `true` |
| Ledger | `4066852` |
| Closed at | `2026-08-10T09:45:59Z` |
| Operation | `invoke_host_function` → `InvokeContract(Address, Sym, Address, Address, I128)` — a SEP-41 `transfer` |
| Payer (buyer) | `GDIONU2OOPFE5TAVLPNITGJH6KUIEAHJOTG2SDH3D332LNJ5B6C5LCAR` |
| `payTo` (seller) | `GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3` |
| Transaction source (fee payer) | `GC6CSXBV4C6RL3HEDTW57KXYXSSXKAWKGYDEOSATXM3XNKXSR2VRYN3K` — **the facilitator**, not the buyer |
| Fee charged | 23,053 stroops, paid by the facilitator |
| Amount | `1000000` (0.1 token at 7 decimals) |
| Facilitator | `https://www.x402.org/facilitator` (free, keyless) |

Verify independently:

```
https://horizon-testnet.stellar.org/transactions/4f2677b2664200468e240234da837b87bca6505df84e47d9a9bf836be10a4d50
```

The transaction's source account being the facilitator's rather than the buyer's is the
practical demonstration of `areFeesSponsored: true`: the buyer paid the asset amount and none
of the network fee.

## Success criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Unpaid request returns 402 with a decodable `PAYMENT-REQUIRED` | **PASS** — 402; `decodePaymentRequiredHeader` yielded `{ scheme: "exact", network: "stellar:testnet", amount: "1000000", asset, payTo, maxTimeoutSeconds: 300, extra: { areFeesSponsored: true } }` |
| 2 | The paid retry returns 200 with the resource body | **PASS** — `200 {"temperatureC":21,"summary":"clear"}` |
| 3 | `PAYMENT-RESPONSE` carries a transaction reference | **PASS** — `{ success: true, payer, transaction, network: "stellar:testnet" }` |
| 4 | That transaction is independently confirmed on-chain | **PASS** — fetched from Horizon directly, not from the server or the facilitator: `successful: true`, ledger 4066852 |
| 5 | No XDR construction, signature verification or header building written | **PASS** — see the import list below; every protocol operation came from an official export |

Ledger-level corroboration: buyer balance went 1000.0000000 → 999.9000000, seller 0 →
0.1000000. Exactly one transfer occurred across the whole spike.

## Deviation: the asset is a self-issued test token, not Circle USDC

This is the one thing that did not go to plan, and it is recorded rather than hidden.

The `@x402/stellar` README directs developers to obtain testnet USDC from
[Circle's faucet](https://faucet.circle.com/). That faucet is a captcha-gated web application;
its GraphQL endpoint responds but has introspection disabled, and there is no documented API.
Attempting to work around a third-party service's bot protection would be both inappropriate
and unreliable as evidence.

Instead the spike issued its own classic testnet asset (`MVT`), deployed its Stellar Asset
Contract (`CD4PXYSBBM3XA4NOGPDL64X6CW3CPU2CQ2X6KK7BTMPXS2Q33LNGJBX3`), and priced the resource
in it by passing an `AssetAmount` rather than a `Money` string:

```js
price: { asset: sacContractId, amount: "1000000" }   // Price = Money | AssetAmount
```

**Why this does not weaken the result.** The Stellar `exact` scheme transfers a SEP-41 token by
contract address. A Stellar Asset Contract implements exactly that interface, so the code path
exercised — auth entry construction, signing, facilitator verification, simulation, submission,
settlement — is identical. The only difference is the value of `asset` in the payment
requirements, which is a configuration field, not a protocol primitive. Notably the public
facilitator settled a **non-USDC** asset without complaint, which is itself a useful finding:
it does not enforce an asset allowlist on `stellar:testnet`.

**What remains unverified:** that Circle testnet USDC specifically settles end to end. Since
USDC's contract address is an upstream constant (`USDC_TESTNET_ADDRESS`) and Movo never
hard-codes it, the residual risk is low, but **M2 must confirm a settlement in real testnet
USDC** with a manually funded account before any support claim is made.

## Q1 — Does settlement occur before or after the route handler runs?

**After. And a failing handler is not charged for.** Determined empirically by making a handler
throw, exactly as the milestone required.

Observed with a route whose handler logs and then throws:

```
[server] /boom HANDLER ENTERED — verification must already have succeeded
Error: SPIKE: handler failed after payment was verified
```

| Observation | Value |
|---|---|
| Handler executed | **Yes** — verification had already succeeded |
| HTTP status | **500** (Express's error handler) |
| `PAYMENT-RESPONSE` header | **Absent** |
| Buyer charged | **0.0000000** — balance unchanged before and after |

The precise ordering, read from `@x402/express/dist/esm/index.mjs` to explain what was
observed:

1. **Verify runs before the handler.** A failed verification returns 402 and the handler never
   runs.
2. The middleware then **patches `res.writeHead` / `write` / `end` / `flushHeaders` and buffers
   the entire response**, and calls `next()`.
3. If the handler **throws** → `cancellationDispatcher.cancel({ reason: "handler_threw" })`,
   buffered output is discarded, and the error is forwarded to Express. **No settlement.**
4. If the handler completes but `res.statusCode >= 400` →
   `cancel({ reason: "handler_failed", responseStatus })`, and the buffered response is flushed
   through unchanged. **No settlement.**
5. Otherwise → `processSettlement(payload, requirements, extensions, { responseBody,
   responseHeaders })`, then the buffered response is flushed with `PAYMENT-RESPONSE` attached.

**Consequences for Movo, and they are significant:**

- The "charging for failed work" risk in the spec's security table is **already handled
  upstream**. Movo must assert this with a test rather than implement it.
- The response body is **fully buffered until settlement completes**. Movo must document this,
  and it means streaming or SSE responses behind a paid route will not behave as an author
  expects. This deserves an explicit note in the resource-module documentation and a check in
  `movo doctor`.
- The settlement payload receives the response body and headers, so a Movo hook can make
  settlement conditional on response content.
- `onVerifiedPaymentCanceled` fires with a machine-readable reason (`handler_threw` /
  `handler_failed`) — a natural place to hang Movo's diagnostics.

This resolves spec **OQ-1**: document upstream's behaviour, do not override it.

## Q2 — Is the `fee: "1"` transaction-clone workaround still required?

**No.** It was never applied at any point in this spike, and settlement succeeded on the first
attempt with the facilitator paying a fee of 23,053 stroops.

The workaround was tried "without it first" as instructed, and the without-it path worked, so
there was nothing to fall back to. This resolves spec **OQ-2** in the direction of deletion:
**do not implement the flag.** If a fee-limit failure is ever observed, it should be filed as a
`protocol-drift` issue with its trigger condition rather than pre-emptively coded around.

## Q3 — `paymentMiddleware` or `paymentMiddlewareFromConfig`?

The spike used `paymentMiddlewareFromConfig` and it worked. **For Movo, it is the wrong mount
point.** There are three, and the choice is about access to lifecycle hooks:

| Export | Takes | Hook access |
|---|---|---|
| `paymentMiddlewareFromConfig(routes, facilitatorClients?, schemes?, …)` | Plain config | **None** — the `x402ResourceServer` is constructed internally and never exposed |
| `paymentMiddleware(routes, server, …)` | A prebuilt `x402ResourceServer` | All seven server hooks |
| `paymentMiddlewareFromHTTPServer(httpServer, …)` | A prebuilt `x402HTTPResourceServer` | Server hooks **plus** `onProtectedRequest` |

`x402ResourceServer` exposes `onBeforeVerify`, `onAfterVerify`, `onVerifyFailure`,
`onBeforeSettle`, `onAfterSettle`, `onSettleFailure` and `onVerifiedPaymentCanceled`;
`x402HTTPResourceServer` adds `onProtectedRequest`.

**Recommendation for `@movo/server`: mount via `paymentMiddlewareFromHTTPServer`**, falling
back to `paymentMiddleware` where HTTP-level hooks are not needed. Movo's entire claimed value
on this path — error translation, diagnostics, correlation IDs, cancellation reporting — lives
in those hooks, and `paymentMiddlewareFromConfig` makes them unreachable. It remains the right
choice for documentation examples and for `create-movo-app` templates, where brevity matters
more than instrumentation.

## Q4 — `ExactStellarScheme` constructor signatures across the three subpaths

Read from the installed `.d.mts` declarations, not from documentation.

**`@x402/stellar/exact/server`** — no constructor arguments.

```ts
declare class ExactStellarScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  registerMoneyParser(parser: MoneyParser): ExactStellarScheme;
  parsePrice(price: Price, network: Network): Promise<AssetAmount>;
  enhancePaymentRequirements(pr, supportedKind, extensionKeys): Promise<PaymentRequirements>;
}
// new ExactStellarScheme()
```

Note `registerMoneyParser` — a parser chain with the USDC conversion as the final fallback.
This is the correct extension point for a Movo project that prices in a non-default asset, and
it means Movo must not implement its own price conversion.

**`@x402/stellar/exact/client`** — requires a signer.

```ts
constructor(signer: ClientStellarSigner, rpcConfig?: RpcConfig | undefined);
// new ExactStellarScheme(createEd25519Signer(secret, "stellar:testnet"))
```

**`@x402/stellar/exact/facilitator`** — an array of signers plus options.

```ts
constructor(
  signers: FacilitatorStellarSigner[],
  options?: {
    rpcConfig?: RpcConfig;
    areFeesSponsored?: boolean;            // default true
    maxTransactionFeeStroops?: number;     // default 50_000
    selectSigner?: (addresses: readonly string[]) => string;  // default round-robin
    feeBumpSigner?: FacilitatorStellarSigner;
  },
);
```

The facilitator variant already provides signer pooling, a fee ceiling, round-robin selection
and fee-bump wrapping — all of which the M6 facilitator specification lists as work. **M6 must
be re-scoped against this**; much of it is composition, not implementation.

## Q5 — Header codec functions the client needs, and from which subpath

`@x402/core/http` exports all six:

```ts
encodePaymentSignatureHeader(paymentPayload: PaymentPayload): string;
decodePaymentSignatureHeader(header: string): PaymentPayload;
encodePaymentRequiredHeader(paymentRequired: PaymentRequired): string;
decodePaymentRequiredHeader(header: string): PaymentRequired;
encodePaymentResponseHeader(settleResponse: SettleResponse): string;
decodePaymentResponseHeader(header: string): SettleResponse;
```

A buyer using `wrapFetchWithPayment` needs **none of them for the payment itself** — encoding
`PAYMENT-SIGNATURE` and decoding `PAYMENT-REQUIRED` happen inside the wrapper. They are needed
only to *inspect* the exchange:

- `decodePaymentResponseHeader` — re-exported by `@x402/fetch`, so it is the one available
  without reaching into `@x402/core`.
- `decodePaymentRequiredHeader` — **only** from `@x402/core/http`; `@x402/fetch` does not
  re-export it.

For `@movo/client`'s `decodePaymentOutcome`, both must be re-exported through the narrow waist
(`packages/core/src/protocol/`), since `@movo/client` may not import `@x402/*` directly.

The header names on the wire are `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and
`PAYMENT-RESPONSE`.

## Exact import paths that worked

Server:

```js
import express from "express";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
```

Client:

```js
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
```

Shapes that worked:

```js
// Route keys are "<VERB> <path>"; a key with no space matches any verb.
const routes = {
  "GET /weather": {
    accepts: { scheme: "exact", network: "stellar:testnet", payTo: "G…", price },
    description: "Current conditions",
    mimeType: "application/json",
  },
};

new HTTPFacilitatorClient({ url: "https://www.x402.org/facilitator" });

paymentMiddlewareFromConfig(routes, facilitator, [
  { network: "stellar:testnet", server: new ExactStellarScheme() },
]);

new x402Client().register("stellar:testnet", new ExactStellarScheme(signer));
```

## Workarounds required, and their trigger conditions

| Workaround | Trigger | Status |
|---|---|---|
| `fee: "1"` transaction clone | — | **Not required.** Never applied; settlement succeeded without it |
| Self-issued asset instead of USDC | Circle's faucet is captcha-gated and not automatable | Required **for this spike only**; not a code workaround. M2 must confirm real USDC |
| Trustline before payment | The buyer and the `payTo` account must both hold a trustline to the asset | **Not a workaround — a precondition**, and precisely the onboarding cliff `movo doctor` exists to detect. A missing trustline is a silent setup failure today |

No undocumented workaround was needed, so the failure criterion "requires a workaround that
cannot be isolated behind a single flag" was not triggered.

## Findings that change later milestones

1. **OQ-1 resolved.** Settlement is after the handler; a throwing or ≥400 handler settles
   nothing. Movo asserts this, does not implement it. The response-buffering consequence must
   be documented.
2. **OQ-2 resolved.** Delete the `fee: "1"` flag from the M2 plan. Do not build it.
3. **M1/M2 mount point.** Use `paymentMiddlewareFromHTTPServer`, not
   `paymentMiddlewareFromConfig`, or Movo's diagnostics have nowhere to attach.
4. **M6 re-scope.** The facilitator scheme already ships signer pooling, fee ceilings, signer
   selection and fee bumping. The M6 estimate should shrink accordingly.
5. **Pricing in a non-USDC asset is a first-class path** via `AssetAmount` and
   `registerMoneyParser`. Movo should support it explicitly rather than assuming USDC.
6. **The public facilitator does not enforce an asset allowlist on testnet.** Convenient here;
   worth re-checking for pubnet before any pubnet claim.
7. **Trustline preflight is confirmed as the highest-value diagnostic.** Both the payer and the
   payee need one, and the failure without it is not self-explanatory.

## Disposition

All spike source was discarded with the branch: the server, the client, the account and asset
setup scripts, and the generated `spike/accounts.json` and `spike/asset.json` key material. The
keys were testnet-only, were never committed to `main`, and are worthless. This report is the
only artefact retained.

- Spike branch `spike/x402-stellar-e2e`: **deleted, never merged.**
- Spike code on `main`: **none.**
