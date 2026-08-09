# ADR-0003 — Facilitator composition: Movo defines no facilitator interface

- **Status:** Accepted
- **Date:** 2026-08-09
- **Milestone:** M0
- **Relates to:** spec §1.8 D5, §1.17, §8, ADR-0001

## Context

A Movo application must talk to a facilitator — the service that verifies a payment payload
and settles it on chain. Three deployment shapes are needed:

| Mode | Facilitator | Network | Use |
|---|---|---|---|
| `mock` | A Movo test double | none | Fast inner loop; the payment failure matrix; no keys |
| `in-process` | `x402Facilitator` + `ExactStellarScheme` inside the dev server | `stellar:testnet` | Hermetic end-to-end; real settlement without a third party |
| `<url>` | An HTTP facilitator | `stellar:testnet` | The default; free and keyless on testnet |

The instinct is to define a `Facilitator` port in `@movo/core` with three implementations. That
instinct is wrong here, and the reason is worth recording.

`@x402/core/server` already exports `FacilitatorClient` (the interface) and
`HTTPFacilitatorClient` (an implementation), along with `FacilitatorResponseError` and
`FacilitatorTimeoutError`. `@x402/core/facilitator` exports a complete `x402Facilitator` class
with `register(networks, facilitator)`, `registerV1`, `registerExtension`, `getSupported()`,
`verify()`, `settle()` and six lifecycle hooks with abort/recover semantics.
`@x402/stellar/exact/facilitator` exports the Stellar `exact` scheme implementation.

## Decision

**Movo defines no new facilitator interface. It consumes `FacilitatorClient` and composes
`x402Facilitator` for in-process use.**

- The interface is upstream's `FacilitatorClient`. Movo's mock, in-process and hosted
  facilitators all *implement* it. They are implementations, not a parallel abstraction.
- The in-process facilitator is `x402Facilitator` with `ExactStellarScheme` from
  `@x402/stellar/exact/facilitator` registered onto it. Movo writes no verification and no
  settlement logic.
- The hosted facilitator is upstream's `HTTPFacilitatorClient`, constructed from Movo
  configuration.

What Movo adds — genuinely absent upstream, and the only justification for this layer existing
at all:

1. **Config-driven construction.** URL, auth headers and timeouts resolved from the Movo
   environment model, with provenance, and with credentials redacted at construction.
2. **A health probe** used by `movo doctor`, reporting whether the configured facilitator is
   reachable and whether its `/supported` response actually advertises the network and scheme
   the project is configured for. Facilitator/network disagreement is a common and confusing
   failure and it is currently nobody's job to detect it.
3. **Diagnostic translation** of `FacilitatorResponseError` and `FacilitatorTimeoutError` into
   coded Movo errors with a stated cause and fix.
4. **A pubnet guard.** The in-process facilitator refuses `stellar:pubnet` without an explicit
   opt-in.

## Consequences

- Swapping hosted → in-process → mock is a one-line configuration change and requires no
  Movo-specific type in any signature.
- Movo cannot present a simplified facilitator surface; consumers see `FacilitatorClient`.
  Given the principle that protocol semantics stay visible, this is acceptable and arguably
  desirable — a developer debugging a settlement failure needs the real vocabulary.
- When upstream adds a method to `FacilitatorClient`, Movo's implementations gain a compile
  error in one place instead of an adapter needing updating in two directions.
- Movo's facilitator-adjacent surface is small enough to invite the question of whether it
  earns a place at all. The health probe and the diagnostic translation are the answer, and
  they must be demonstrably useful by the M5 gate or be cut.

## Licence boundary

The AGPL-3.0-or-later OpenZeppelin Relayer, the x402 Facilitator Plugin and the OpenZeppelin
Relayer SDK **must never be vendored, forked or copied** into this repository. **Calling a
hosted facilitator over HTTP is explicitly permitted** — invoking a remote network service is
not a derivative work — so any of them may be named as a configured URL.

This distinction is the whole reason the facilitator is reached through a URL and an interface
rather than through a library dependency. `pnpm check:licenses` enforces the code side.

## Alternatives rejected

**A Movo `Facilitator` port with hosted / in-process / mock implementations.** Partially
retained: the *implementations* are useful, the *new interface* is not. A parallel interface
would need adapters in both directions and would break the moment upstream adds a method.

**Wrapping `x402Facilitator` in a Movo class for a "nicer" API.** Rejected under the
compose-never-wrap principle: it would rename methods without adding capability, and would hide
the lifecycle hooks that make the upstream class worth using.

**Implementing verification or settlement directly for the in-process mode.** Rejected
absolutely. That is protocol work, it requires XDR construction and signature verification, and
it is the precise thing Movo promises never to do.

**Shipping only the hosted mode and requiring a third-party service for local development.**
Rejected: it makes the inner loop depend on someone else's uptime, and the free keyless testnet
facilitator is an assumption that could stop holding. The in-process mode is the documented
fallback if it does.
