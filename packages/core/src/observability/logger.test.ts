import { describe, expect, it } from "vitest";
import { newCorrelationId } from "./correlation.js";
import { createLogger, type LogRecord, parseLogLevel } from "./logger.js";

const SEED = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function capture(): { records: LogRecord[]; sink: (record: LogRecord) => void } {
  const records: LogRecord[] = [];
  return { records, sink: (record) => void records.push(record) };
}

describe("levels", () => {
  it("emits at and below the configured level", () => {
    const { records, sink } = capture();
    const logger = createLogger({ level: "warn", sink });

    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");

    expect(records.map((record) => record.level)).toEqual(["error", "warn"]);
  });

  it("emits nothing at silent", () => {
    const { records, sink } = capture();
    const logger = createLogger({ level: "silent", sink });
    logger.error("e");
    expect(records).toEqual([]);
  });

  it("defaults to info", () => {
    const { records, sink } = capture();
    createLogger({ sink }).info("i");
    expect(records).toHaveLength(1);
  });

  it("parses a level from the environment, falling back to info", () => {
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel("shouty")).toBe("info");
    expect(parseLogLevel(undefined)).toBe("info");
  });
});

describe("redaction", () => {
  it("still redacts at debug, the level people raise when something is wrong", () => {
    // The level controls volume, never disclosure. Raising the level to diagnose a payment
    // failure is exactly the moment a naive logger starts printing authorisation headers.
    const { records, sink } = capture();
    createLogger({ level: "debug", sink }).debug("verifying", {
      Authorization: "Bearer abc123",
      seedInMessage: SEED,
    });

    expect(JSON.stringify(records)).not.toContain("abc123");
    expect(JSON.stringify(records)).not.toContain(SEED);
  });

  it("redacts a secret interpolated into the message itself", () => {
    const { records, sink } = capture();
    createLogger({ sink }).info(`loaded ${SEED}`);
    expect(records[0]?.message).not.toContain(SEED);
  });

  it("passes non-sensitive fields through unchanged", () => {
    const { records, sink } = capture();
    createLogger({ sink }).info("compiled", { routes: 3, network: "stellar:testnet" });
    expect(records[0]?.fields).toEqual({ routes: 3, network: "stellar:testnet" });
  });
});

describe("correlation ids", () => {
  it("produces a distinct id each time", () => {
    expect(newCorrelationId()).not.toBe(newCorrelationId());
  });

  it("produces a v4 UUID", () => {
    expect(newCorrelationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
