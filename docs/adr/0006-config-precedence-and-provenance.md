# ADR-0006 — Configuration precedence and provenance

- **Status:** Accepted
- **Date:** 2026-08-11
- **Milestone:** M1
- **Supersedes:** nothing
- **Related:** ADR-0005 (resource model)
- **Amends:** the `resolveConfig` signature sketched in specification §5.1

## Context

A Movo project draws configuration from several places: built-in defaults, `movo.config.ts`, the
environment, a per-resource override, and an explicit call-site argument. Every one of them is
legitimate and every one of them is used.

The failure mode this creates is specific and common. Someone reports that their API is paying
the wrong account, or is pointed at the wrong network, and the answer is invariably that a layer
nobody was thinking about supplied the value. Without provenance, diagnosing it means reading
five places and reasoning about precedence from memory.

## Decision

**Five layers, fixed precedence, lowest to highest:**

| # | Layer | Source |
|---|---|---|
| 1 | `default` | built-in |
| 2 | `config` | `movo.config.ts` |
| 3 | `env` | `MOVO_*` environment variables |
| 4 | `resource` | a per-resource override |
| 5 | `argument` | an explicit call-site argument |

**Every resolved leaf carries its source.** `ResolvedConfig` mirrors the shape of `MovoConfig`
with each leaf replaced by `{ value, source }`. Nested rather than flat, so `movo doctor` can
print `facilitator.url — from env` rather than reporting provenance for a whole `facilitator`
object whose parts came from different places.

**Absence is silence, never negation.** A higher layer that says nothing about a setting does not
unset a lower one. Permitting that would make precedence depend on whether a key was written as
absent or as explicitly `undefined` — a difference invisible when reading a config file.

**Validation is eager and throws at `resolveConfig`.** Never at request time. A server that
starts with an invalid `payTo` and discovers it when a buyer tries to pay has converted a startup
error into a customer-facing one.

**Validation order puts the safety interlock first.** The `MOVO_ALLOW_PUBNET` check runs before
the network check and before the env/network agreement check. If several things are wrong and one
of them is an undeclared intent to move real money, that is the error the developer gets. A
safety interlock outranks a consistency check.

**`env` and `network` are never coerced.** A mismatch is `MOVO_E_ENV_NETWORK_MISMATCH`, not a
silent correction. Guessing which the author meant is guessing about real money.

## Deviation from specification §5.1

The specification sketches `resolveConfig(input?: Partial<MovoConfig>)`. Movo implements
`resolveConfig(layers?: ConfigLayers)`, where `ConfigLayers` names the four supplied layers
explicitly.

**Why.** A single partial cannot express five layers, and AC1.5 requires asserting the source of
a value set in each of them. A union of the two shapes was considered and rejected: they are both
objects of optional keys, and both have a key named `env` meaning entirely different things —
`"testnet"` in one, a record of environment variables in the other. Discriminating them at
runtime would be guesswork, and guessing wrong would silently misread a configuration in a money
path. One unambiguous shape is worth the deviation.

Specification §5 states that its signatures are declaration-level design rather than
implementation, so this is within the latitude it grants. `compileApp(app, layers?)` takes the
same shape for consistency.

## Input types accept `undefined`

`MovoConfigInput` fields are `?: T | undefined`, not `?: T`, under `exactOptionalPropertyTypes`.

The most ordinary line anyone writes in a config file is `payTo: process.env["MOVO_PAY_TO"]`,
whose type is `string | undefined`. With a bare `payTo?: string` that line does not compile, and
both workarounds a reader reaches for are worse than the problem: `?? ""` produces an empty
address that fails validation later with a confusing message, and `!` asserts something about the
environment that nobody has checked.

Accepting `undefined` costs nothing, because resolution already treats it as silence. The
resolved type stays strict; only the input is lenient. That is precisely the distinction
`exactOptionalPropertyTypes` exists to let a library draw.

## Credentials are functions, not values

`facilitator.authHeaders` must be a function. A literal throws `MOVO_E_SECRET_IN_CONFIG` at
definition time.

This is the cheapest available control and it sits upstream of redaction rather than relying on
it. `MOVO_FACILITATOR_API_KEY` is never read into the configuration object at all, so it cannot
be reached by anything that walks it — a diagnostic dump, a test snapshot, a printer nobody has
written yet. Redaction is the backstop; not storing the value is the plan.

Relatedly, there is no field anywhere in `MovoConfig` that a Stellar secret seed would fit into.
A Movo resource server does not need one. The type system is a cheaper custody boundary than a
code review.

## What was deleted, and why it is recorded

`stellar.testnetFeeWorkaround` appears in specification §5.1 and is **not implemented**. The M0
spike settled on Stellar testnet on the first attempt with no `fee: "1"` transaction clone, so
the flag described in the official quickstart is not required against `@x402/*` 2.21.0 and the
public testnet facilitator (Spec Amendment 001 §1, OQ-2).

Recording the deletion here matters more than the deletion itself: if the fee limit ever
reappears it should be recognised as a regression with a trigger condition, not mistaken for a
permanent requirement that Movo forgot to implement.

## Consequences

`movo doctor` can print the resolved configuration with provenance for every value, and that
printout is a headline feature rather than debug output.

Precedence is a published contract. Changing the order, or removing a layer, is a major version.

Resolution is pure and takes its environment as an argument defaulting to `process.env`, so tests
are hermetic — a developer with `MOVO_PAY_TO` exported sees the same results as CI. That
injection point exists for exactly the class of bug provenance is meant to expose.
