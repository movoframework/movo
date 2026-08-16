/**
 * Automatic cataloging at settle time.
 *
 * A seller does nothing to be listed. They declare discovery metadata on their resource, a
 * buyer pays and echoes the declaration, and the facilitator that settled the payment
 * catalogues it. There is no registration endpoint, no API key, no second step — §28's
 * objective is that a developer completes the quickstart, gets paid once, and is findable, and
 * anything requiring the seller to act after payment gets skipped by exactly the developers the
 * catalog exists to serve.
 *
 * ## The §B.1 non-custody reading, and why ingest is where it would go wrong
 *
 * §B.1 is binding here and the trap is specific. **The owner of a listing is
 * `paymentRequirements.payTo` — the payTo of the requirements that settled — and never anything
 * read off the settled transaction.**
 *
 * If ingest instead derived ownership from the settled transaction, it would find the
 * *facilitator's* address as the transaction source on every single settlement, because fee
 * sponsorship makes the facilitator the source. Under the old four-position literal that reads
 * as a non-custody violation, and ingest would refuse every listing it was handed — a false
 * failure on the happy path. Under the corrected two-part invariant, facilitator-as-fee-payer
 * is the service being provided and carries no ownership meaning at all.
 *
 * The other half of §B.1 matters too, and it is already satisfied upstream rather than here:
 * the buyer-signed transaction is clean of all four positions, which is what makes
 * `requirements.payTo` trustworthy in the first place — the buyer authorised a transfer to that
 * address and the facilitator could not redirect it. `ExactStellarScheme` enforces that during
 * verify (`invalid_exact_stellar_payload_event_wrong_to`,
 * `..._facilitator_in_auth`, `..._unsafe_tx_or_op_source`), so by the time a settlement succeeds
 * the address in the requirements is the address the money actually went to. Ingest does not
 * re-derive that, and must not: re-deriving it is how the false failure gets reintroduced.
 *
 * ## What ingest refuses
 *
 * Only successful settlements are catalogued. A failed settle produces no listing — otherwise
 * the catalog is writable by anyone willing to send a payload that fails, which is free.
 */

import { createHash } from "node:crypto";
import type { Network, PaymentPayload, PaymentRequirements } from "@movoframework/core";
import { type DiscoveredResource, extractDiscoveryInfo } from "@movoframework/core/bazaar";
import {
  checkDeclaration,
  checkFieldSizes,
  checkOwnership,
  checkPayToNotForged,
  checkRouteTemplate,
  checkSchemaRefs,
  checkServiceMetadata,
  DEFAULT_FIELD_CAPS,
  type FieldCaps,
  type IntegrityRefusal,
} from "./integrity.js";
import { INGEST_REASONS } from "./reasons.js";
import type { CatalogListing, CatalogStore, IngestContext, IngestOutcome } from "./types.js";

/** Knobs an operator can turn without a release. */
export interface IngestOptions {
  readonly caps?: FieldCaps;
  /**
   * Minimum settled amount, in atomic units, before a settlement counts toward activity.
   *
   * Below it the listing is still created and updated — the endpoint is real and belongs in the
   * catalog — but `settlementCount` does not move. That number feeds ranking, and without a
   * floor a seller buys apparent traffic at one stroop a time (§7.3, activity inflation).
   */
  readonly dustThresholdAtomic?: bigint;
  /** Injectable clock, so ordering and recency are testable. */
  readonly now?: () => Date;
}

/** Default dust threshold: 1000 atomic units — $0.0001 at USDC's 7 decimals. */
export const DEFAULT_DUST_THRESHOLD_ATOMIC = 1_000n;

function rejected(refusal: IntegrityRefusal): IngestOutcome {
  return {
    status: "rejected",
    rejectedReason: refusal.reason,
    message: refusal.detail,
  };
}

/**
 * Derive a listing's deduplication key.
 *
 * HTTP collapses on `routeTemplate`; MCP keys on the `(resource.url, toolName)` tuple. Both are
 * hashed into a stable printable id so a key containing a slash, a colon or a brace cannot
 * collide with the store's own separators.
 *
 * @param type - Resource type
 * @param primary - `routeTemplate` for HTTP, `resource.url` for MCP
 * @param toolName - MCP only
 * @returns A stable key
 */
export function listingKey(type: "http" | "mcp", primary: string, toolName?: string): string {
  const raw =
    type === "mcp" ? `mcp\u0000${primary}\u0000${toolName ?? ""}` : `http\u0000${primary}`;
  // A short, stable, printable digest. Not a security boundary — ownership is — so a fast
  // non-cryptographic hash would do; sha256 is used because it is in the standard library and
  // removes any question about collisions at catalog scale.
  return `${type}_${sha256Hex(raw).slice(0, 40)}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Catalogue one settled payment.
 *
 * @param context - The payload, the requirements that settled, and the settle response
 * @param store - Where the listing lands
 * @param options - Caps, dust threshold and clock
 * @returns What to report in `EXTENSION-RESPONSES`
 */
export async function ingestSettlement(
  context: IngestContext,
  store: CatalogStore,
  options: IngestOptions = {},
): Promise<IngestOutcome> {
  const caps = options.caps ?? DEFAULT_FIELD_CAPS;
  const now = (options.now ?? (() => new Date()))().toISOString();

  if (!context.settleResponse.success) {
    return {
      status: "rejected",
      rejectedReason: INGEST_REASONS.settlementUnsuccessful,
      message: "only a successful settlement creates or updates a listing",
    };
  }

  // ── The raw declaration, inspected BEFORE upstream is asked to extract ──────────────────
  //
  // Order matters here and it is not obvious. Upstream's `extractDiscoveryInfo` applies
  // **soft-drop** semantics: an invalid `routeTemplate` is silently discarded and the listing
  // falls back to the concrete pathname, and an invalid `iconUrl` is silently dropped by
  // `sanitizeResourceServiceMetadata`. That is correct behaviour for a facilitator that should
  // catalogue as much as it safely can — but it means the attacker's value is *gone* by the
  // time extraction returns.
  //
  // A control that inspected only upstream's output would therefore report success on the
  // traversal and loopback-icon attacks, having quietly catalogued a listing under a different
  // key than the attacker asked for. AC7.5 requires those to fail *closed*, with a reason. So
  // the raw values are read from the payload first, escalated here, and only then is upstream
  // asked to extract — the same escalate-don't-reimplement shape `validateDiscoveryStrict` uses
  // on the seller side, applied to the facilitator side.
  const payload = context.paymentPayload as {
    extensions?: Record<string, unknown>;
    resource?: { url?: string; description?: string; mimeType?: string; iconUrl?: string };
    accepted?: { payTo?: string };
  };

  const bazaarExtension = payload.extensions?.["bazaar"];
  if (bazaarExtension === undefined || typeof bazaarExtension !== "object") {
    return {
      status: "rejected",
      rejectedReason: INGEST_REASONS.notDiscoverable,
      message: "the payment payload carried no bazaar discovery extension",
    };
  }

  // `$ref` first, and the order is load-bearing in two ways.
  //
  // Security: `validateDiscoveryExtension` resolves the declared schema in order to validate
  // `info` against it. Handing it a schema carrying `$ref: "https://evil.example.com/…"` asks a
  // validator to dereference an attacker-supplied URL from the settle path. The reference check
  // is the control that exists to prevent exactly that, so it must run before the validator, not
  // after it.
  //
  // Diagnostics: with the checks the other way round, the external-`$ref` attack came back as
  // `listing_info_invalid` — the validator failed to resolve the remote reference and reported
  // that generic reason — so AC7.5's six *distinct* reasons held when the controls were called
  // directly and quietly collapsed to five on the path a real settlement takes. Found by running
  // the adversarial cases through `ingestSettlement` rather than through the control functions.
  const refs = checkSchemaRefs((bazaarExtension as { schema?: unknown }).schema);
  if (!refs.ok) return rejected(refs.refusal);

  const declaration = checkDeclaration(bazaarExtension);
  if (!declaration.ok) return rejected(declaration.refusal);

  // Escalate the two soft-drops, on the raw values, before extraction consumes them.
  const rawTemplate = (bazaarExtension as { routeTemplate?: unknown }).routeTemplate;
  let checkedTemplate: string | undefined;
  if (typeof rawTemplate === "string" && rawTemplate !== "") {
    const checked = checkRouteTemplate(rawTemplate);
    if (!checked.ok) return rejected(checked.refusal);
    checkedTemplate = checked.value;
  }

  const metadata = checkServiceMetadata(payload.resource);
  if (!metadata.ok) return rejected(metadata.refusal);

  // Now extraction, which is guaranteed to succeed for a declaration that passed the checks
  // above. Extraction is upstream's — Movo does not parse the extension by hand — and it is
  // what produces the canonical resource URL (origin + routeTemplate).
  const discovered: DiscoveredResource | null = extractDiscoveryInfo(
    context.paymentPayload as PaymentPayload,
    context.paymentRequirements,
    true,
  );

  if (discovered === null) {
    return {
      status: "rejected",
      rejectedReason: INGEST_REASONS.notDiscoverable,
      message: "upstream extraction produced no discoverable resource",
    };
  }

  // ── Ownership: from the settled requirements, never from the settled transaction (§B.1) ──
  const settledPayTo = context.paymentRequirements.payTo;
  const echoedPayTo = payload.accepted?.payTo;

  const notForged = checkPayToNotForged(settledPayTo, echoedPayTo);
  if (!notForged.ok) return rejected(notForged.refusal);

  const isMcp = "toolName" in discovered && typeof discovered.toolName === "string";
  const type = isMcp ? "mcp" : "http";
  const toolName = isMcp ? (discovered as { toolName: string }).toolName : undefined;

  // For HTTP, the key is the checked template when one was declared, and the canonical resource
  // URL otherwise. An absent routeTemplate means the seller declared none; the consequence —
  // one listing per concrete path rather than one per endpoint — is documented in
  // running-a-catalog.md as the reason to declare one.
  const routeTemplate = isMcp
    ? undefined
    : (checkedTemplate ?? new URL(discovered.resourceUrl).pathname);

  const sizes = checkFieldSizes(
    {
      resource: discovered.resourceUrl,
      ...(discovered.description === undefined ? {} : { description: discovered.description }),
      ...(metadata.value.serviceName === undefined
        ? {}
        : { serviceName: metadata.value.serviceName }),
      ...(metadata.value.tags === undefined ? {} : { tags: metadata.value.tags }),
      ...(metadata.value.iconUrl === undefined ? {} : { iconUrl: metadata.value.iconUrl }),
      ...(routeTemplate === undefined ? {} : { routeTemplate }),
      ...(toolName === undefined ? {} : { toolName }),
      ...(discovered.extensions === undefined ? {} : { extensions: discovered.extensions }),
    },
    caps,
  );
  if (!sizes.ok) return rejected(sizes.refusal);

  const id = listingKey(
    type,
    type === "mcp" ? discovered.resourceUrl : (routeTemplate as string),
    toolName,
  );

  const existing = await store.get(id);
  const ownership = checkOwnership(settledPayTo, existing?.payTo);
  if (!ownership.ok) return rejected(ownership.refusal);

  const dustThreshold = options.dustThresholdAtomic ?? DEFAULT_DUST_THRESHOLD_ATOMIC;
  const counts = settlementCounts(context.paymentRequirements, dustThreshold, existing);

  const listing: CatalogListing = {
    id,
    type,
    resource: discovered.resourceUrl,
    ...(routeTemplate === undefined ? {} : { routeTemplate }),
    ...(toolName === undefined ? {} : { toolName }),
    ...((discovered as { method?: string }).method === undefined
      ? {}
      : { method: (discovered as { method?: string }).method as string }),
    payTo: ownership.value,
    network: context.paymentRequirements.network as Network,
    scheme: context.paymentRequirements.scheme,
    x402Version: discovered.x402Version,
    accepts: [context.paymentRequirements],
    ...(discovered.description === undefined ? {} : { description: discovered.description }),
    ...(discovered.mimeType === undefined ? {} : { mimeType: discovered.mimeType }),
    ...(metadata.value.serviceName === undefined
      ? {}
      : { serviceName: metadata.value.serviceName }),
    ...(metadata.value.tags === undefined ? {} : { tags: metadata.value.tags }),
    ...(metadata.value.iconUrl === undefined ? {} : { iconUrl: metadata.value.iconUrl }),
    ...(discovered.extensions === undefined ? {} : { extensions: discovered.extensions }),
    firstSeen: existing?.firstSeen ?? now,
    lastUpdated: now,
    settlementCount: counts.settlementCount,
    failureCount: existing?.failureCount ?? 0,
  };

  // The store performs the owner comparison and the write in one transaction. The `checkOwnership`
  // above is the fast path and the source of the readable reason; this is the one that actually
  // holds under concurrency (§B.2 — read-then-write is where the race lives).
  const written = await store.upsert(listing);
  if (written.outcome === "ownerMismatch") {
    return rejected({
      reason: INGEST_REASONS.ownerMismatch,
      detail: `listing is owned by ${written.owner}; settled payTo was ${settledPayTo}`,
    });
  }

  return { status: "success", id };
}

function settlementCounts(
  requirements: PaymentRequirements,
  dustThreshold: bigint,
  existing: CatalogListing | undefined,
): { settlementCount: number } {
  const previous = existing?.settlementCount ?? 0;
  let amount: bigint;
  try {
    amount = BigInt((requirements as { amount?: string }).amount ?? "0");
  } catch {
    amount = 0n;
  }
  return { settlementCount: amount >= dustThreshold ? previous + 1 : previous };
}
