# The payment lifecycle

Movo does not implement the payment lifecycle. `x402ResourceServer` from `@x402/core` owns
verify → handler → settle, with its own abort and recover hooks, and Movo composes it.

This page documents what upstream actually does — observed empirically in the M0 spike, not read
from documentation — because several of its properties are things you need to design around, and
one of them is a limitation you will otherwise discover the hard way.

## The order of events

```
  1. Request arrives without PAYMENT-SIGNATURE
     → 402 + PAYMENT-REQUIRED. The handler never runs.

  2. Buyer signs, retries with PAYMENT-SIGNATURE
     → the middleware verifies with the facilitator BEFORE the handler.

  3. Verification fails
     → 402 with a non-null reason. The handler never runs.

  4. Verification succeeds
     → the middleware patches res.writeHead/write/end, BUFFERS the entire response,
       and calls the handler.

  5a. The handler throws
      → settlement is cancelled with reason "handler_threw", buffered output is
        discarded, the error goes to the framework's error handler. Nothing is charged.

  5b. The handler completes with status >= 400
      → settlement is cancelled with reason "handler_failed", and the buffered
        response is flushed through unchanged. Nothing is charged.

  5c. Otherwise
      → settle, then flush the buffered response with PAYMENT-RESPONSE attached.
```

## Settlement happens after the handler

This was an open question in the architecture specification and the M0 spike answered it by
making a handler throw and watching the balances.

| Observation | Value |
|---|---|
| Handler executed | Yes — verification had already succeeded |
| HTTP status | 500 |
| `PAYMENT-RESPONSE` header | Absent |
| Buyer charged | 0.0000000 — balance unchanged |

Two consequences follow.

**A route that fails costs the buyer nothing.** This is a genuine product property, not an
implementation detail. A paid endpoint that 404s, or that throws, does not charge. You do not
need to write anything to get it, and you should not write anything to try to improve on it.

**Movo asserts this rather than implementing it.** "Charging for failed work" appears in the
architecture specification's security table, and it is already handled upstream. A second
implementation of the same guarantee would be a second thing to keep correct.

## A paid route cannot stream its response

This is the limitation to design around.

Step 4 above buffers the entire response until settlement resolves. Therefore **streaming,
chunked and Server-Sent Events responses behind a paid route do not stream.** The buyer receives
nothing until the handler has finished and settlement has completed, and then receives
everything at once.

The reason is structural rather than incidental: settlement is conditional on the response
status, and the response status is not known until the response is complete. A middleware that
streamed would have to either settle before knowing whether the work succeeded, or send bytes it
might have to retract. Both are worse than buffering.

There is a second consequence of the same mechanism. A large response is held in memory until
settlement completes, so a paid route returning a very large payload has a memory profile its
author will not expect — one full copy per concurrent in-flight request, held for the duration of
a facilitator round trip.

Movo does not engineer around either of these. It documents them, records
`streaming / SSE / chunked responses behind a paid route` as **UNSUPPORTED** in the
compatibility matrix, and offers `MOVO_W_RESPONSE_NOT_STREAMED` as the code to point at when it
comes up.

If you need streaming, put the paid route in front of the stream rather than around it: charge
for a short response that hands back a URL or a token, and serve the stream unpaid from there.

## Why a handler cannot see the settlement result

`MovoRequestContext.payment` has no settlement field. Settlement happens after the handler
returns, so such a field could only ever be empty — and a field whose meaning is "not yet known"
is worse than no field.

Settlement is observable in two places instead: Movo's `onSettled` and `onSettleFailure` hooks,
and the `PAYMENT-RESPONSE` header the buyer decodes.

## `verified: true` is a literal type

`ctx.payment.verified` is typed `true`, not `boolean`, encoding that a handler does not run on
an unverified request. That claim was checked against the installed declarations rather than
assumed:

- `SkipHandlerDirective` causes the handler to be **skipped**, never to run on a failed verify.
- `BeforeVerifyHook`'s `{ skip: true, result }` substitutes a verify result — an operator
  declaring the payment valid themselves, on a hook they installed deliberately.

Neither path delivers an unverified request to a handler. The one way to weaken the invariant is
to install an upstream `onBeforeVerify` that returns `{ isValid: true }` without checking
anything, which is your own assertion about your own server, not something Movo can or should
prevent.

## Movo hooks versus upstream hooks

Two sets of hooks exist and they do different jobs.

| | Movo hooks | Upstream hooks on `x402ResourceServer` |
|---|---|---|
| Purpose | Observation | Control flow |
| Can abort a request | No | Yes — `onBeforeVerify` |
| Can recover from a failure | No | Yes — `onVerifyFailure` |
| Payload redaction | Yes, always | Yours to manage |
| Where you get them | `MovoHooks` | `MountResult.server` |

The split is deliberate. There is exactly one implementation of payment control flow in this
system and it is upstream's. A Movo hook that could abort would be a second one, with its own
ordering semantics to keep in step — and the ordering semantics of a payment lifecycle are the
last thing that should exist in two places.

A Movo hook that throws is contained and reported as a `hook.threw` finding. Observability is
the least important thing happening on this code path; a metrics call that throws must not take
down a settlement.

## Fees are sponsored, and the fee workaround is not needed

On `stellar:testnet` the public facilitator advertises `areFeesSponsored: true`, and the M0
spike confirmed it on-chain: the settled transaction's *source account* was the facilitator's,
not the buyer's. The buyer paid the asset amount and none of the network fee.

The `fee: "1"` transaction-clone workaround described in the official Stellar quickstart was
never applied and settlement succeeded on the first attempt. Movo does not implement the flag
and does not carry a config field for it. If a fee-limit failure is ever observed, it is a
regression to report with its trigger condition — not a workaround to reintroduce quietly.

## Where the evidence lives

Everything on this page traces to `docs/SPIKE_REPORT.md`: a real Stellar testnet transaction,
confirmed independently from Horizon rather than taken from the server or the facilitator, plus
the answers to the five questions the spike was run to settle.
