/**
 * `readCatalogOutcome` — interpreting `EXTENSION-RESPONSES`, including the absence of it.
 *
 * **`unknown` is the load-bearing value in this file.** The Bazaar specification says a
 * facilitator *may* return this header, and its absence carries **no signal**. At least one
 * major facilitator does not emit it at all. So a decoder that reported absence as failure
 * would teach every Movo developer a false negative: they would go looking for a cataloging
 * problem that does not exist, and eventually stop trusting the signal entirely.
 *
 * Four states, and the two that get confused are worth separating explicitly:
 *
 * | State | Means |
 * |---|---|
 * | `success` | Catalogued |
 * | `processing` | **Accepted**, indexing later — not a failure |
 * | `rejected` | The facilitator declined, with a reason when it gave one |
 * | `unknown` | No signal: header absent, malformed, or carrying no bazaar entry |
 *
 * `processing` is the other easy mistake. It means accepted-and-indexing-later, and treating it
 * as a failure would report a working integration as broken.
 *
 * **Why this exists in Movo at all.** `@x402/core` has an internal `logExtensionResponsesHeader`
 * but exports no public decoder — verified against the installed package and asserted by
 * `upstream-conformance.test.ts`, which fails if upstream ever ships one. This is a genuine
 * upstream gap and a candidate contribution (amendment 007 §3.2). The wire format — base64 JSON
 * keyed by extension key, fields `status` and `rejectedReason` — was read from upstream's source
 * rather than guessed.
 */

import { BAZAAR } from "@movoframework/core/bazaar";

/** What the facilitator said about cataloging, including saying nothing. */
export type CatalogOutcome =
  | { readonly status: "success" }
  | { readonly status: "processing" }
  | { readonly status: "rejected"; readonly rejectedReason?: string }
  | { readonly status: "unknown"; readonly reason: UnknownReason };

/**
 * Why an outcome is unknown.
 *
 * Carried because the three causes want different responses from a developer — an absent header
 * is normal and needs no action, while a malformed one is worth investigating — and because
 * collapsing them was one of the defects in the discarded WIP.
 */
export type UnknownReason =
  /** No header at all. Normal: the specification makes it optional. */
  | "absent"
  /** Present but not decodable as base64 JSON. */
  | "malformed"
  /** Decoded, but carried no entry for the bazaar extension. */
  | "no-bazaar-entry";

/**
 * Decode base64 without `Buffer`, so the decoder runs anywhere the client does.
 *
 * @param value - Base64 text
 * @returns The decoded UTF-8 string, or undefined when the input is not valid base64
 */
function decodeBase64(value: string): string | undefined {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Interpret the `EXTENSION-RESPONSES` header.
 *
 * Never throws and never returns undefined: every input maps to one of the four states, so a
 * caller cannot accidentally treat "no signal" as falsy and branch into a failure path.
 *
 * @param headerValue - The raw header value, or undefined when the response carried none
 * @returns What the facilitator said about cataloging
 */
export function readCatalogOutcome(headerValue: string | undefined | null): CatalogOutcome {
  if (headerValue === undefined || headerValue === null || headerValue.length === 0) {
    return { status: "unknown", reason: "absent" };
  }

  const decoded = decodeBase64(headerValue);
  if (decoded === undefined) return { status: "unknown", reason: "malformed" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return { status: "unknown", reason: "malformed" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: "unknown", reason: "malformed" };
  }

  // `BAZAAR` is upstream's own extension descriptor, `{ key: "bazaar" }`. Reading the key off it
  // rather than writing the string keeps the lookup single-sourced: if upstream ever renames
  // the extension, this follows it instead of silently finding nothing.
  const entry = (parsed as Record<string, unknown>)[BAZAAR.key];
  if (typeof entry !== "object" || entry === null) {
    return { status: "unknown", reason: "no-bazaar-entry" };
  }

  const status = (entry as Record<string, unknown>)["status"];

  if (status === "success") return { status: "success" };
  if (status === "processing") return { status: "processing" };
  if (status === "rejected") {
    const reason = (entry as Record<string, unknown>)["rejectedReason"];
    return typeof reason === "string"
      ? { status: "rejected", rejectedReason: reason }
      : { status: "rejected" };
  }

  // A status Movo does not recognise is not a rejection. A facilitator may add states, and
  // guessing that an unfamiliar one means failure is the same mistake as treating absence as
  // failure.
  return { status: "unknown", reason: "no-bazaar-entry" };
}

/**
 * Whether an outcome should be treated as a cataloging failure.
 *
 * Exactly one of the four states qualifies. Exposed as a function rather than left to callers
 * because `outcome.status !== "success"` is the natural thing to write and is wrong three ways.
 *
 * @param outcome - The outcome to classify
 * @returns `true` only for an explicit rejection
 */
export function isCatalogRejection(
  outcome: CatalogOutcome,
): outcome is { status: "rejected"; rejectedReason?: string } {
  return outcome.status === "rejected";
}
