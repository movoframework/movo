import { describe, expect, it } from "vitest";
import { VERSION } from "./index.js";

describe("@movo/stellar", () => {
  it("is buildable and exports a semver VERSION", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.split(".")).toHaveLength(3);
  });
});
