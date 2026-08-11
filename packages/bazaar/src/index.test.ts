import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "./index.js";

/**
 * The suite name is read from the manifest rather than written out, so that it cannot drift
 * from the name this package actually publishes under. See `packages/core/src/identity.ts`.
 */
const PACKAGE_NAME: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    name: string;
  }
).name;

describe(PACKAGE_NAME, () => {
  it("is buildable and exports a semver VERSION", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.split(".")).toHaveLength(3);
  });
});
