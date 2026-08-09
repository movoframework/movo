# ADR-0001 — Framework abstraction model: Movo owns the project layer, `@x402/*` owns the protocol

- **Status:** Accepted
- **Date:** 2026-08-09
- **Milestone:** M0
- **Relates to:** spec §0.1–§0.2, §1.8 D1/D2, ADR-0002, ADR-0004

## Context

Movo began as "a TypeScript framework for machine-payable applications". Before writing any
code, the published type declarations of `@x402/core`, `@x402/stellar`, `@x402/express`,
`@x402/extensions` and `@x402/fetch` (all 2.21.0, all Apache-2.0) were read directly.

The upstream SDK is substantially more complete than its documentation suggests. It already
ships:

- `x402ResourceServer` and `x402HTTPResourceServer` — the full verify → handler → settle
  lifecycle, with `BeforeVerify` / `AfterVerify` / `OnVerifyFailure` / `BeforeSettle` /
  `AfterSettle` / `OnSettleFailure` / `OnVerifiedPaymentCanceled` hooks.
- `RouteConfig` / `RoutesConfig` / `PaymentOption` — including `DynamicPayTo`, `DynamicPrice`,
  `resource`, `description`, `mimeType`, `serviceName`, `tags`, `iconUrl`, custom paywall
  HTML, and per-route response-body overrides.
- `x402Facilitator`, `FacilitatorClient`, `HTTPFacilitatorClient`, and typed facilitator errors.
- Every Stellar constant and helper Movo would otherwise have hard-coded: the CAIP-2 network
  identifiers, both USDC contract addresses, `DEFAULT_TOKEN_DECIMALS = 7`, network
  passphrases, RPC and Horizon clients, address validators, `convertToTokenAmount`, and
  Ed25519 signers.
- Bazaar declaration **and validation**, including the icon-URL SSRF check, route-template
  validation, service-name validation and tag sanitisation.
- `paymentMiddleware` for Express and `wrapFetchWithPayment` / `x402Client` for buyers.

A large fraction of what a naive "Movo framework" would build already exists, is maintained by
the x402 Foundation, and is more thoroughly tested than a new implementation could be.

## Decision

**Movo's scope contracts to the project layer and the operations layer. The protocol layer is
`@x402/*`, consumed and never reimplemented.**

Concretely, Movo owns exactly seven things, all of which are absent upstream:

1. **A project model** — `movo.config.ts`, environment separation, resolution with provenance,
   secret handling. x402 gives you a routes object literal; it does not give you a project.
2. **Resource modules** — one typed declaration per file compiling to an x402 `RouteConfig`,
   its Bazaar declaration, and its test fixtures, with handler types flowing through. Upstream
   requires those three artefacts be kept in sync by hand, and desynchronisation is silent.
3. **Preflight and diagnostics** (`movo doctor`) — trustlines, funding, asset resolution,
   facilitator/network agreement, clock skew, dependency pin drift.
4. **An application-level test harness** — in-process facilitator wiring, a payment failure
   matrix, assertion matchers. Upstream's e2e suite tests *upstream*, not *your API*.
5. **Error and diagnostic translation** — opaque facilitator rejection reasons into coded,
   documented, actionable errors.
6. **Scaffolding and CLI.**
7. **(Gated SCF track only)** a facilitator service and a Stellar-native discovery catalog.

Any proposed Movo package whose primary content would be a wrapper around an upstream export
is deleted from the design rather than written. Positioning follows the scope: *"Movo — the
project framework and operations toolkit for machine-payable Stellar APIs,"* not *"the
TypeScript framework for machine-payable applications,"* which would over-claim against an SDK
that already provides the framework primitives.

## Consequences

- Several planned packages disappear before they are written: `@movo/x402` (ADR-0002), a
  `@movo/express` middleware wrapper, a Movo Bazaar validator library, and a Movo Stellar
  constants module. Each would have been a second source of truth for a value or behaviour
  that must never diverge — the class of duplication that produces a silent money bug.
- Movo inherits upstream's HTTP semantics, including its settle-ordering choice and its
  unpaid-response shape. Movo cannot fix a decision it disagrees with except by contributing
  upstream. This is accepted deliberately; the alternative is divergence on exactly the
  ordering semantics that matter most.
- The remaining packages are thin. `@movo/bazaar` is perhaps 300 lines and `@movo/stellar` is
  diagnostics-only. This invites the question "is this even a framework?" — the honest answer
  is that the value is in the project layer and the diagnostics, and the documentation must
  lead with that rather than with a package count.
- Because the value is now concentrated in ergonomics rather than in capability, it must be
  **demonstrable**. The clean-machine quickstart timing is the evidence, and the project
  carries an explicit kill condition: if Movo saves a developer under ten minutes, the correct
  outcome is to cut scope to a CLI-only tool rather than to ship library packages nobody needs.

## Alternatives rejected

**Build the framework primitives anyway, for control.** Rejected. Reimplementing the payment
lifecycle would duplicate better-tested upstream code and risk diverging on settle-ordering
semantics. Reimplementing Stellar constants would create two sources of truth for a USDC
contract address and a decimal count — where Stellar USDC has 7 decimals while many x402
examples assume 6, so a divergence is a 10× payment error, not a cosmetic bug.

**Wrap upstream and re-export under Movo names, for a coherent API surface.** Rejected. It
adds a second set of type names for the same wire objects, doubles the version-coupling
surface, and requires a Movo release roughly every week to track upstream. It is cost without
capability.

**Fork `@x402/*`.** Rejected outright. Movo's entire thesis is that the protocol layer should
be shared; a fork would make Movo responsible for protocol correctness, which is the one
responsibility it is best positioned not to take.

**Keep the broad "framework for machine-payable applications" positioning and let scope catch
up.** Rejected. The positioning would be a claim the code does not support, and the first
developer to read the `@x402/*` declarations would notice.
