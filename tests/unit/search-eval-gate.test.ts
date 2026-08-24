/**
 * The search-eval floor, and the proof that it can fail.
 *
 * §E.3(1): the nDCG/recall floors existed but nothing ran them, so the floor could regress in
 * silence — the same defect class as an inert `maxTotalSpend`, one level up at the enforcement
 * layer. `.github/workflows/ci.yml` now runs `pnpm test:search-eval:ci` as a required check, and
 * this file is that check's proof-of-failure test: a deliberately reversed ranking must be
 * rejected by the floors, and the ordinary ranking must clear them.
 *
 * The lexical-only configuration is used throughout because it is deterministic and needs no
 * model download, which is the same reason it is the configuration the PR gate runs. The hybrid
 * floors are exercised by `pnpm test:search-eval` locally and by the Conformance workflow, where
 * network I/O is permitted.
 */

import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEXICAL_NDCG_10_FLOOR,
  LEXICAL_RECALL_20_FLOOR,
  PROOF_OF_FAILURE_FAILED,
  PROOF_OF_FAILURE_PASSED,
  runEval,
} from "../../scripts/search-eval.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "search-eval.ts");

describe("search-eval floor", () => {
  it("the shipped ranker clears both floors", async () => {
    const result = await runEval({ lexicalOnly: true });
    expect(result.ndcg10).toBeGreaterThanOrEqual(LEXICAL_NDCG_10_FLOOR);
    expect(result.recall20).toBeGreaterThanOrEqual(LEXICAL_RECALL_20_FLOOR);
  }, 60_000);

  it("a reversed ranking falls below a floor", async () => {
    const degraded = await runEval({ lexicalOnly: true, degraded: true });
    // Asserted as a disjunction rather than on nDCG alone: which floor catches the fixture is a
    // property of the corpus, but *that* one of them catches it is the gate's whole claim.
    expect(
      degraded.ndcg10 < LEXICAL_NDCG_10_FLOOR || degraded.recall20 < LEXICAL_RECALL_20_FLOOR,
    ).toBe(true);
  }, 60_000);

  it("the CI invocation reports the degraded ranking as rejected", () => {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--lexical-only", "--degraded"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(stdout).toContain(PROOF_OF_FAILURE_PASSED);
    expect(stdout).not.toContain(PROOF_OF_FAILURE_FAILED);
  }, 120_000);

  it("exits non-zero when the ordinary run is below a floor", () => {
    // The other polarity, and the one that matters most: raise the floors past what the ranker
    // can reach and the process must fail. Without this, "the gate exits 0" would be consistent
    // with a gate that never exits 1 at all.
    try {
      execFileSync(process.execPath, [SCRIPT, "--lexical-only"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, MOVO_SEARCH_EVAL_FLOOR_OVERRIDE: "0.999" },
      });
      throw new Error("search-eval passed with its floors raised above 1.0");
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      expect(failure.status).toBe(1);
      expect(failure.stderr).toContain("is below the floor");
    }
  }, 120_000);
});
