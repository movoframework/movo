/**
 * The one result shape every Bazaar tool returns.
 *
 * ## Why a result union rather than thrown errors
 *
 * An MCP tool call crossing a transport can fail in two very different ways: the *call* failed
 * (bad JSON, server gone) or the *thing the agent asked for* failed (over budget, not in the
 * catalog). Collapsing the second into the first — by throwing, which the SDK renders as
 * `isError: true` with a prose message — hands the agent a paragraph to parse at exactly the
 * moment it needs to branch. §25.12 is explicit about this: machine-readable error codes with a
 * **non-null reason on every rejection**, so an agent can reason about failure rather than
 * parsing prose.
 *
 * So every tool returns `{ ok: true, … }` or `{ ok: false, code, reason, … }`, always as
 * `structuredContent`, and the transport-level error channel is reserved for transport-level
 * errors.
 *
 * ## Non-null reason, enforced rather than asserted
 *
 * `reason` is a required, non-optional `string` on the rejection branch, so a rejection without
 * one does not typecheck. That is deliberately stronger than a test: `reasons.test.ts` in the
 * catalog package can only check the rejections someone remembered to write a test for, whereas
 * a required field checks every one that will ever be written. `rejection()` additionally
 * refuses an empty string at runtime, because `""` typechecks and tells an agent nothing.
 *
 * ## Determinism
 *
 * §25.12 also asks for deterministic outputs. Nothing here embeds a timestamp, a duration, a
 * random id or a host name. Two identical calls against an unchanged catalog produce
 * byte-identical structured content, which is what lets an agent cache, diff and replay them.
 */

import { type MovoErrorCode, registryEntry } from "@movoframework/core";

/** A machine-readable rejection from a Bazaar tool. */
export interface ToolRejection {
  readonly ok: false;
  /** A code from the single Movo registry. Stable, documented, and safe to branch on. */
  readonly code: MovoErrorCode;
  /** Why this specific call was rejected. Never null, never empty. */
  readonly reason: string;
  /** What to do about it, taken verbatim from the registry so the two cannot drift. */
  readonly fix: string;
}

/** A successful tool result, carrying the tool's own payload. */
export type ToolSuccess<T> = { readonly ok: true } & T;

/** What every Bazaar tool returns. */
export type ToolResult<T> = ToolSuccess<T> | ToolRejection;

/**
 * Build a rejection.
 *
 * @param code - A registry code
 * @param reason - Why this call was rejected; must be a non-empty string
 * @returns The rejection, with the registry's fix text attached
 * @throws When `reason` is empty — a rejection an agent cannot act on is a defect, not an event
 */
export function rejection(code: MovoErrorCode, reason: string): ToolRejection {
  if (reason.trim() === "") {
    throw new Error(
      `a ${code} rejection was built with an empty reason; every rejection must say why (spec §25.12)`,
    );
  }
  return { ok: false, code, reason, fix: registryEntry(code).fix };
}

/**
 * Build a success.
 *
 * @param payload - The tool's own result fields
 * @returns The payload tagged `ok: true`
 */
export function success<T extends object>(payload: T): ToolSuccess<T> {
  return { ok: true, ...payload };
}
