# Spec Amendment 002 — naming, scope, and publishing

**Applies to:** `MOVO_FINAL_ARCHITECTURE_SPEC.md`, `SPEC_AMENDMENT_001.md`, `CLAUDE.md`, all M1–M8 prompts
**Trigger:** npm org creation attempts; `movo`, `passa` and `tolla` all unavailable
**Status:** binding — amends the spec and amendment 001 where they conflict

> **Voids an earlier draft.** A previous draft of this amendment proposed renaming the project to Passa. Its stated pre-flight check — successful npm org creation — failed: `passa` and `tolla` are both reserved as npm organisations with no published packages, which a registry search cannot detect. That draft is void. This document replaces it.

---

## 1. Decision: name and scope

**DECISION.** The project is named **Movo**. Packages publish under the npm scope **`@movoframework/*`**.

**WHY.** `movo` was unavailable on npm and GitHub. `passa` and `tolla` were both reserved as empty npm organisations. `movoframework` was available and has been created. Further searching would cost more than the decision returns — the project's real risks are upstream API drift (R1) and adoption (R15), and neither is affected by the name.

**CONSEQUENCE.** The npm scope and the product name differ deliberately. This is unremarkable: the scope appears only in import specifiers, while the product name appears everywhere a human reads.

## 2. What changes, and what does not

**Changes — this is the entire blast radius:**

| Was | Becomes |
|---|---|
| `@movo/core` | `@movoframework/core` |
| `@movo/server` | `@movoframework/server` |
| `@movo/stellar` | `@movoframework/stellar` |
| `@movo/bazaar` | `@movoframework/bazaar` |
| `@movo/client` | `@movoframework/client` |
| `@movo/testing` | `@movoframework/testing` |
| `@movo/cli` | `@movoframework/cli` |
| `@movo/facilitator` (M6) | `@movoframework/facilitator` |
| `@movo/catalog` (M7) | `@movoframework/catalog` |
| `@movo/mcp` (M7) | `@movoframework/mcp` |

**Does NOT change — leave all of this alone:**

| Item | Value | Why |
|---|---|---|
| Product name | **Movo** | A scope is a registry namespace, not a brand |
| CLI binary | `movo` | The `bin` name is independent of the package scope |
| Scaffolder package | `create-movo-app` | Unscoped and available; `npm create movo-app` is unaffected |
| Config file | `movo.config.ts` | — |
| Environment prefix | `MOVO_*` — `MOVO_PAY_TO`, `MOVO_ENV`, `MOVO_ALLOW_PUBNET`, `MOVO_FACILITATOR_URL`, `MOVO_E2E`, `MOVO_LOG_LEVEL` | — |
| Error codes | `MOVO_E_*`, `MOVO_W_*` | — |
| Type and class names | `MovoError`, `MovoResource`, `MovoConfig`, `MovoApp`, `MovoRequestContext`, `MovoPaymentContext`, `MovoHooks` | — |
| Directory names | `packages/core`, `packages/server`, … | Filesystem paths are unaffected by the scope |
| Narrow-waist lint rule path | `packages/core/src/protocol/**` | It restricts `@x402/*` by path; neither side involves the Movo scope |
| Document filenames | `MOVO_FINAL_ARCHITECTURE_SPEC.md` and the amendments | Renaming breaks `CLAUDE.md` and every prompt reference for no gain |

## 3. Repository and organisation

| Item | Value |
|---|---|
| npm organisation | `movoframework` — created |
| GitHub organisation | `movoframework` — match the npm org |
| Repository | `movoframework/movo` |
| Clone URL | `git@github.com:movoframework/movo.git` |

## 4. Documentation URL — indirection now, domain later

**DECISION.** The error-docs base URL is a single exported constant, never a repeated literal.

```ts
// packages/core/src/errors/registry.ts
export const DOCS_BASE_URL = "https://movoframework.github.io/movo";
// error docs resolve to `${DOCS_BASE_URL}/errors/${code}`
```

**WHY.** §5.10 bakes a docs URL into every `MovoError`. Whether `movo.dev` is obtainable should not block M1, and a constant makes the eventual domain a one-line change rather than a sweep across a registry holding dozens of codes.

**ACTION.** Check `movo.dev` and `movoframework.dev`. If either is obtainable, buy it and change the constant. Until then GitHub Pages under the org is a real working URL — which matters, because an error message pointing at a 404 is worse than one pointing nowhere.

**TEST.** M1 must assert that every registry code resolves to a URL built from `DOCS_BASE_URL`, so no literal creeps back in.

## 5. Reserve `create-movo-app` before M1

`passa` and `tolla` were lost to reserved-but-empty organisations. The same exposure applies to `create-movo-app`, which is currently unpublished — and which is the single most visible string in the product, appearing in the README's first code block and in the quickstart.

**ACTION.** Publish a minimal placeholder `create-movo-app@0.0.0` under the `movoframework` org before starting M1. It should print a "not yet released — see github.com/movoframework/movo" message and exit non-zero. This is legitimate reservation of a name for a package under active development, and it closes a risk that would be unrecoverable if realised.

## 6. Publishing strategy — npm 2FA token restrictions

`[FACT — npm dashboard notice, observed 2026-08]` npm is restricting tokens that bypass 2FA: account changes from August 2026, direct publishing from January 2027.

**DECISION.** M8's release workflow uses **OIDC trusted publishing from GitHub Actions**, not a long-lived automation token in a repository secret.

**WHY.** The token path is being restricted inside this project's lifetime. Building the release workflow on a deprecating mechanism guarantees rework, and it would arrive at the worst possible moment — mid-release.

**CONSEQUENCES.**
- The release job declares `permissions: { id-token: write }`.
- Trusted publishing is configured per package on npm, linked to `movoframework/movo` and the release workflow file. That configuration must exist **before** the first publish.
- npm provenance is already a Gate 3 requirement and comes from the same OIDC mechanism, so this satisfies both at once.
- `[VERIFY]` M8 must confirm current trusted-publishing requirements at `docs.npmjs.com` before writing the workflow — the mechanism is changing on the timeline above.

**Add to the M8 prompt**, in its CI and release section:

```text
Use npm OIDC trusted publishing from GitHub Actions. Do NOT create a long-lived npm
automation token stored as a repository secret — npm is restricting 2FA-bypassing tokens
(account changes August 2026, direct publishing January 2027), so a token-based workflow
would need replacing almost immediately. Verify current trusted-publishing requirements at
docs.npmjs.com before writing the workflow, and configure trusted publishing on npm for each
package, linked to this repository and the release workflow file, before the first publish.
```

## 7. Mechanical rename procedure

M0 shipped eight packages each exporting a version constant, so this is small. Do it before starting M1.

1. Update the `name` field in each `packages/*/package.json`: `@movo/x` → `@movoframework/x`.
2. Update cross-package workspace dependency entries, which are keyed by package name.
3. Update any import specifier — at M0 there should be almost none.
4. Update `tsconfig` path aliases if any were declared.
5. Leave the `noRestrictedImports` rule untouched.
6. Update `README.md`, `CONTRIBUTING.md`, and any doc referencing `@movo/`.
7. Verify: `pnpm install && pnpm check:licenses && pnpm check:track-isolation && pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
8. Commit as `chore: adopt @movoframework npm scope`.

Completion check: `grep -rn "@movo/" --exclude-dir=node_modules .` returns nothing outside historical documents.

## 8. Amendment to every remaining prompt (M1–M8)

Append this to the `ARCHITECTURE CONSTRAINTS` section of each prompt in spec sections 19–23 and 27–29:

```text
NAMING — read Spec Amendment 002
- Packages publish under the @movoframework/* scope, NOT @movo/*.
- Everything else keeps the Movo name: the CLI binary is `movo`, the config file is
  movo.config.ts, environment variables are MOVO_*, error codes are MOVO_E_* and MOVO_W_*,
  and type names are MovoError, MovoResource, MovoConfig and so on. The scope is a registry
  namespace, not the product name — do not rename anything else to match it.
- The scaffolder is `create-movo-app` (unscoped), so `npm create movo-app my-api` remains
  the documented entry point.
- Error docs URLs are built from a single exported DOCS_BASE_URL constant in the error
  registry. Never write a docs URL literal anywhere else.
```
