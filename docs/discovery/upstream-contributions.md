# Upstream contributions

§25.14 makes this an obligation rather than good citizenship: **any validation gap found in
`@x402/extensions` is contributed upstream, and interop problems found against other facilitators
are reported.** Discovery conventions are still moving, and a facilitator that keeps its
corrections to itself becomes a dialect.

Each item below is tracked with its own done-state, because these depend on third-party review and
merge and can therefore land after the in-repo work without blocking it.

## Open

### 1. The role-based developer guide, to Stellar Developer Docs

**Status: not submitted. In-repo guide complete.**

RFP §5 asks for the guide to be contributed to the Stellar Developer Docs. The in-repo version is
[`docs/guide/`](../guide/README.md) — three paths, seller / buyer-and-agent / operator, each ending
in something runnable against testnet.

Done when: merged into `stellar/stellar-docs`, or declined with a reason recorded here.

Note when adapting it: the in-repo guide links to Movo packages throughout. The upstream version
should lead with the x402-on-Stellar concepts and treat Movo as one implementation, because that is
what makes it useful to somebody who is not using Movo.

### 2. A public decoder for `EXTENSION-RESPONSES`

**Status: not submitted.**

`@x402/core` has an internal `logExtensionResponsesHeader` but exports no public decoder, so every
client that wants to read the header writes its own base64-and-JSON handling — including
`readCatalogOutcome` in `@movoframework/bazaar`, which exists only because of this gap.

Proposal: export a decoder returning an explicit four-state result. The state that matters is
`unknown`: a malformed header and an absent header are both "no information", and collapsing either
into a failure invents a signal that is not there.

Done when: a public decoder ships upstream and `readCatalogOutcome` delegates to it.

### 3. Forward `EXTENSION-RESPONSES` to the buyer

**Status: not submitted. Found during M7 testnet e2e.**

The resource server reads the facilitator's `EXTENSION-RESPONSES` on the settle response and logs
it, but does not forward it on the response to the buyer. The consequence is that a buyer's catalog
outcome is `unknown` through *any* x402 resource server, no matter what the facilitator reported —
so a seller cannot confirm from a payment that their listing landed, and has to query
`/discovery/resources` instead.

This looks like an oversight rather than a decision: the header is defined for the buyer's benefit
and the facilitator populates it faithfully. If it *is* deliberate — a deliberate refusal to let a
facilitator put arbitrary bytes on a resource server's response — then the specification should say
so, and the field's purpose should be restated.

Done when: forwarded upstream, or the reasoning is documented and Movo's docs are corrected.

## Prepared submissions (M8)

Each item below is written out ready to file. The point of preparing them here rather than filing
them from a milestone is that filing is a third-party interaction with third-party timing: the work
is done and the done-state stays open until someone else acts. **Nothing in this section is
submitted yet.**

**Re-verified against the installed declarations on 2026-08-24, at `@x402/*` 2.21.0**, per the
standing rule that upstream behaviour is read rather than recalled:

- Item 2 stands. `logExtensionResponsesHeader` is defined in
  `@x402/core/dist/esm/chunk-VKJGPEW2.mjs` and appears in **no** `.d.mts` declaration file, so it
  is not part of the public API. It also *logs* rather than returns — it `console.log`s an
  allowlisted subset (`status`, `rejectedReason`, `reason`, `code`) and discards the rest — so even
  patching it into scope would not give a caller the value. A consumer that wants the outcome has
  no option but to re-implement base64-and-JSON decoding, which is exactly what
  `readCatalogOutcome` does.
- Item 3 stands, and item 2's implementation is the evidence for it: the resource-server path
  calls `logExtensionResponsesHeader(response)` and then does nothing else with the header.

### Draft — item 2

> **Title:** Export a public decoder for the `EXTENSION-RESPONSES` header
>
> `@x402/core` reads `EXTENSION-RESPONSES` internally in `logExtensionResponsesHeader`, but the
> function is not exported and it logs rather than returns — it prints an allowlisted subset and
> discards the payload. Any client that needs the cataloging outcome must therefore write its own
> base64-and-JSON handling against a header the library already parses.
>
> Proposal: export a decoder returning an explicit four-state result —
> `success | processing | rejected | unknown`.
>
> The state that carries the design is `unknown`. A malformed header and an absent header are both
> "no information", and collapsing either into a failure invents a signal that is not there: a
> buyer would be told their listing was rejected when in fact nothing was said. We implemented this
> as `readCatalogOutcome` and would rather delete it than maintain a second decoder.

### Draft — item 3

> **Title:** `EXTENSION-RESPONSES` is not forwarded to the buyer through a resource server
>
> The resource server reads the facilitator's `EXTENSION-RESPONSES` on the settle response and logs
> it, but does not set it on the response returned to the buyer. The consequence is that a buyer's
> cataloging outcome is `unknown` through **any** x402 resource server regardless of what the
> facilitator reported — so a seller cannot confirm from their own payment that their listing
> landed and must poll `/discovery/resources` instead.
>
> This looks like an oversight: the header is defined for the buyer's benefit and the facilitator
> populates it faithfully. If it is deliberate — a refusal to let a facilitator place arbitrary
> bytes on a resource server's response — then the specification should say so and the field's
> purpose should be restated, because as written it promises the buyer something they cannot
> receive.
>
> Reproduction: a resource server with the bazaar extension enabled, paid by a stock client; the
> facilitator's response carries the header and the buyer's does not.

### Draft — item 1

The guide is written and lives in [`docs/guide/`](../guide/README.md). Submission is an adaptation
task, not a writing task, and the adaptation note above is the whole of it: lead with the
x402-on-Stellar concepts and treat Movo as one implementation. Done when merged into
`stellar/stellar-docs` or declined with the reason recorded here.

## Notes for whoever picks these up

- Verify current upstream behaviour by reading `node_modules/@x402/*/dist/**/*.d.mts` before
  writing anything. Every claim on this page was checked against installed declarations at
  `@x402/*` 2.21.0 and may have moved.
- Item 3 has a reproduction in `tests/e2e/mcp-agent-discovery.test.ts`, which asserts the
  four-state union precisely because `unknown` is what actually comes back.

## Related

- [Running a catalog](./running-a-catalog.md#known-upstream-gap)
- [Catalog integrity](./integrity.md)
