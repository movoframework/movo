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

## Notes for whoever picks these up

- Verify current upstream behaviour by reading `node_modules/@x402/*/dist/**/*.d.mts` before
  writing anything. Every claim on this page was checked against installed declarations at
  `@x402/*` 2.21.0 and may have moved.
- Item 3 has a reproduction in `tests/e2e/mcp-agent-discovery.test.ts`, which asserts the
  four-state union precisely because `unknown` is what actually comes back.

## Related

- [Running a catalog](./running-a-catalog.md#known-upstream-gap)
- [Catalog integrity](./integrity.md)
