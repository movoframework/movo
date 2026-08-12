# ADR-0008 — Mounting strategy

- **Status:** Accepted
- **Date:** 2026-08-12
- **Milestone:** M2
- **Supersedes:** the mount point named in spec §5.4
- **Related:** ADR-0004 (narrow waist), Spec Amendment 001 §2, docs/SPIKE_REPORT.md Q3

## Context

`@x402/express` offers three ways to mount, and the choice between them is not a matter of taste.
It decides whether Movo can ever add diagnostics.

| Export | Takes | Hook access |
|---|---|---|
| `paymentMiddlewareFromConfig` | plain config | **none** — the `x402ResourceServer` is built internally and never exposed |
| `paymentMiddleware` | a prebuilt `x402ResourceServer` | all seven server hooks |
| `paymentMiddlewareFromHTTPServer` | a prebuilt `x402HTTPResourceServer` | server hooks **plus** `onProtectedRequest` |

The M0 spike used `paymentMiddlewareFromConfig` and it worked, which is why the specification
originally named it.

## Decision

**Mount via `paymentMiddlewareFromHTTPServer`.** `@movoframework/server` constructs the
facilitator client, the `x402ResourceServer` and the `x402HTTPResourceServer` itself, and exposes
the resource server on `MountResult.server`.

Why the spike's choice was wrong for the product: `FromConfig` hides the object that
`onBeforeVerify`, `onAfterVerify`, `onVerifyFailure`, `onBeforeSettle`, `onAfterSettle`,
`onSettleFailure` and `onVerifiedPaymentCanceled` hang off. Movo's entire claimed value on this
path — error translation, correlation IDs, cancellation reporting, `movo doctor`'s runtime
diagnostics — lives in those hooks. Spec §5.4 already promised `MountResult.server` would expose
the raw resource server; `FromConfig` makes that promise unkeepable.

The trade is more explicit construction inside `@movoframework/server`, and it is the correct one:
the object Movo needs to expose is the object Movo must construct.

`FromConfig` remains the right choice for documentation examples and scaffolded templates, where
brevity matters more than instrumentation.

## Composition, and the line it must not cross

The mount does six things, all of them assembly:

1. `compileApp` — pure, produces the raw upstream `RoutesConfig`
2. a `FacilitatorClient` from configuration, or the caller's own
3. `x402ResourceServer` with `ExactStellarScheme` registered for the configured network
4. `x402HTTPResourceServer` wrapping server and routes
5. `paymentMiddlewareFromHTTPServer`
6. the plain route handlers, mounted after the middleware

It contains no header construction, no 402 body construction, no lifecycle state machine, no XDR
and no signature verification. `x402ResourceServer` owns verify → handler → settle. A second
implementation of that ordering would duplicate far better-tested code and would risk diverging on
exactly the semantics that matter most — when the two disagree about whether a throwing handler
gets charged, which one is right?

`pnpm check:protocol-purity` enforces the boundary with a proof-of-failure fixture, so the claim
is checked rather than asserted.

## The handler context is decoded, not invented

A Movo handler receives `ctx.payment` carrying the network, asset, amount and the full
`PaymentRequirements`. Those come from decoding the buyer's `PAYMENT-SIGNATURE` header with
upstream's own codec — the payload's `accepted` field is the exact requirements object the
facilitator verified against.

The first draft filled that context with empty strings and a hardcoded network, because the
middleware attaches nothing to the Express request. That was a lie told in the type system: a
handler reading `ctx.payment.amount` would have received `""` while the type promised a base-unit
amount. Decoding real values is composition; placeholders that typecheck are worse than a missing
field, because nothing ever fails.

`verified: true` is asserted rather than computed, and that is sound: these handlers are mounted
after the middleware, so reaching one means verification succeeded.

## Why the header names live in the narrow waist

Reading `PAYMENT-SIGNATURE` requires naming it, and AC2.7 forbids `PAYMENT-*` literals in
`@movoframework/server` — a package writing protocol header strings is a package that has begun
implementing the protocol.

Both are satisfied by putting the names in `packages/core/src/protocol/` as `PAYMENT_HEADERS` and
importing them everywhere else. Upstream exports no constant for them, so this is Movo declaring
them once rather than repeatedly. The purity gate builds its pattern from that same constant and
its fixtures are rendered from it, so a rename cannot leave the gate matching nothing while its
fixtures stay green.

## `mountNodeHttp` builds an Express app

It does not reimplement the mount over Node's HTTP server. It creates a minimal Express app,
mounts onto that, and returns the request listener. The cost is Express in the dependency tree of
a caller who did not ask for one — hence a peer dependency, and hence this paragraph. The
alternative was a hand-written adapter over `HTTPAdapter`, and a second implementation of request
translation is exactly the kind of thing that diverges quietly.

## Consequences

`@movoframework/server` is roughly two hundred lines. That is the correct size for a package whose
job is assembly, and the docs say so rather than padding it.

`MountResult.server` is a stability promise. Consumers attach upstream hooks to it, so removing or
narrowing it is a major version.

`"in-process"` and `"mock"` are deliberately absent from `MountOptions.facilitator` until M3
implements them. A name offered before the thing behind it exists is a promise, not an API.
