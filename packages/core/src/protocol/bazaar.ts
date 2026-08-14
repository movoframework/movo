/**
 * THE NARROW WAIST — Bazaar half.
 *
 * Same directory, same rule, third module. This one carries the `@x402/extensions/bazaar`
 * surface: the declaration builder, every validator, the resource-server extension, and the
 * buyer-side catalog client.
 *
 * **Why this module had to exist before `@movoframework/bazaar` did.** D3 says Movo derives and
 * escalates but never implements a Bazaar validator, and `packages/bazaar` may not import
 * `@x402/*`. Those two rules together leave exactly one lawful path to the upstream validators,
 * and it runs through here. Without this file the only way to make `packages/bazaar` compile is
 * to write a parallel validator — which is precisely what the discarded M4 WIP did, in four
 * files, after its imports failed to resolve (Spec Amendment 007 §4).
 *
 * **Why a separate module rather than more exports on `./index.ts`.** The same reason
 * `./server.ts` is separate (amendment 004 §3): `@x402/extensions` pulls `ajv`, `viem` and a
 * signing stack that a project doing no discovery has no reason to load. Splitting it keeps
 * `@movoframework/core`'s main entry the pure, network-free config and compiler layer it claims
 * to be, and makes reaching for discovery an explicit act.
 *
 * **What is deliberately not re-exported.** The `V1` extraction helpers
 * (`extractDiscoveryInfoV1`, `isDiscoverableV1`, `extractResourceMetadataV1`) belong to the
 * pre-extension discovery format Movo does not emit, and `validateAndExtract` bundles two
 * operations Movo wants separately. Adding a re-export later is a one-line change; removing one
 * is a breaking change, so the waist starts narrow.
 */

// ─── Declaration ─────────────────────────────────────────────────────────────────────────
//
// One function, not two. Spec §22 names `declareMcpDiscoveryExtension` alongside
// `declareDiscoveryExtension`; the installed package exports only the latter, which dispatches
// on whether `toolName` is present in its input (amendment 007 §3.1). Verified against
// `@x402/extensions` 2.21.0 declarations, and asserted by `upstream-conformance.test.ts`.

export type {
  DeclareBodyDiscoveryExtensionConfig,
  DeclareDiscoveryExtensionInput,
  DeclareMcpDiscoveryExtensionConfig,
  DeclareQueryDiscoveryExtensionConfig,
  DiscoveryExtension,
  DiscoveryInfo,
} from "@x402/extensions/bazaar";
export { declareDiscoveryExtension } from "@x402/extensions/bazaar";

// ─── Validators — every one of them upstream's ───────────────────────────────────────────
//
// D3 in a single export block. `isValidIconUrl` is the SSRF check, `validateRouteTemplate`
// rejects percent-encoded traversal, `sanitizeTags` enforces the count and character rules,
// `sanitizeResourceServiceMetadata` drops invalid service metadata. Movo re-implements none of
// them; it calls these and escalates what they report.
//
// If you are about to write a validator in `packages/bazaar`, check this list first. If the
// rule you need genuinely is not here, that is an upstream contribution and a shim marked for
// deletion — not a Movo-owned validator (spec §22, amendment 007 §5).

export type {
  SanitizedResourceServiceMetadata,
  ValidationResult,
} from "@x402/extensions/bazaar";
export {
  isValidIconUrl,
  isValidRouteTemplate,
  isValidServiceName,
  sanitizeResourceServiceMetadata,
  sanitizeTags,
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
  validateRouteTemplate,
} from "@x402/extensions/bazaar";

// ─── Type guards for the declaration union ───────────────────────────────────────────────

export {
  isBodyExtensionConfig,
  isMcpExtensionConfig,
  isQueryExtensionConfig,
} from "@x402/extensions/bazaar";

// ─── The resource-server extension, and the decision to install it ───────────────────────
//
// `checkIfBazaarNeeded` exists upstream for exactly the question `@movoframework/server` has to
// answer: does any route declare discovery? Movo does not re-derive that from its own compiled
// state.

export {
  BAZAAR,
  bazaarResourceServerExtension,
  checkIfBazaarNeeded,
} from "@x402/extensions/bazaar";

// ─── Buyer-side catalog queries ──────────────────────────────────────────────────────────
//
// `withBazaar` wraps an `HTTPFacilitatorClient` and adds `extensions.bazaar.listResources` and
// `.search`. `queryCatalog` in `@movoframework/bazaar` is a thin composition over this — the
// catalog lives at the facilitator, and Movo neither caches nor re-shapes what it returns.

export type {
  BazaarClientExtension,
  DiscoveredHTTPResource,
  DiscoveredMCPResource,
  DiscoveredResource,
  DiscoveryResource,
  DiscoveryResourcesResponse,
  ListDiscoveryResourcesParams,
  SearchDiscoveryResourcesParams,
  SearchDiscoveryResourcesResponse,
} from "@x402/extensions/bazaar";
export { withBazaar } from "@x402/extensions/bazaar";

// ─── Extraction, for reading back what was declared ──────────────────────────────────────

export {
  extractDiscoveryInfo,
  extractDiscoveryInfoFromExtension,
} from "@x402/extensions/bazaar";
