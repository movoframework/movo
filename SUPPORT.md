# Support

> **Stub.** Movo is at milestone M0 — workspace, toolchain and compliance gates only. There is
> no published package to support yet. This file records the support policy that will apply
> from v0.1.0 and will be expanded when there is something to support.

## Getting help

- **Bugs and feature requests** — open an issue using the templates.
- **Upstream protocol drift** (an `@x402/*` shape, behaviour or wire change) — use the
  `protocol-drift` issue template.
- **Security vulnerabilities** — do not open an issue; see [SECURITY.md](SECURITY.md).

## Supported Node.js versions

| Version | Status |
|---|---|
| Node.js 22 (Maintenance LTS) | Supported — in the CI matrix |
| Node.js 24 (Active LTS) | Supported — primary development and CI target |
| Node.js 26 (Current) | Supported — in the CI matrix |
| Node.js ≤20 | Not supported — below the upstream engine floor |

Movo is **ESM-only**. CJS `require()` of `@movo/*` is not supported.

## `@x402/*` compatibility window

`@x402/*` dependencies are exact-pinned. The versions a given Movo release was built and
tested against are recorded in [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md), which is
generated rather than hand-maintained.

An `@x402/*` breaking change that forces a Movo API change is a **Movo major**. Movo does not
silently absorb protocol breaks.

## Deprecation policy

A public API is deprecated for at least one minor release — emitting a warning and carrying a
documented migration path — before it is removed.

Package stability tiers:

| Tier | Meaning |
|---|---|
| **Stable** | A breaking change requires a major release and a migration note |
| **Experimental** | May break in a minor release; marked as such in the package README and type docs |
| **Internal** | `private: true`, never published, no compatibility promise |
