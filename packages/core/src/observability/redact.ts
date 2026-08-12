/**
 * Redaction — applied at construction, never at output.
 *
 * Spec §1.5 P6 states the invariant plainly: secrets are redacted when a value is *created*,
 * not when it is logged. The distinction is the whole point. Redacting at log time protects
 * only the code paths someone remembered to route through the logger; a stack trace, an
 * unhandled rejection printed by Node, a test snapshot, a `JSON.stringify` in a hook a user
 * wrote — each is an escape hatch. Redacting at construction means the unredacted value never
 * enters the object in the first place, so there is nothing for an unexpected path to leak.
 *
 * What must never escape (M1 prompt §F):
 *
 *  - `Authorization` headers and any bearer credential
 *  - the `PAYMENT-SIGNATURE` header
 *  - environment variables whose names contain KEY, SECRET or TOKEN
 *  - Stellar secret seeds, which are `S` followed by 55 base32 characters
 *  - base64 payment payloads
 *
 * Two design choices worth stating because they look like bugs otherwise.
 *
 * **Over-redaction is the safe direction.** `publicKey` is redacted even though a public key
 * is not a secret, because the word-boundary rule that catches `apiKey` and `STELLAR_PRIVATE_KEY`
 * cannot distinguish them without a list of exceptions — and an exception list is a place for
 * a real secret to hide. A developer who cannot see their public key in a log has an
 * inconvenience; a developer whose seed reaches a log has an incident.
 *
 * **Seeds are replaced inside strings, not only when a string is exactly a seed.** A seed
 * interpolated into an error message (`"could not load S..."`) is the likeliest way one
 * actually escapes, and whole-value matching would miss it entirely.
 */

/** The replacement written in place of a redacted value. */
export const REDACTED = "[REDACTED]";

/** The replacement written in place of a Stellar secret seed found inside a longer string. */
export const REDACTED_STELLAR_SECRET = "[REDACTED_STELLAR_SECRET]";

/** The replacement written in place of an encoded payment payload. */
export const REDACTED_PAYMENT_PAYLOAD = "[REDACTED_PAYMENT_PAYLOAD]";

/**
 * A Stellar secret seed: `S` followed by 55 base32 characters.
 *
 * The lookaround pair prevents a match inside a longer base32 run, so a 56-character public
 * key (`G…`) or contract address (`C…`) embedded in a larger token is not mangled.
 */
const STELLAR_SECRET_SEED = /(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])/g;

/** Loose base64/base64url shape. Deliberately permissive — the decode check does the work. */
const BASE64ISH = /^[A-Za-z0-9+/=_-]{40,}$/;

/** Markers that identify a decoded x402 payment payload. */
const PAYMENT_PAYLOAD_MARKER = /"x402Version"|"paymentPayload"|"accepted"|"paymentRequirements"/;

/**
 * Key name fragments that make a value sensitive.
 *
 * Matched as whole words after splitting the key on camelCase and separator boundaries, so
 * `apiKey`, `API_KEY`, `api-key` and `x-api-key` all resolve to the word `key`, while
 * `monkey` and `tokenizer` do not resolve to `key` or `token`.
 */
const SENSITIVE_WORDS: ReadonlySet<string> = new Set([
  "auth",
  "authorization",
  "bearer",
  "cookie",
  "credential",
  "credentials",
  "key",
  "keys",
  "passphrase",
  "password",
  "secret",
  "secrets",
  "seed",
  "sig",
  "signature",
  "token",
  "tokens",
]);

/** How deep to walk before giving up. Guards against pathological or adversarial structures. */
const MAX_DEPTH = 12;

/**
 * Split an object key or environment variable name into lowercase words.
 *
 * Trailing digits are stripped as an additional candidate, so `apiKey2`, `token_1` and
 * `authHeaders0` are recognised. A numbered credential is a real shape — a rotation slot, an
 * array index flattened into a key name — and treating `key2` as a different word from `key`
 * would let one through for the sake of a digit.
 *
 * @param key - The key to split
 * @returns Lowercase word fragments, including digit-stripped variants
 */
function keyWords(key: string): readonly string[] {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());

  const withoutTrailingDigits = words
    .map((word) => word.replace(/\d+$/, ""))
    .filter((word) => word.length > 0);

  return [...words, ...withoutTrailingDigits];
}

/**
 * Whether a key names something that must never be printed.
 *
 * @param key - Object key or environment variable name
 * @returns `true` when the value under this key is redacted wholesale
 */
export function isSensitiveKey(key: string): boolean {
  return keyWords(key).some((word) => SENSITIVE_WORDS.has(word));
}

/**
 * Whether a string is an encoded x402 payment payload.
 *
 * @param value - Candidate string
 * @returns `true` when the value base64-decodes to something carrying payment payload markers
 */
function looksLikePaymentPayload(value: string): boolean {
  if (!BASE64ISH.test(value)) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    return false;
  }
  return PAYMENT_PAYLOAD_MARKER.test(decoded);
}

/**
 * Redact a string in place: encoded payment payloads wholesale, Stellar seeds by substitution.
 *
 * Exported because `MovoError` redacts its own `message` at construction, and a message is a
 * string rather than a structure.
 *
 * @param value - The string to redact
 * @returns The string with any secret replaced
 */
export function redactText(value: string): string {
  if (looksLikePaymentPayload(value)) return REDACTED_PAYMENT_PAYLOAD;
  return value.replace(STELLAR_SECRET_SEED, REDACTED_STELLAR_SECRET);
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case "string":
      return redactText(value);
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return `${value.toString()}n`;
    case "function":
      // A function can close over a credential — `facilitator.authHeaders` is designed to.
      // Its identity is never useful in a log, so it is reduced to a marker rather than
      // stringified, because stringifying it would print the closure's source.
      return "[function]";
    case "symbol":
      return "[symbol]";
    default:
      break;
  }

  const object = value as object;
  if (seen.has(object)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[truncated]";
  seen.add(object);

  try {
    if (object instanceof Error) {
      return {
        name: object.name,
        message: redactText(object.message),
      };
    }
    if (object instanceof Date) return object.toISOString();
    if (object instanceof URL) return redactText(object.toString());
    if (object instanceof RegExp) return object.toString();
    if (Array.isArray(object)) {
      return object.map((entry) => redactValue(entry, depth + 1, seen));
    }
    if (object instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of object) {
        const name = typeof key === "string" ? key : String(key);
        out[name] = isSensitiveKey(name) ? REDACTED : redactValue(entry, depth + 1, seen);
      }
      return out;
    }
    if (object instanceof Set) {
      return [...object].map((entry) => redactValue(entry, depth + 1, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(object)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(object);
  }
}

/**
 * Redact an arbitrary value, returning a new structure safe to serialise.
 *
 * The input is never mutated: callers hold the live configuration and the live payment
 * context, and a redactor that edited them in place would destroy the program to protect the
 * log.
 *
 * @param value - The value to redact
 * @returns A redacted copy
 */
export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet());
}

/**
 * Redact a record, preserving its shape for callers that need an object back.
 *
 * @param value - The record to redact
 * @returns A redacted copy with the same keys
 */
export function redactRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const redacted = redact(value);
  return typeof redacted === "object" && redacted !== null && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : {};
}
