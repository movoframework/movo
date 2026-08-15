# Spec Amendment 008 — M4 complete, closing rulings

**Applies to:** `MOVO_FINAL_ARCHITECTURE_SPEC.md` §5.7, §22; amendments 003 §4, 007
**Trigger:** M4 complete. `@movoframework/bazaar` and `@movoframework/client` shipped; the
rebuilt files pass every §8 check from amendment 007; the `logExtensionResponsesHeader` gap was
independently re-confirmed against `@x402/core` compiled source.
**Status:** binding — supersedes the spec and earlier amendments where they conflict

---

## M4 — ACCEPTED

The rebuild inverts the discarded WIP on every axis that mattered. Amendment 007 §8 named five
places the WIP failed; the completion report demonstrates each now succeeds, with real command
output rather than assertion. The narrow-waist extension landed first as the structural
precondition (§4 of amendment 007), so `packages/bazaar` reaches upstream validators only
through `packages/core/src/protocol/`, and imports `@x402/*` directly nowhere.

`[FACT — re-verified independently]` `@x402/core` contains `logExtensionResponsesHeader` as a
module-private function (reads the `EXTENSION-RESPONSES` header, base64-decodes, JSON-parses,
filters to a `[status, rejectedReason, reason, code]` allowlist) but exports no public decoder
on its `.d.mts` surface. `responses.ts` / `readCatalogOutcome` therefore fills a real gap, and
decodes against the same wire format upstream's own reader uses.

## 1. `deriveDiscovery` — the compile-time vs request-time boundary

**RULING.** The empty-`accepts` finding is correct and its resolution is the binding pattern.
`checkIfBazaarNeeded` and the upstream discovery helpers require `x402Version`, `accepts`, and
`lastUpdated` on each resource — but `accepts` is built by the payment middleware at request
time and does not exist when `deriveDiscovery` runs at compile time. Calling the upstream
runtime helper during derivation therefore returns `false` unconditionally and discovery
silently never activates.

`deriveDiscovery` checks `discovery.enabled` structurally at compile time and leaves the
runtime `accepts`-shaped gating to upstream at request time. This is the same class of boundary
as amendment 004 §2's settle-after-handler: a correctness question answerable only by tracing
*when* each piece of data exists, not *what shape* it has. Any future code that calls a
request-time upstream helper from a compile-time Movo path is suspect on the same grounds.

## 2. `MOVO_W_DISCOVERY_INTERNAL_HOST` — additive, within D3

**RULING.** Warning on an internal/loopback hostname in `resource.url` is **not** a D3
violation. Upstream `isValidIconUrl` covers `iconUrl`; nothing upstream inspects the resource
URL itself for internal hosts, and §22 asks for this check. It is additive, not a reimplemented
validator, and it fires as a warning — an internal-host resource URL is a plausible
development-time state, not a definitional failure. This is the mirror image of the discarded
WIP's `routeTemplate.ts`, which reimplemented a check upstream already owned; the test for D3 is
"does upstream already do this," and here it demonstrably does not. Diagnostics that upstream
does not provide remain Movo's to add.

## 3. `readCatalogOutcome` — four states, malformed distinguished from absent

**CONFIRMED.** The union is `success | processing | rejected | unknown`. Malformed base64 and
absent header both resolve to `unknown` without throwing; present-but-rejected is its own state.
Collapsing malformed into a thrown error, or into the same value as a clean success, would
reintroduce the false-signal problem amendment 004 §1 ruled on for `EXTENSION-RESPONSES`. §5.7's
contract stands as implemented.

## 4. Amendment 003 §4(1) closed

The M1 limitation — `MOVO_W_PARAM_UNDESCRIBED` and schema introspection only work for
Zod-shaped schemas because Standard Schema exposes validation, not introspection — was carried
forward to M4's `inputSchema` derivation. M4 resolved it as directed: the explicit `inputSchema`
override is the documented path for non-Zod users, and `deriveDiscovery` surfaces the same
limitation rather than silently emitting empty parameter metadata. The amendment 003 §4(1)
action item is closed.

## 5. `serviceName` pre-validation — none, by ruling

**CONFIRMED CORRECT.** `[FACT — probed live]` upstream `isValidServiceName` rejects hyphen and
underscore (its printable set is narrower than it looks — `isValidServiceName("My-Service_123")`
returns `false`). Movo passes `serviceName` to upstream verbatim and does not pre-validate. A
Movo-side pre-check would either duplicate upstream (D3) or, worse, disagree with it and reject
names upstream accepts — the exact divergence risk the narrow waist exists to prevent. The
absence of a check here is a decision, not an omission; do not add one.

## 6. Two findings promoted to standing review questions

Both go in `CONTRIBUTING.md` alongside the existing rules.

**(a) Delegation that discards its delegate's result is not delegation.** The discarded WIP's
`validate.ts` wrapped upstream `validateDiscoveryExtension` in a try/catch and threw away its
`{valid, errors}` return — upstream does not throw, so the one real upstream call in the file
did nothing, while *reading as* delegation. This is sharper than the three plausible-fake
instances already recorded (amendment 004 §6), because a grep for "does this call upstream?"
passes. The review question: *when Movo code calls an upstream function, does it consume the
return value, or only appear to call it?* A call whose result is discarded is a reimplementation
wearing a delegation costume.

**(b) A correct answer to a question nobody asked is still scope creep.** The WIP's
`deriveRouteTemplate` inferred a route template from a concrete path (`/status/200` →
`/statu/:statuId`) — buggy, but the deeper defect is that a `defineResource` path is *already* a
template the author wrote, so the whole code path never executes given M1's resource model. The
review question: *does this feature answer a question the rest of the system actually asks, or
one it only might ask in some other design?* Scope creep enters not as a wrong answer but as a
correct answer to an invented question.

## 7. Carried forward into M5

- **Amendment 004 §8** — the dedicated stock-client conformance suite (§1.16 layer 4) remains
  open. M5 or M8 must either write it or explicitly re-scope layer 4 to the e2e suite. Not an
  M4 blocker; still unresolved.
- **Amendment consolidation** — the reading list is now spec + 8 amendments. At the M5 gate
  (Gate 2), fold 001–008 into a revised spec so a fresh agent session is not reconstructing
  eight documents of history before writing code. Not before M5: M5 will likely produce its own
  rulings, and consolidating twice wastes the effort.

## 8. Note on agent selection

M4 is the cleanest natural experiment the project has run. The same milestone, same spec, same
amendments was attempted by a general-purpose assistant (890 discarded lines, never compiled,
reimplemented four upstream validators against a rule stated plainly in its prompt) and then by
an agent working from the full context trail (accepted on first review, every §8 check shown to
pass). The guardrails caught the first attempt completely — D3, the narrow-waist lint, and the
plausible-fake rule each fired exactly where designed. The lesson is not that one tool is
categorically better; it is that milestone scope handed to an agent without the accumulated
context reliably fails in the shape the rules predict, and the review step is what converts that
failure into a discard rather than a merged defect. Weigh the credit cost of the discard-rebuild
cycle before assigning milestone scope that way again.
