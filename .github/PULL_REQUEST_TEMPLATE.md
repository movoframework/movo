## What and why

<!-- What changes, and why. Link the issue or the milestone task. -->

**Milestone:** <!-- M0 / M1 / … -->

## Checklist

- [ ] Tests added or updated
- [ ] Typecheck, lint, build, unit + integration tests pass
- [ ] Licence gate and track-isolation check pass
- [ ] No secrets; no new logging of payloads or headers
- [ ] No protocol behaviour invented; no upstream functionality duplicated (cite the upstream
      export if adjacent)
- [ ] Narrow-waist rule respected — only `packages/core/src/protocol/**` imports `@x402/*`
- [ ] Documentation updated; every new code block compiles
- [ ] Public API changes documented and a changeset added
- [ ] Security implications stated
- [ ] Any new dependency justified in writing, with its licence named
- [ ] Milestone scope respected — no work from a later milestone

## Upstream

<!-- If this PR sits next to functionality that @x402/* already provides, name the upstream
     export and say why Movo is not simply importing it. If nothing is adjacent, write "n/a". -->

## Security implications

<!-- What this changes about key handling, payload logging, network trust, or spend authority.
     "None" is an acceptable answer, but state it explicitly. -->

## New dependencies

<!-- Package, licence, and why a Node built-in will not do. "None" if none. -->

---

Two approvals are required for changes to `packages/core`, `packages/facilitator`, or the
licence/CI tooling. One otherwise.
