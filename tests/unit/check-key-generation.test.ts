import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkKeyGeneration,
  KEY_GENERATION_API,
  KEY_GENERATION_FAILURE,
} from "../../scripts/check-key-generation.ts";
import { materialiseFixture } from "../support/materialise-fixture.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const FIXTURE = join(REPO_ROOT, "tests", "fixtures", "key-generation", "violating");
const SCRIPT = join(REPO_ROOT, "scripts", "check-key-generation.ts");
let violating: ReturnType<typeof materialiseFixture>;

beforeAll(() => {
  violating = materialiseFixture(FIXTURE);
});
afterAll(() => {
  violating.cleanup();
});

describe("key-generation gate", () => {
  it("passes on the real repository", () => {
    expect(checkKeyGeneration(REPO_ROOT)).toEqual([]);
  });
  it("catches the API rendered from the shared constant", () => {
    expect(checkKeyGeneration(violating.path)[0]?.text).toContain(KEY_GENERATION_API);
  });
  it("exits non-zero on the planted fixture", () => {
    try {
      execFileSync(process.execPath, [SCRIPT, "--root", violating.path], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      throw new Error("key-generation gate unexpectedly passed");
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      expect(failure.status).toBe(1);
      expect(failure.stderr).toContain(KEY_GENERATION_FAILURE);
    }
  });
});
