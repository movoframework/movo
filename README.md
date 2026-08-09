# Movo

**The project framework and operations toolkit for machine-payable Stellar APIs.**

Movo is an Apache-2.0 TypeScript monorepo for building [x402](https://github.com/x402-foundation/x402)-payable
HTTP APIs settled on [Stellar](https://stellar.org). It is composed **over** the official
`@x402/*` packages and reimplements no protocol primitive.

> **Status: M0.** This repository currently contains the workspace, toolchain, compliance
> gates and CI. Every package exports only a `VERSION` constant. The public API described in
> the architecture specification arrives in later milestones. There is nothing to install yet.

## What Movo is, and what it is not

The official `@x402/*` SDK is more complete than its documentation suggests. It already ships
route configuration, the payment middleware, the verify→handler→settle lifecycle with hooks,
Bazaar declaration *and* validation, every Stellar constant and validator, signers, and client
fetch-wrapping. Movo does not wrap any of that.

What Movo adds is the layer nobody upstream provides:

| Movo provides | Why it is not upstream's job |
|---|---|
| A project model — config, environments, provenance, secret handling | x402 gives you a routes object literal, not a project |
| Resource modules — one typed declaration compiling to a route, a discovery declaration and a fixture | Upstream requires you to keep those three in sync by hand, and desynchronisation is silent |
| Preflight diagnostics (`movo doctor`) — trustlines, funding, asset resolution, clock skew | The largest onboarding cliff in Stellar x402, unaddressed anywhere |
| An application test harness — in-process facilitator, payment failure matrix, matchers | Upstream has an e2e suite for *itself*, not for *your* API |
| Error translation — opaque facilitator rejections into coded, documented, actionable errors | — |
| Scaffolding and CLI | — |

**Movo never:** reimplements x402 or Stellar settlement; wraps an upstream package merely to
rename its exports; takes custody of funds; accepts a payer private key server-side; or
collects telemetry of any kind.

## The narrow waist

Only files under `packages/core/src/protocol/**` may import from `@x402/*`. The rule is
enforced by Biome (`biome.jsonc`) and proven to fire by `tests/unit/narrow-waist.test.ts`.

`@x402/*` ships roughly weekly. Without this boundary an upstream breaking change would
surface across seven packages at once; with it, the blast radius is one directory. See
[ADR-0004](docs/adr/0004-x402-narrow-waist.md).

## Repository layout

```
packages/core            project model, resource compilation, errors, the protocol waist
packages/server          mounting compiled resources onto a Node HTTP framework
packages/stellar         preflight diagnostics
packages/bazaar          discovery declaration derivation and severity escalation
packages/client          buyer budget accounting and typed clients
packages/testing         facilitator fixtures, failure matrix, matchers
packages/cli             the movo command line interface
packages/create-movo-app scaffolding

scripts/                 compliance gates and the compatibility generator
tests/                   unit · integration · e2e · conformance
docs/adr/                architecture decision records
docs/COMPATIBILITY.md    GENERATED — never hand-edited
```

`packages/{facilitator,catalog,mcp}` do not exist yet. They belong to a separate, gated track
(M6/M7) and no core-track package may ever depend on them; this is enforced by
`pnpm check:track-isolation`.

## Requirements

Node.js **≥22** (CI matrix: 22, 24, 26) and **pnpm 10.x**. ESM-only — Movo packages cannot be
`require()`d. npm and yarn are supported for *consuming* published packages, but the workspace
itself assumes pnpm.

## Development

```bash
pnpm install
pnpm check:licenses          # no AGPL/SSPL/GPL anywhere in the dependency path
pnpm check:track-isolation   # the core track never imports the SCF track
pnpm typecheck
pnpm lint
pnpm build
pnpm test                    # unit + integration; no network
pnpm generate:compat         # regenerates docs/COMPATIBILITY.md from the live facilitator
```

Network-touching suites are opt-in and never block the PR gate:

```bash
MOVO_E2E=1 pnpm test:e2e
MOVO_E2E=1 pnpm test:conformance
```

## Compatibility

[`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) is **generated** by `pnpm generate:compat`. It
records the exact installed `@x402/*` versions and the live `/supported` payload from the
configured facilitator. Do not edit it by hand; where it disagrees with the architecture
specification, the generated file is the one describing reality.

`@x402/*` dependencies are exact-pinned, with no caret or tilde ranges. A bump is a dedicated
PR that regenerates the matrix and re-runs conformance.

## Licence

[Apache-2.0](LICENSE), chosen over MIT for the explicit patent grant and to match `@x402/*`.

No AGPL, SSPL or GPL is permitted anywhere in the dependency path — a Movo facilitator is
designed to be operated as a network service, and the AGPL's network clause would extend to
third parties it serves. The OpenZeppelin Relayer, the x402 Facilitator Plugin and the
OpenZeppelin Relayer SDK are AGPL-3.0-or-later and must never be vendored, forked or copied;
calling a hosted facilitator over HTTP is permitted. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Movo never accepts payer private keys server-side. See [SECURITY.md](SECURITY.md).
