# ADR-0007 — The Stellar integration boundary

- **Status:** Accepted
- **Date:** 2026-08-12
- **Milestone:** M2
- **Related:** ADR-0004 (narrow waist), ADR-0008 (mounting strategy), Spec Amendment 003 §1

## Context

`@movoframework/stellar` is the package a reader is most likely to expect to be thick and find
thin. "Stellar integration" sounds like it should contain address handling, amount conversion,
network constants and asset definitions. It contains none of those, and the reason needs
recording so that nobody helpfully adds them.

## Decision

A line, drawn once:

| Concern | Owner |
|---|---|
| Network identifiers, passphrases, RPC and Horizon URLs | `@x402/stellar` |
| USDC contract addresses, default decimals | `@x402/stellar` |
| Address and asset validators, amount conversion | `@x402/stellar` |
| Auth entries, XDR, simulation, signing, settlement | `@x402/stellar` |
| **Configuration, validation, preflight, diagnostics, remediation** | **Movo** |

Movo defines no Stellar constant. Not one. Hard-coding a USDC contract address that upstream
already exports is precisely the duplication that produces a silent money bug: the two copies
agree right up until the day one of them changes, and nothing fails until value moves to the
wrong place.

What Movo does own is the part nobody else does. A missing trustline, an unfunded account, a
facilitator that does not support your network, a clock that has drifted — these produce failures
whose messages describe the payment rather than the setup, and turning them into findings with
executable remedies is the entire value of the package.

## Reading a contract is not crossing the line

The `asset` check reads a SEP-41 contract's declared decimals through `contract.Client` from
`@stellar/stellar-sdk`. That is a deliberate, bounded exception and it is worth being precise
about why it is not a violation.

It builds no transaction by hand, constructs no authorization entry, signs nothing and pays no
fee. It is a read-only simulation of a `decimals()` call through the SDK's own high-level client.
Constructing an auth entry would be the violation; asking a contract what it is, is not.

The alternative was to assume 7 decimals. The specification is explicit that decimals must be
read from the contract, not assumed, and an assumed decimal count is the arithmetic error that
sends a payment out by a factor of ten million.

`pnpm check:protocol-purity` encodes exactly this line: `TransactionBuilder`, `authorizeEntry`,
`signAuthEntry` and `Keypair.fromSecret` are violations; `contract.Client` is not.

## Verifying the issuer, not the asset code

The `trustline` check compares the trustline's **issuer**, derived from the asset contract's own
`name()`, rather than matching on the asset code.

Asset codes are not unique on Stellar. Anyone may issue an asset called USDC. A trustline to the
wrong issuer looks correct in a wallet, satisfies a code-only check, and still cannot receive the
asset your prices resolve to. A wrong-issuer trustline is therefore reported as its own error with
its own message, because "you have a USDC trustline but not to *this* USDC" is not something a
developer will work out unaided.

This is a case where Movo does more than upstream, and it is the right kind of more: diagnosis,
not protocol.

## The dependency direction, and its one wrinkle

`@movoframework/stellar` imports `@stellar/stellar-sdk` directly. `packages/core` must not — it
reaches the SDK only transitively through `@x402/stellar`, which is unavoidable because the
validators core needs are reachable only through that package's root entry. Spec Amendment 003 §1
rules on this, and `check-protocol-purity` enforces it with a proof-of-failure fixture.

## Consequences

The package is small enough to invite "is this doing anything?". The honest answer is that its
value is concentrated in one check — `trustline` — and that check is the difference between a
developer shipping and a developer giving up. The docs lead with that rather than with a feature
count.

Every check returns a `Finding` and never throws for a negative result. A check that threw would
stop `movo doctor` at the first problem, when the point is to report all of them at once with the
most fundamental first.

A network timeout is a `warn`, never an `error`. A slow RPC is a fact about someone's network, not
about their configuration, and a preflight that failed a deploy gate for one would be switched
off — after which it protects nothing.
