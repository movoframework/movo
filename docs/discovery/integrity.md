# Catalog integrity

**The catalog is a trust boundary.** Clients echo the seller's `resource` block back into the
payment payload, so every field the catalog ingests is attacker-influenced — the URL, the service
name, the tags, the icon, the route template, the declared schema, and the `payTo` inside the
echoed block. Anyone who can pay you a tenth of a cent can attempt to write to your index.

This page is what stops that being a problem.

## The one control that matters most

**A listing is owned by the `payTo` that actually settled, and an update whose settled `payTo`
differs from the stored owner is refused.**

Ownership comes from `paymentRequirements.payTo` — the requirements that settled — and never from
the `payTo` inside the buyer-echoed resource block, and never from the settled transaction.

The last of those is worth dwelling on, because it looks like the more rigorous choice and is
wrong. Deriving ownership from the settled transaction would find the **facilitator's** address as
the transaction source on every single settlement, because fee sponsorship makes the facilitator
the source. A catalog built that way would refuse every legitimate listing it was ever handed.

`requirements.payTo` is trustworthy because upstream's `ExactStellarScheme` has already enforced,
at verify time, that the buyer-signed transaction pays that address and that the facilitator cannot
redirect it (`invalid_exact_stellar_payload_event_wrong_to`, `..._facilitator_in_auth`,
`..._unsafe_tx_or_op_source`). By the time a settlement succeeds, the address in the requirements
is the address the money went to. The catalog does not re-derive that, and must not.

## The six controls

Each fails closed with its own distinct, non-null reason. They are named in one place —
`ADVERSARIAL_CONTROLS` in `packages/catalog/src/reasons.ts` — and the adversarial suite enumerates
that object rather than restating it, so a seventh control added without a test fails a
completeness assertion.

| Attack | Reason | Control |
|---|---|---|
| Overwrite another seller's listing | `listing_owner_mismatch` | Compare settled `payTo` against the stored owner, inside the store's own transaction |
| Forge `payTo` | `listing_pay_to_forged` | The echoed `payTo` must equal the one that settled |
| Percent-encoded traversal in `routeTemplate` | `listing_route_template_invalid` | Percent-decode **before** the traversal check |
| Loopback `iconUrl` | `listing_icon_url_invalid` | Upstream's `isValidIconUrl` SSRF check, escalated |
| External `$ref` | `listing_schema_ref_external` | `$ref`/`$id` must be same-document JSON Pointer fragments |
| Oversized fields | `listing_field_too_large` | Per-field caps |

Movo writes **none** of the underlying rules. Whether a route template is valid, whether an icon
URL is acceptable, whether service metadata is well-formed — all of that belongs to
`@x402/extensions` and is reached through the narrow waist. What Movo adds is ownership (which
upstream cannot know), size caps against this deployment's configuration, and the escalation
described next.

## Why the controls read the *raw* extension

This is the subtle part, and it was found by test rather than predicted.

**Upstream soft-drops.** An invalid `routeTemplate` is silently discarded and the listing falls
back to the concrete pathname; an invalid `iconUrl` is silently removed by
`sanitizeResourceServiceMetadata`. That is correct behaviour for a facilitator that should
catalogue as much as it safely can.

But it means that a control inspecting only upstream's *output* sees a clean result and reports
**success on the attack** — having quietly catalogued a listing under a different key than the
attacker asked for. The percent-encoded traversal and loopback-icon cases both behaved exactly this
way in the first implementation.

So the controls read the raw resource extension **from the payload, before upstream extraction**,
compare it against what survives extraction, and escalate any field upstream soft-dropped to its
own rejection reason. Asserting on post-extraction output alone is not a weaker version of this
check; it is a check that passes because the evidence was swallowed.

This is the delegation rule in its trust-boundary form: consuming a delegate's result includes
detecting what the delegate silently discarded.

## Check order is part of the control

`$ref` validation runs **before** the schema validator, not after. Two reasons:

- **Security.** `validateDiscoveryExtension` resolves the declared schema in order to validate
  `info` against it. Handing it a schema carrying `$ref: "https://attacker.example/…"` asks a
  validator to dereference an attacker-supplied URL from your settle path. The reference check
  exists to prevent that, so it must run first.
- **Diagnostics.** With the checks the other way round, the external-`$ref` attack came back as
  `listing_info_invalid` — the validator simply failed to resolve the remote reference. The six
  reasons were distinct when the controls were called directly and quietly collapsed to five on the
  path a real settlement takes. Found by running the adversarial cases through `ingestSettlement`
  rather than through the control functions.

## The tests assert on stored state

Every adversarial test checks what the **store** contains — the row count, the surviving owner, the
settlement count — and treats the reason string as a secondary signal.

That is not stylistic. M6 shipped a green concurrency gate over 190 failed settlements because it
grepped a rejection reason for a substring that upstream had collapsed into an opaque one. A reason
string is evidence about what the code *said*; the store is evidence about what it *did*.

## Concurrent writes

Two settlements for the same route arriving at the same instant must not both read "no existing
owner" and both write. The comparison and the write therefore happen in one transaction, and the
**store** decides the winner rather than the caller:

- **SQLite** — compare-and-write inside one `IMMEDIATE` transaction
- **Postgres** — `INSERT … ON CONFLICT (id) DO UPDATE … WHERE listings.pay_to = EXCLUDED.pay_to`,
  one statement, one round trip, no window

Both are tested with genuinely concurrent conflicting writers, against both backends, asserting on
which owner survived rather than on what was reported.

## Resource exhaustion

- Every ingested field has a size cap (`DEFAULT_FIELD_CAPS`), inclusive at the boundary.
- Search queries are truncated at 512 characters.
- Page sizes are capped regardless of the `limit` requested.
- Settlements below the dust threshold do not increment activity, so ranking signals cannot be
  bought at a rounding error.

## What this does not defend against

Stated plainly, because a security page that claims completeness is not one:

- **A seller lying about what their endpoint does.** The catalog verifies who owns a listing and
  that its metadata is well-formed. It cannot verify that a resource described as a weather API
  returns weather. `failureCount` and `settlementCount` are the signals a buyer has, and neither is
  a guarantee.
- **A seller paying themselves to inflate activity.** The dust threshold makes this cost real
  money rather than a rounding error, and that is the whole of the defence. It is a cost, not a
  prohibition.
- **Squatting a route template before the real owner is paid.** First settlement wins. Whoever is
  paid first for a given `routeTemplate` at a given origin owns that listing.

## See also

- [Running a catalog](./running-a-catalog.md)
- [Search quality](./search-quality.md) — ranking is never for sale
- [Bazaar validation](../bazaar/validation.md) — the seller-side half of the same rules
