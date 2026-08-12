/**
 * `MovoError` — the only error type Movo throws, and the only serialisation path it offers.
 *
 * Two properties carry most of the weight.
 *
 * **Context is redacted at construction.** `new MovoError(code, message, { context })` stores a
 * redacted copy. There is no unredacted form held anywhere and no "redact on output" step to
 * forget, so a value cannot escape through a serialisation path nobody anticipated — a
 * `console.log` of the error, a test snapshot, Node printing an unhandled rejection. The
 * message is redacted too, because interpolating a secret into a message is the easiest way to
 * leak one (spec §1.5 P6, §5.10).
 *
 * **`toJSON()` is the only serialisation path.** Anything that writes a `MovoError` anywhere
 * goes through it, which is what makes "the fixture seed appears in zero bytes of the output"
 * a testable claim rather than an aspiration (AC1.6).
 */

import { redact, redactRecord, redactText } from "../observability/redact.js";
import { docsUrlFor, MOVO_ERROR_REGISTRY, type MovoErrorCode, registryEntry } from "./registry.js";

/** The shape `MovoError.toJSON()` produces. */
export interface SerializedMovoError {
  readonly name: "MovoError";
  readonly code: MovoErrorCode;
  readonly message: string;
  readonly docs: string;
  readonly fix: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly correlationId: string | undefined;
  readonly cause: unknown;
}

/** Options accepted when constructing a {@link MovoError}. */
export interface MovoErrorOptions {
  /** Structured detail. Redacted at construction; never store a raw credential here. */
  readonly context?: Readonly<Record<string, unknown>>;
  /** Correlation id joining this failure to the request that produced it. */
  readonly correlationId?: string;
  /** The underlying error, if this one wraps another. */
  readonly cause?: unknown;
}

/**
 * A Movo failure carrying a stable code, redacted context and a documentation link.
 */
export class MovoError extends Error {
  override readonly name: "MovoError" = "MovoError";

  /** Stable, screaming-snake code from the registry. Never renamed, never reused. */
  readonly code: MovoErrorCode;

  /** Structured detail, redacted at construction and frozen. */
  readonly context: Readonly<Record<string, unknown>>;

  /** Correlation id, when the failure arose inside a request. */
  readonly correlationId: string | undefined;

  /** Documentation URL, always derived from the registry's `DOCS_BASE_URL`. */
  readonly docs: string;

  /** The registry's fix template for this code. */
  readonly fix: string;

  /**
   * @param code - A registry code
   * @param message - Human-readable message; redacted at construction
   * @param options - Context, correlation id and cause
   */
  constructor(code: MovoErrorCode, message: string, options?: MovoErrorOptions) {
    // `cause` is passed to Error so that runtimes chain it in stack output, and is redacted
    // separately for `toJSON()`. The live cause is kept for programmatic inspection — a
    // caller catching a MovoError may legitimately want the original — while nothing that
    // *serialises* the error can reach it unredacted.
    super(redactText(message), options?.cause === undefined ? undefined : { cause: options.cause });

    const entry = registryEntry(code);
    this.code = code;
    this.docs = docsUrlFor(code);
    this.fix = entry.fix;
    this.context = Object.freeze(redactRecord(options?.context ?? {}));
    this.correlationId = options?.correlationId;
  }

  /**
   * Serialise the error. The only serialisation path Movo offers.
   *
   * @returns A plain object safe to log, with every value already redacted
   */
  toJSON(): SerializedMovoError {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      docs: this.docs,
      fix: this.fix,
      context: this.context,
      correlationId: this.correlationId,
      cause: this.cause === undefined ? undefined : redact(this.cause),
    };
  }
}

/**
 * Whether a value is a {@link MovoError}.
 *
 * Falls back to a structural check when `instanceof` fails, because a consumer whose tree
 * resolves two copies of `@movoframework/core` would otherwise see a genuine Movo error
 * classified as a foreign one — and would then take the "unknown error" branch on a failure
 * Movo has a code and a fix for.
 *
 * @param value - Candidate value
 * @returns `true` when the value is a Movo error
 */
export function isMovoError(value: unknown): value is MovoError {
  if (value instanceof MovoError) return true;
  if (!(value instanceof Error)) return false;
  const candidate = value as Error & { code?: unknown; docs?: unknown };
  return (
    candidate.name === "MovoError" &&
    typeof candidate.code === "string" &&
    Object.hasOwn(MOVO_ERROR_REGISTRY, candidate.code)
  );
}
