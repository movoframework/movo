# Spec Amendment 005 — M3 pre-implementation conflict resolution

**Applies to:** `MOVO_FINAL_ARCHITECTURE_SPEC.md` §5.4, §21 (M3 prompt)
**Trigger:** M3 not yet started. Codex halted before writing any code, per the STOP-on-conflict
rule, having found two internal inconsistencies in the spec rather than the prompt.
**Status:** binding — supersedes §5.4 and the M3 prompt where they conflict

---

## What happened

Correct behaviour: no code was written, no verification commands were run, and both conflicts
were reported rather than resolved unilaterally. This is exactly what the STOP-on-conflict rule
in `CLAUDE.md` and the M0–M8 prompts is for. Neither conflict is a misreading — both are real
inconsistencies in the spec, introduced at different times by different sections that were
never checked against each other.

---

## 1. `MountOptions.facilitator` — the string-literal shorthand is deleted

**THE CONFLICT.** §5.4 specified:

```ts
interface MountOptions {
  facilitator?: "config" | "in-process" | "mock" | FacilitatorClient;
  ...
}
```

§4.2 (and independently, M3's own scope) states `@movoframework/testing` may appear only in
`devDependencies` of any consumer — `MockFacilitator` and `InProcessFacilitator` live there.
For `@movoframework/server` to resolve the strings `"in-process"` and `"mock"` into working
instances, it would need to import and construct types from `@movoframework/testing` at
runtime, which the dependency-direction rule forbids. Accepting the strings without that
dependency would mean the type signature typechecks while two of its four documented values
cannot actually mount anything — the precise "plausible fake" shape named in amendment 004 §6.

**DECISION.** `MountOptions.facilitator` accepts **only** `"config" | FacilitatorClient`. The
string-literal shorthand for `"in-process"` and `"mock"` is removed from the type entirely.

```ts
interface MountOptions {
  facilitator?: "config" | FacilitatorClient;
  config?: Partial<MovoConfig>;
  onFinding?: (f: Finding) => void;
}
```

**WHY THIS IS THE RIGHT FIX, NOT A WORKAROUND.** `@movoframework/server` stays pure — no
dependency on `@movoframework/testing`, direct or transitive, matching every other purity
decision already ruled in this project (the `@x402/express` subpath split in amendment 004 §3
is the same shape: keep the foundational package free of a dependency that only some callers
need). Construction of a `MockFacilitator` or `InProcessFacilitator` happens in whichever
caller wants one — `movo dev`, a test file, an example app — none of which are
`@movoframework/server` itself, so all of them may depend on `@movoframework/testing` freely.
The caller passes the constructed instance in:

```ts
// in a test, or in movo dev's --facilitator in-process handling
const facilitator = createInProcessFacilitator({ signer, network: "stellar:testnet" });
await mountExpress(app, movoApp, { facilitator });
```

**CONSEQUENCE FOR M5.** `movo dev --facilitator in-process|mock` still works exactly as
documented in §5.12 — the CLI flag's string parsing and its resulting *construction* of a
`MockFacilitator`/`InProcessFacilitator` live in `@movoframework/cli`, which already depends on
`@movoframework/testing` per §3.1's package register. The CLI constructs the instance and passes
it to `mountExpress`; `@movoframework/server` never sees the string. No user-facing behaviour
described anywhere in the spec is lost — only the internal mechanism changes, and it changes to
close a real hole rather than paper over one.

**§5.4 is corrected to the signature above.** Any test asserting `mountExpress` accepts the
string `"in-process"` or `"mock"` directly is wrong and must not be written.

## 2. `InProcessFacilitator` scenario coverage — AC3.2 is authoritative

**THE CONFLICT.** The M3 prompt's walkthrough prose says to run "the entire nine-scenario
matrix" against `InProcessFacilitator` on testnet. AC3.2, the actual acceptance criterion,
specifies only the five signed-payload mutation scenarios there.

**DECISION.** AC3.2 is correct. `InProcessFacilitator` is exercised by exactly the five
mutation scenarios: `wrongNetwork`, `wrongAsset`, `wrongAmount`, `expired`, `replayed`. The
remaining four — `facilitator5xx`, `facilitatorTimeout`, `facilitatorMalformed`,
`handlerFailureAfterVerify` — run against `MockFacilitator` only.

**WHY.** The four excluded scenarios are not payment-validity questions; they are questions
about how Movo's orchestration behaves when the *facilitator itself* misbehaves or when the
*handler* fails after a valid verification. A real facilitator — which is what
`InProcessFacilitator` is, per its own naming rule in §5.11 — cannot be instructed to return a
malformed response, time out, or 500 on demand; only a program built to simulate that behaviour
can, which is `MockFacilitator`'s entire reason for existing. Running all nine against
`InProcessFacilitator` is not just extra coverage, it is a category error: it asks a real
component to fake being broken, which is a strange thing to build and a stranger thing to test.
The "nine scenarios, run twice" framing in the prompt's prose was loose language describing the
suite's total scope, not a literal instruction that both facilitators run all nine.

**CONSEQUENCE.** §21's acceptance criteria list stands as originally written (AC3.1 through
AC3.6). The prompt's prose walkthrough is corrected by this amendment wherever it conflicts.

## 3. General note on this incident

Both conflicts existed in the spec since it was written — M3 didn't introduce them, it was the
first work close enough to the seam between §5.4, §4.2, and §21 to expose them. This is the
expected cost of a ~36,000-word specification written in one continuous pass: internal
cross-references were not exhaustively checked against every other section that touches the
same object. The mitigation already in place — STOP on conflict, report rather than guess — is
what caught this before any code existed to build on top of the wrong assumption, which is
exactly the point at which a conflict like this is cheapest to fix.

No change to CONTRIBUTING.md is needed; the existing STOP-on-conflict rule already covers this
correctly and was followed correctly.

---

## Resume M3

The prompt for M3 is unchanged except for the two corrections above. Point Codex at this file
in addition to amendments 001–004, and instruct it to resume M3 from the point where it
stopped, applying §1 and §2 of this document as binding.
