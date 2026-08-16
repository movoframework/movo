/**
 * The catalog trust boundary.
 *
 * **Why every field here is hostile.** A buyer's payment payload echoes the seller's `resource`
 * block back to the facilitator, and the facilitator catalogues what arrives. So every field
 * that reaches ingest passed through a client Movo does not control, sent by a party with a
 * motive: to outrank a competitor, to overwrite their listing, to make the catalog fetch a URL
 * on the attacker's behalf, or simply to fill the disk. §7.3 lists the controls; this file is
 * them.
 *
 * **Movo implements no validator here — and that is the load-bearing sentence.** The M4 WIP was
 * discarded for writing four parallel validators after its imports failed to resolve
 * (§A, ex-amendment 007 §4). Every rule below is enforced by calling upstream:
 * `isValidRouteTemplate`, `isValidIconUrl`, `sanitizeResourceServiceMetadata`,
 * `validateDiscoveryExtension`, `validateDiscoveryExtensionSpec`. Movo's contribution is
 * (a) deciding *which* control refused so the reason is distinct, and (b) the two checks
 * upstream cannot make because they depend on state upstream never sees — ownership, and size
 * caps against this deployment's configuration.
 *
 * **Ownership is the one control that cannot be delegated.** Upstream validates a *declaration*;
 * it has no idea which address settled, and no idea what this catalog already stores. Binding a
 * listing to the payTo that actually settled is therefore Movo's, and it is the control that
 * stops one seller overwriting another's listing.
 */

import type { SanitizedResourceServiceMetadata } from "@movoframework/core/bazaar";
import {
  isValidIconUrl,
  isValidRouteTemplate,
  sanitizeResourceServiceMetadata,
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
} from "@movoframework/core/bazaar";
import { INGEST_REASONS, type IngestReason } from "./reasons.js";

/** Size caps. Deliberately generous — a cap that trips on real data trains people to raise it. */
export interface FieldCaps {
  readonly resourceUrl: number;
  readonly description: number;
  readonly serviceName: number;
  readonly tag: number;
  readonly tagCount: number;
  readonly iconUrl: number;
  readonly routeTemplate: number;
  readonly toolName: number;
  /** Serialised size of the whole echoed extensions block. */
  readonly extensionsBytes: number;
}

/** The defaults, applied when an operator configures nothing. */
export const DEFAULT_FIELD_CAPS: FieldCaps = {
  resourceUrl: 2_048,
  description: 4_096,
  serviceName: 128,
  tag: 64,
  tagCount: 16,
  iconUrl: 2_048,
  routeTemplate: 1_024,
  toolName: 256,
  extensionsBytes: 64 * 1024,
};

/** A refusal from one of the controls. */
export interface IntegrityRefusal {
  readonly reason: IngestReason;
  readonly detail: string;
}

/** Either the value passed, or the control that refused it. */
export type IntegrityResult<T> = { ok: true; value: T } | { ok: false; refusal: IntegrityRefusal };

function refuse(reason: IngestReason, detail: string): IntegrityResult<never> {
  return { ok: false, refusal: { reason, detail } };
}

/**
 * Control 1 — **listing ownership**.
 *
 * Binds a listing to the address that settled, and refuses any update from a different one.
 * `settledPayTo` must come from the *requirements that settled*, never from the buyer-echoed
 * resource block; passing the echoed value here would defeat the whole control.
 *
 * @param settledPayTo - The payTo from the settled requirements
 * @param storedOwner - The current owner, or undefined for a new listing
 * @returns The owner to store, or a refusal
 */
export function checkOwnership(
  settledPayTo: string,
  storedOwner: string | undefined,
): IntegrityResult<string> {
  if (storedOwner !== undefined && storedOwner !== settledPayTo) {
    return refuse(
      INGEST_REASONS.ownerMismatch,
      `listing is owned by ${storedOwner}; settled payTo was ${settledPayTo}`,
    );
  }
  return { ok: true, value: settledPayTo };
}

/**
 * Control 2 — **payTo forgery**.
 *
 * The echoed resource block may carry a `payTo`. If it disagrees with the address that actually
 * settled, the payload is asserting something the ledger contradicts, and the listing is
 * refused rather than silently corrected. Silently preferring the settled value would let an
 * attacker probe which fields are trusted.
 *
 * @param settledPayTo - The payTo from the settled requirements
 * @param echoedPayTo - The payTo carried in the payload's accepted block, if any
 * @returns Unit on success, or a refusal
 */
export function checkPayToNotForged(
  settledPayTo: string,
  echoedPayTo: string | undefined,
): IntegrityResult<true> {
  if (echoedPayTo !== undefined && echoedPayTo !== settledPayTo) {
    return refuse(
      INGEST_REASONS.payToForged,
      `payload claimed payTo ${echoedPayTo}; the settlement paid ${settledPayTo}`,
    );
  }
  return { ok: true, value: true };
}

/**
 * Control 3 — **path traversal in `routeTemplate`**, checked after percent-decoding.
 *
 * **Decode order is the entire vulnerability.** `%2e%2e%2f` is not `../` to a naive check, but
 * it is `../` to anything that decodes before comparing — a router, a filesystem, a proxy. A
 * traversal check that runs before decoding passes the encoded form straight through, which is
 * why §7.3 names the decode order explicitly and why this function decodes first and delegates
 * second.
 *
 * The rule itself is upstream's. Movo decodes, then asks upstream, then asks upstream again
 * about the raw form — because a template that is only valid in one of the two forms is a
 * template that means different things to different hops.
 *
 * **Upstream difference worth recording:** §7.3 names `validateRouteTemplate`, but the installed
 * `@x402/extensions` marks that function `@deprecated` and directs callers to
 * `isValidRouteTemplate`, a type predicate returning `value is string` rather than a
 * `{valid, errors}` result. This uses the non-deprecated one; the spec text is a version behind.
 *
 * @param routeTemplate - The raw template as echoed
 * @returns The template to store, or a refusal
 */
export function checkRouteTemplate(routeTemplate: string): IntegrityResult<string> {
  let decoded = routeTemplate;
  // Repeated decoding, because %252e%252e decodes to %2e%2e and only then to `..`. A single
  // pass leaves double-encoded traversal intact.
  for (let pass = 0; pass < 3; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      // A malformed escape cannot be decoded, so it cannot be reasoned about. Refuse rather
      // than store something whose meaning depends on which hop decodes it.
      return refuse(
        INGEST_REASONS.routeTemplateInvalid,
        "routeTemplate contains a malformed percent-escape",
      );
    }
    if (next === decoded) break;
    decoded = next;
  }

  for (const candidate of [decoded, routeTemplate]) {
    if (!isValidRouteTemplate(candidate)) {
      return refuse(
        INGEST_REASONS.routeTemplateInvalid,
        "routeTemplate rejected by upstream isValidRouteTemplate",
      );
    }
  }

  // Store the decoded form, so two payloads that differ only in encoding collapse to one
  // listing rather than two.
  return { ok: true, value: decoded };
}

/**
 * Control 4 — **service metadata**, including the `iconUrl` SSRF check.
 *
 * `sanitizeResourceServiceMetadata` is upstream's soft-drop: it returns only the fields that
 * survive and silently discards the rest, which is correct for a facilitator that should
 * catalogue as much as it safely can.
 *
 * Movo escalates exactly one of those drops. A **present but invalid** `iconUrl` is refused
 * outright rather than dropped, because a loopback or internal-host icon URL is not a typo — it
 * is an attempt to make every client that renders the catalog fetch an address inside someone
 * else's network. Soft-dropping it catalogues the listing and tells nobody. `isValidIconUrl` is
 * upstream's check; the decision to escalate is Movo's, and it is the same escalate-don't-
 * reimplement pattern `validateDiscoveryStrict` uses on the seller side.
 *
 * @param resource - The echoed resource block
 * @returns The surviving metadata, or a refusal
 */
export function checkServiceMetadata(
  resource: { url?: string; description?: string; mimeType?: string; iconUrl?: string } | undefined,
): IntegrityResult<SanitizedResourceServiceMetadata> {
  const declaredIcon = resource?.iconUrl;
  if (declaredIcon !== undefined && declaredIcon !== "" && !isValidIconUrl(declaredIcon)) {
    return refuse(
      INGEST_REASONS.iconUrlInvalid,
      "iconUrl is not an absolute http(s) URL to an external host",
    );
  }

  return {
    ok: true,
    value: sanitizeResourceServiceMetadata(
      (resource ?? undefined) as Parameters<typeof sanitizeResourceServiceMetadata>[0],
    ),
  };
}

/**
 * Control 5 — **schema reference injection**.
 *
 * A declared JSON Schema may carry `$ref` and `$id`. Anything that is not a same-document
 * pointer fragment turns every consumer that resolves the schema into a fetcher of an
 * attacker-chosen URL — a validator, a code generator, an IDE, an agent. `#/definitions/Foo` is
 * fine; `https://evil.test/schema.json` and `file:///etc/passwd` are not, and neither is a
 * relative path.
 *
 * Walked recursively because a `$ref` nested six levels down is still a `$ref`.
 *
 * @param schema - The declared schema, or any nested value
 * @returns Unit on success, or a refusal naming the offending pointer
 */
export function checkSchemaRefs(schema: unknown): IntegrityResult<true> {
  const seen = new Set<unknown>();

  function walk(node: unknown, path: string): IntegrityRefusal | undefined {
    if (node === null || typeof node !== "object") return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        const refusal = walk(item, `${path}[${String(index)}]`);
        if (refusal !== undefined) return refusal;
      }
      return undefined;
    }

    const record = node as { [key: string]: unknown };
    for (const key of ["$ref", "$id", "$schema", "$anchor", "$dynamicRef"]) {
      const value = record[key];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        return {
          reason: INGEST_REASONS.schemaRefExternal,
          detail: `${path}.${key} is not a string`,
        };
      }
      // `$schema` legitimately names the dialect by absolute URL, so it is the one exception,
      // and it is pinned to the dialect upstream's declaration builder emits.
      if (key === "$schema") {
        if (!value.startsWith("https://json-schema.org/")) {
          return {
            reason: INGEST_REASONS.schemaRefExternal,
            detail: `${path}.$schema names a non-standard dialect: ${value}`,
          };
        }
        continue;
      }
      if (!value.startsWith("#")) {
        return {
          reason: INGEST_REASONS.schemaRefExternal,
          detail: `${path}.${key} is not a same-document fragment: ${value}`,
        };
      }
    }

    for (const [key, value] of Object.entries(record)) {
      const refusal = walk(value, `${path}.${key}`);
      if (refusal !== undefined) return refusal;
    }
    return undefined;
  }

  const refusal = walk(schema, "$");
  return refusal === undefined ? { ok: true, value: true } : { ok: false, refusal };
}

/**
 * Control 6 — **size caps**.
 *
 * Resource exhaustion is the least interesting attack and the easiest to land: nothing in the
 * protocol bounds a description, and a catalog that stores what it is given will store a
 * megabyte of it per settlement.
 *
 * @param fields - The candidate values
 * @param caps - The configured caps
 * @returns Unit on success, or a refusal naming the field
 */
export function checkFieldSizes(
  fields: {
    readonly resource?: string;
    readonly description?: string;
    readonly serviceName?: string;
    readonly tags?: readonly string[];
    readonly iconUrl?: string;
    readonly routeTemplate?: string;
    readonly toolName?: string;
    readonly extensions?: unknown;
  },
  caps: FieldCaps = DEFAULT_FIELD_CAPS,
): IntegrityResult<true> {
  const scalars: readonly (readonly [string, string | undefined, number])[] = [
    ["resource", fields.resource, caps.resourceUrl],
    ["description", fields.description, caps.description],
    ["serviceName", fields.serviceName, caps.serviceName],
    ["iconUrl", fields.iconUrl, caps.iconUrl],
    ["routeTemplate", fields.routeTemplate, caps.routeTemplate],
    ["toolName", fields.toolName, caps.toolName],
  ];

  for (const [name, value, cap] of scalars) {
    if (value !== undefined && value.length > cap) {
      return refuse(
        INGEST_REASONS.fieldTooLarge,
        `${name} is ${String(value.length)} characters; the cap is ${String(cap)}`,
      );
    }
  }

  if (fields.tags !== undefined) {
    if (fields.tags.length > caps.tagCount) {
      return refuse(
        INGEST_REASONS.fieldTooLarge,
        `${String(fields.tags.length)} tags supplied; the cap is ${String(caps.tagCount)}`,
      );
    }
    for (const tag of fields.tags) {
      if (tag.length > caps.tag) {
        return refuse(
          INGEST_REASONS.fieldTooLarge,
          `a tag is ${String(tag.length)} characters; the cap is ${String(caps.tag)}`,
        );
      }
    }
  }

  if (fields.extensions !== undefined) {
    let serialised: string;
    try {
      serialised = JSON.stringify(fields.extensions) ?? "";
    } catch {
      return refuse(INGEST_REASONS.fieldTooLarge, "extensions could not be serialised");
    }
    if (serialised.length > caps.extensionsBytes) {
      return refuse(
        INGEST_REASONS.fieldTooLarge,
        `extensions serialise to ${String(serialised.length)} bytes; the cap is ${String(caps.extensionsBytes)}`,
      );
    }
  }

  return { ok: true, value: true };
}

/**
 * Upstream's two declaration checks, run together and reported apart.
 *
 * `validateDiscoveryExtension` checks `info` against the seller's own `schema`;
 * `validateDiscoveryExtensionSpec` checks the declaration against the Bazaar protocol. They
 * fail for different reasons and an operator wants to know which, so they get distinct reasons
 * rather than a shared "invalid".
 *
 * Both **consume upstream's `{valid, errors}` return** rather than wrapping the call in a
 * try/catch — upstream does not throw, and a discarded return is a no-op wearing a delegation
 * costume (§A.2 rule 5).
 *
 * @param extension - The echoed discovery extension
 * @returns Unit on success, or a refusal
 */
export function checkDeclaration(extension: unknown): IntegrityResult<true> {
  const spec = validateDiscoveryExtensionSpec(extension as Record<string, unknown>);
  if (!spec.valid) {
    return refuse(
      INGEST_REASONS.specInvalid,
      `declaration violates the Bazaar specification: ${(spec.errors ?? []).join("; ")}`,
    );
  }

  const info = validateDiscoveryExtension(
    extension as Parameters<typeof validateDiscoveryExtension>[0],
  );
  if (!info.valid) {
    return refuse(
      INGEST_REASONS.infoInvalid,
      `info does not validate against its declared schema: ${(info.errors ?? []).join("; ")}`,
    );
  }

  return { ok: true, value: true };
}
