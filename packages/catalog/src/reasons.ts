/**
 * Catalog ingest and query rejection reasons, defined exactly once.
 *
 * AC7.5 requires the six adversarial integrity tests to fail closed with **distinct, non-null**
 * reasons. Distinctness is the part that is easy to lose: six attacks that all report
 * `invalid_listing` are six attacks an operator cannot tell apart in a log, and an agent cannot
 * branch on. So each control has its own reason, and the adversarial suite asserts they are
 * pairwise distinct — derived from this object rather than from hand-written copies, per spec
 * v2 §A.2 rule 2.
 *
 * **These are Movo's, and only these.** Anything the *payment* was wrong about is upstream's
 * vocabulary and passes through untouched (M6 `packages/facilitator/src/reasons.ts` draws the
 * same line). Anything a *listing* is wrong about is decided by upstream's validators —
 * `validateRouteTemplate`, `isValidIconUrl`, `sanitizeResourceServiceMetadata`,
 * `validateDiscoveryExtension` — and Movo only names which control refused, never re-derives
 * the rule. That is §A ex-amendment 007's whole lesson: escalate, do not reimplement.
 *
 * **A note on §B.2 that applies directly here.** M6's AC6.8 gate grepped a reason string for
 * `/seq/` and reported green over 190 failed settlements, because upstream had collapsed the
 * distinguishing reason into an opaque one. The adversarial tests below therefore assert on
 * **real state** — that the row did not land, that the stored owner is unchanged, that the
 * count did not move — and use the reason only as a secondary signal. A reason string is
 * evidence about what the code *said*; the store is evidence about what it *did*.
 */

/** A rejection produced by the catalog's own trust-boundary controls. */
export const INGEST_REASONS = {
  /** The settled payTo differs from the stored owner of this listing. */
  ownerMismatch: "listing_owner_mismatch",
  /** The payTo in the echoed resource block differs from the one that actually settled. */
  payToForged: "listing_pay_to_forged",
  /** `routeTemplate` contains traversal, after percent-decoding. */
  routeTemplateInvalid: "listing_route_template_invalid",
  /** `iconUrl` is not an absolute http(s) URL to a non-internal host. */
  iconUrlInvalid: "listing_icon_url_invalid",
  /** A `$ref`/`$id` in the declared schema is not a same-document JSON Pointer fragment. */
  schemaRefExternal: "listing_schema_ref_external",
  /** A field exceeded its size cap. */
  fieldTooLarge: "listing_field_too_large",
  /** The discovery extension failed upstream's `info`-against-`schema` validation. */
  infoInvalid: "listing_info_invalid",
  /** The declaration failed upstream's protocol-level spec validation. */
  specInvalid: "listing_spec_invalid",
  /** The payload carried no bazaar extension, or none that could be extracted. */
  notDiscoverable: "listing_not_discoverable",
  /** The settlement itself did not succeed, so there is nothing to catalog. */
  settlementUnsuccessful: "listing_settlement_unsuccessful",
  /** The settled amount is below the configured dust threshold for activity counting. */
  belowDustThreshold: "listing_below_dust_threshold",
  /** The store refused the write. */
  storeWriteFailed: "listing_store_write_failed",
} as const;

/** One of the catalog's ingest rejection reasons. */
export type IngestReason = (typeof INGEST_REASONS)[keyof typeof INGEST_REASONS];

/** Every ingest reason, for the adversarial suite and the operator documentation. */
export const INGEST_REASON_VALUES: readonly IngestReason[] = Object.values(INGEST_REASONS);

/**
 * The six controls AC7.5 names, mapped to the reason each produces.
 *
 * Exported so the adversarial suite enumerates the criterion rather than restating it: a
 * seventh attack added here without a test fails the completeness assertion.
 */
export const ADVERSARIAL_CONTROLS: {
  readonly [attack: string]: IngestReason;
} = {
  "overwrite another seller's listing": INGEST_REASONS.ownerMismatch,
  "forge payTo": INGEST_REASONS.payToForged,
  "percent-encoded traversal in routeTemplate": INGEST_REASONS.routeTemplateInvalid,
  "loopback iconUrl": INGEST_REASONS.iconUrlInvalid,
  "external $ref": INGEST_REASONS.schemaRefExternal,
  "oversized fields": INGEST_REASONS.fieldTooLarge,
};

/** A short operator-facing message per reason. Never the branching signal. */
export const INGEST_REASON_MESSAGE: { readonly [K in IngestReason]: string } = {
  [INGEST_REASONS.ownerMismatch]:
    "This resource is already listed by a different payTo. A listing is owned by the address that settled it.",
  [INGEST_REASONS.payToForged]:
    "The payTo in the echoed resource block does not match the address that actually settled.",
  [INGEST_REASONS.routeTemplateInvalid]: "routeTemplate failed validation after percent-decoding.",
  [INGEST_REASONS.iconUrlInvalid]: "iconUrl is not an acceptable absolute http(s) URL.",
  [INGEST_REASONS.schemaRefExternal]:
    "A $ref or $id in the declared schema points outside the document.",
  [INGEST_REASONS.fieldTooLarge]: "A field exceeded its size cap.",
  [INGEST_REASONS.infoInvalid]: "The discovery info does not validate against its declared schema.",
  [INGEST_REASONS.specInvalid]:
    "The discovery declaration does not satisfy the Bazaar protocol specification.",
  [INGEST_REASONS.notDiscoverable]: "The payment payload carried no usable bazaar extension.",
  [INGEST_REASONS.settlementUnsuccessful]:
    "The settlement did not succeed, so there is nothing to catalog.",
  [INGEST_REASONS.belowDustThreshold]:
    "The settled amount is below the configured threshold for counting activity.",
  [INGEST_REASONS.storeWriteFailed]: "The catalog store refused the write.",
};
