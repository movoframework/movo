# ADR-0014 — Release and versioning

**Status:** accepted (M8)
**Supersedes:** nothing
**Related:** spec §A (ex-amendment 002 §6), [key-management.md](../security/key-management.md)

## Context

Eleven packages publish under the `@movoframework/*` scope, plus the unscoped `create-movo-app`.
They ship as one unit: every one of them is a facet of a single framework, and a buyer who
installs `@movoframework/client` against a `@movoframework/core` from a different release is
debugging a combination nobody tested.

Publishing is also the highest-value attack surface this project has. A compromised release
reaches every consumer with the project's own name on it, and npm has been the delivery vehicle
for the most effective supply-chain attacks of the last few years — nearly all of them via a
stolen or over-scoped long-lived token.

## Decision

**1. Fixed versioning across the workspace, via Changesets.** `.changeset/config.json` puts
`@movoframework/*` and `create-movo-app` in one `fixed` group, so all twelve move together. The
cost is version churn in packages that did not change; the benefit is that a version number
identifies a tested combination rather than a package. For a framework whose packages are not
independently useful, that trade is obviously right.

**2. npm OIDC trusted publishing, and no long-lived token — ever.** `.github/workflows/release.yml`
requests `id-token: write` and exchanges a short-lived GitHub OIDC token for publish rights scoped
to this repository *and that workflow file*. There is no `NPM_TOKEN` secret in this repository and
adding one would be a regression, not a convenience: it is the single credential whose theft
publishes malware under this scope, and npm is itself restricting 2FA-bypassing automation tokens
(account changes August 2026, direct publishing January 2027).

Requirements, read from `docs.npmjs.com` rather than recalled: npm CLI **11.5.1+**, Node
**22.14.0+**, `id-token: write`, and a per-package trusted publisher configured on npm naming the
repository and the **workflow filename**. Provenance is generated **automatically** under trusted
publishing — the `--provenance` flag is not needed. `publishConfig.provenance` is retained in each
manifest because it is what produces provenance on any non-OIDC path and it agrees with what OIDC
does by default.

**3. The workflow filename is load-bearing.** npm's trusted-publisher configuration names
`release.yml` specifically. Renaming the file silently breaks publishing until npm is updated to
match, so the file has a boring name and CODEOWNERS covers `.github/workflows/`.

**4. Every release re-runs the gates against the exact tree being published**, plus a
compatibility-matrix regeneration that fails on a diff. A stale `COMPATIBILITY.md` inside a
tarball is a false claim shipped to consumers.

**5. `v0.1.0` is tagged by a human, not by this workflow.** Tagging asserts that conformance is
green; that assertion is a maintainer's to make.

## The bootstrap constraint

**npm cannot publish the *initial* version of a package over OIDC.** The npm UI requires a package
to exist before its trusted publisher can be configured, and the CLI issue tracking this
([npm/cli#8544](https://github.com/npm/cli/issues/8544)) is open. Every Movo package is
unpublished today, so the first v0.1.0 publish must be performed by a maintainer with credentials,
after which trusted publishing is configured per package and every subsequent release runs through
the workflow with no token at all.

This is recorded here, rather than left to be rediscovered, because the tempting "fix" when the
first OIDC publish fails is to add a long-lived `NPM_TOKEN` secret and leave it there. That would
convert a one-time bootstrap into a permanent standing credential — the exact outcome decision 2
exists to prevent. The bootstrap publish is a single interactive act; the token must not outlive
it.

## Consequences

- A package that genuinely should version independently has to leave the `fixed` group first, and
  that is a deliberate decision rather than a default.
- Releases cannot be published from a fork or a self-hosted runner: trusted publishing supports
  GitHub-hosted runners only.
- Provenance is not generated for private repositories. This repository is public, so the
  attestation is real.
- The first publish is manual, once, per the constraint above.
