import { describe, expect, it } from "vitest";
import { isMovoError, MovoError } from "./MovoError.js";
import { DOCS_BASE_URL, MOVO_ERROR_CODES, MOVO_ERROR_REGISTRY, registryEntry } from "./registry.js";

const SEED = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("construction", () => {
  it("carries the code, the registry's fix and a docs URL built from DOCS_BASE_URL", () => {
    const error = new MovoError("MOVO_E_PAYTO_INVALID", "bad address");

    expect(error.code).toBe("MOVO_E_PAYTO_INVALID");
    expect(error.docs).toBe(`${DOCS_BASE_URL}/errors/MOVO_E_PAYTO_INVALID`);
    expect(error.fix).toBe(registryEntry("MOVO_E_PAYTO_INVALID").fix);
    expect(error.name).toBe("MovoError");
  });

  it("is an Error, so ordinary error handling still works", () => {
    const error = new MovoError("MOVO_E_PAYTO_INVALID", "bad address");
    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toBeDefined();
  });

  it("chains a cause for stack output while keeping it reachable programmatically", () => {
    const cause = new Error("underlying");
    expect(new MovoError("MOVO_E_PAYTO_INVALID", "bad", { cause }).cause).toBe(cause);
  });

  it("carries a correlation id when one is supplied", () => {
    expect(
      new MovoError("MOVO_E_PAYTO_INVALID", "bad", { correlationId: "abc" }).correlationId,
    ).toBe("abc");
  });
});

describe("redaction at construction, not at output", () => {
  it("redacts the context when the error is created", () => {
    const error = new MovoError("MOVO_E_SECRET_IN_CONFIG", "nope", {
      context: { Authorization: "Bearer abc123", layer: "config" },
    });

    // Read straight off the property, not through toJSON: there is no unredacted form held
    // anywhere, so no serialisation path can reach one.
    expect(error.context["Authorization"]).toBe("[REDACTED]");
    expect(error.context["layer"]).toBe("config");
  });

  it("redacts a secret interpolated into the message", () => {
    const error = new MovoError("MOVO_E_PAYTO_INVALID", `could not load ${SEED}`);
    expect(error.message).not.toContain(SEED);
  });

  it("freezes the context so it cannot be edited back afterwards", () => {
    const error = new MovoError("MOVO_E_PAYTO_INVALID", "bad", { context: { a: 1 } });
    expect(Object.isFrozen(error.context)).toBe(true);
  });

  it("redacts a cause on the way into toJSON", () => {
    const error = new MovoError("MOVO_E_PAYTO_INVALID", "bad", {
      cause: new Error(`upstream said ${SEED}`),
    });
    expect(JSON.stringify(error.toJSON())).not.toContain(SEED);
  });
});

describe("toJSON is the only serialisation path", () => {
  it("emits the full diagnostic shape", () => {
    const error = new MovoError("MOVO_E_PUBNET_NOT_ENABLED", "not enabled", {
      context: { env: "pubnet" },
      correlationId: "corr-1",
    });

    expect(error.toJSON()).toEqual({
      name: "MovoError",
      code: "MOVO_E_PUBNET_NOT_ENABLED",
      message: "not enabled",
      docs: `${DOCS_BASE_URL}/errors/MOVO_E_PUBNET_NOT_ENABLED`,
      fix: registryEntry("MOVO_E_PUBNET_NOT_ENABLED").fix,
      context: { env: "pubnet" },
      correlationId: "corr-1",
      cause: undefined,
    });
  });

  it("is what JSON.stringify uses", () => {
    const error = new MovoError("MOVO_E_PAYTO_INVALID", "bad", {
      context: { token: "abc123" },
    });
    expect(JSON.stringify(error)).toContain("[REDACTED]");
    expect(JSON.stringify(error)).not.toContain("abc123");
  });
});

describe("isMovoError", () => {
  it("recognises a Movo error", () => {
    expect(isMovoError(new MovoError("MOVO_E_PAYTO_INVALID", "bad"))).toBe(true);
  });

  it("rejects an ordinary error", () => {
    expect(isMovoError(new Error("bad"))).toBe(false);
  });

  it("rejects a non-error", () => {
    expect(isMovoError("MOVO_E_PAYTO_INVALID")).toBe(false);
    expect(isMovoError(null)).toBe(false);
  });

  it("recognises an error from a duplicated copy of this package", () => {
    // A consumer whose tree resolves two copies of this package would otherwise see a genuine
    // Movo error take the "unknown error" branch, losing its code and its fix.
    const foreign = Object.assign(new Error("from another copy"), {
      name: "MovoError",
      code: "MOVO_E_PAYTO_INVALID",
      docs: `${DOCS_BASE_URL}/errors/MOVO_E_PAYTO_INVALID`,
    });
    expect(isMovoError(foreign)).toBe(true);
  });

  it("rejects an impostor carrying a code that is not in the registry", () => {
    const impostor = Object.assign(new Error("nope"), {
      name: "MovoError",
      code: "MOVO_E_MADE_UP",
    });
    expect(isMovoError(impostor)).toBe(false);
  });
});

describe("the registry", () => {
  it("keys every entry under its own code", () => {
    for (const code of MOVO_ERROR_CODES) {
      expect(MOVO_ERROR_REGISTRY[code].code).toBe(code);
    }
  });

  it("uses the MOVO_E_ prefix for errors and MOVO_W_ for warnings", () => {
    for (const code of MOVO_ERROR_CODES) {
      const expected = MOVO_ERROR_REGISTRY[code].severity === "error" ? "MOVO_E_" : "MOVO_W_";
      expect(code.startsWith(expected)).toBe(true);
    }
  });

  it("gives every code a meaning and a fix", () => {
    for (const code of MOVO_ERROR_CODES) {
      expect(MOVO_ERROR_REGISTRY[code].meaning.length).toBeGreaterThan(10);
      expect(MOVO_ERROR_REGISTRY[code].fix.length).toBeGreaterThan(10);
    }
  });

  it("builds every docs URL from DOCS_BASE_URL, with no literal anywhere else", () => {
    for (const code of MOVO_ERROR_CODES) {
      expect(new MovoError(code, "x").docs).toBe(`${DOCS_BASE_URL}/errors/${code}`);
    }
  });
});
