/**
 * `@movoframework/bazaar` — derivation and severity escalation for x402 Bazaar discovery.
 *
 * **This package implements no validator.** Upstream `@x402/extensions` ships all of them,
 * including the icon-URL SSRF check, route-template validation with percent-decoded traversal
 * detection, service-name and tag sanitisation. A second implementation would be a divergence
 * risk with no benefit: two validators that disagree is a bug factory, and the security-relevant
 * checks belong upstream where the whole ecosystem benefits from fixes (spec §1.8 D3).
 *
 * Movo contributes exactly two things:
 *
 * **Derivation.** `deriveDiscovery` builds the upstream declaration from the Movo resource, so
 * the route definition and the discovery metadata cannot drift apart. Upstream's model asks an
 * author to keep three artefacts in sync by hand and detects nothing when they stop agreeing.
 *
 * **Severity escalation.** `validateDiscoveryStrict` runs upstream's validators at build time
 * and turns each silent soft-drop into an error-level `Finding`. Upstream drops an invalid field
 * and catalogues the rest, which is right for a facilitator and wrong for an author — the first
 * they would learn of it is a listing with no icon and no explanation.
 *
 * The `@x402/*` surface reaches this package through `@movoframework/core/bazaar`, the narrow
 * waist. Nothing here imports `@x402/*` directly (ADR-0004, amendment 007 §4).
 */

export { attachDiscovery } from "./attach.js";
export {
  type DerivedDiscovery,
  type DiscoveryOverrides,
  deriveDiscovery,
} from "./derive.js";
export { validateDiscoveryStrict } from "./escalate.js";
export {
  isJsonSchema,
  type JsonSchema,
  type SchemaDerivation,
  schemaVendor,
  toJsonSchema,
} from "./json-schema.js";
export {
  type CatalogOutcome,
  isCatalogRejection,
  readCatalogOutcome,
  type UnknownReason,
} from "./outcome.js";
export {
  type CatalogClient,
  type QueryCatalogOptions,
  queryCatalog,
} from "./query.js";

/** The published version of this package. */
export const VERSION: string = "0.0.0";
