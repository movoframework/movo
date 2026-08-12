import { describe, expect, it } from "vitest";
import {
  isSensitiveKey,
  REDACTED,
  REDACTED_PAYMENT_PAYLOAD,
  REDACTED_STELLAR_SECRET,
  redact,
  redactRecord,
  redactText,
} from "./redact.js";

const SEED = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ACCOUNT = "GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3";
const CONTRACT = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

describe("sensitive key detection", () => {
  it.each([
    "Authorization",
    "authorization",
    "apiKey",
    "API_KEY",
    "api-key",
    "x-api-key",
    "STELLAR_PRIVATE_KEY",
    "MOVO_FACILITATOR_API_KEY",
    "GITHUB_TOKEN",
    "dbSecret",
    "password",
    "passphrase",
    "PAYMENT-SIGNATURE",
    "seed",
    "cookie",
    // Numbered variants: a rotation slot or a flattened array index must not smuggle a
    // credential past the word match for the sake of a trailing digit.
    "apiKey2",
    "token_1",
    "Authorization0",
  ])("treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["monkey", "tokenizer", "network", "payTo", "asset", "amount", "maxTimeoutSeconds"])(
    "does not treat %s as sensitive",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );

  it("over-redacts publicKey, and that is the safe direction", () => {
    // The word-boundary rule that catches `apiKey` cannot distinguish a public key from a
    // private one without an exception list, and an exception list is somewhere a real secret
    // can hide. An unreadable public key is an inconvenience; a leaked seed is an incident.
    expect(isSensitiveKey("publicKey")).toBe(true);
  });
});

describe("Stellar secret seeds", () => {
  it("replaces a seed that is the whole value", () => {
    expect(redactText(SEED)).toBe(REDACTED_STELLAR_SECRET);
  });

  it("replaces a seed interpolated into a longer message", () => {
    // The likeliest way a seed actually escapes: someone puts it in an error message. Matching
    // only whole values would miss it entirely.
    expect(redactText(`could not load ${SEED} from disk`)).toBe(
      `could not load ${REDACTED_STELLAR_SECRET} from disk`,
    );
  });

  it("replaces every occurrence, not only the first", () => {
    expect(redactText(`${SEED} and ${SEED}`)).not.toContain(SEED);
  });

  it("leaves a public account address alone", () => {
    expect(redactText(ACCOUNT)).toBe(ACCOUNT);
  });

  it("leaves a contract address alone", () => {
    expect(redactText(CONTRACT)).toBe(CONTRACT);
  });

  it("does not mangle a longer base32 run that merely contains an S", () => {
    const longer = `${SEED}EXTRA`;
    expect(redactText(longer)).toBe(longer);
  });
});

describe("encoded payment payloads", () => {
  it("replaces a base64 payload carrying x402 markers", () => {
    const payload = Buffer.from(
      JSON.stringify({ x402Version: 2, accepted: {}, payload: { transaction: "AAAA" } }),
    ).toString("base64");

    expect(redactText(payload)).toBe(REDACTED_PAYMENT_PAYLOAD);
  });

  it("leaves ordinary base64 that is not a payment payload", () => {
    const ordinary = Buffer.from("a plain string long enough to look like base64 input").toString(
      "base64",
    );
    expect(redactText(ordinary)).toBe(ordinary);
  });

  it("leaves short strings alone", () => {
    expect(redactText("hello")).toBe("hello");
  });
});

describe("structural redaction", () => {
  it("redacts a sensitive key wholesale", () => {
    expect(redact({ Authorization: "Bearer abc123", network: "stellar:testnet" })).toEqual({
      Authorization: REDACTED,
      network: "stellar:testnet",
    });
  });

  it("recurses into nested objects and arrays", () => {
    expect(redact({ facilitator: { headers: [{ Authorization: "Bearer x" }] }, ok: true })).toEqual(
      { facilitator: { headers: [{ Authorization: REDACTED }] }, ok: true },
    );
  });

  it("reduces a function to a marker rather than stringifying its source", () => {
    // Stringifying would print the closure, which is where an authHeaders provider keeps the
    // very thing that must not be printed.
    expect(redact({ authHeaders: () => "secret in the closure" })).toEqual({
      authHeaders: REDACTED,
    });
    expect(redact([() => 1])).toEqual(["[function]"]);
  });

  it("reduces an Error to its name and redacted message", () => {
    const redacted = redact(new Error(`failed with ${SEED}`)) as { name: string; message: string };
    expect(redacted.name).toBe("Error");
    expect(redacted.message).not.toContain(SEED);
  });

  it("handles Maps, Sets, Dates, URLs and RegExps", () => {
    expect(
      redact(
        new Map([
          ["token", "abc"],
          ["network", "stellar:testnet"],
        ]),
      ),
    ).toEqual({
      token: REDACTED,
      network: "stellar:testnet",
    });
    expect(redact(new Set(["a", "b"]))).toEqual(["a", "b"]);
    expect(redact(new Date("2026-08-11T00:00:00.000Z"))).toBe("2026-08-11T00:00:00.000Z");
    expect(redact(new URL(`https://example.com/${SEED}`))).not.toContain(SEED);
    expect(redact(/abc/g)).toBe("/abc/g");
  });

  it("passes primitives through, stringifying bigints", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(10n)).toBe("10n");
    expect(redact(Symbol("x"))).toBe("[symbol]");
  });

  it("survives a cycle instead of overflowing the stack", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic["self"] = cyclic;
    expect(redact(cyclic)).toEqual({ name: "root", self: "[circular]" });
  });

  it("truncates below a depth that would otherwise be unbounded", () => {
    let deep: Record<string, unknown> = { value: SEED };
    for (let index = 0; index < 20; index += 1) deep = { nested: deep };

    expect(JSON.stringify(redact(deep))).toContain("[truncated]");
    expect(JSON.stringify(redact(deep))).not.toContain(SEED);
  });

  it("does not mutate its input", () => {
    // Callers hold the live configuration. A redactor that edited in place would destroy the
    // program in order to protect the log.
    const original = { Authorization: "Bearer abc" };
    redact(original);
    expect(original.Authorization).toBe("Bearer abc");
  });
});

describe("redactRecord", () => {
  it("returns a record for a record", () => {
    expect(redactRecord({ token: "abc", ok: 1 })).toEqual({ token: REDACTED, ok: 1 });
  });

  it("returns an empty record when redaction did not produce one", () => {
    expect(redactRecord([] as unknown as Record<string, unknown>)).toEqual({});
  });
});
