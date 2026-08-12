import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOCS_BASE_URL,
  docsUrlFor,
  MOVO_ERROR_CODES,
  MOVO_ERROR_REGISTRY,
} from "../../packages/core/src/errors/registry.ts";
import { ERROR_DOCS_PATH, renderErrorDocs } from "../../scripts/generate-error-docs.ts";

/**
 * AC1.7 — every registry code appears in `docs/reference/errors.md`, asserted by test.
 *
 * Two levels of assertion, and both are needed. Regenerating and comparing catches any drift
 * at all, including a reworded fix. Checking each code individually is what makes the failure
 * message useful when it does drift: "the page is stale" sends a reader to a diff, while
 * "MOVO_E_TRUSTLINE_MISSING is missing from the page" tells them what happened.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "generate-error-docs.ts");

const committed = readFileSync(ERROR_DOCS_PATH, "utf8");

describe("the generated error reference", () => {
  it("matches what the registry renders today", () => {
    expect(committed).toBe(renderErrorDocs());
  });

  it.each(MOVO_ERROR_CODES)("documents %s", (code) => {
    expect(committed).toContain(code);
  });

  it.each(MOVO_ERROR_CODES)("carries the registry's meaning and fix for %s", (code) => {
    const entry = MOVO_ERROR_REGISTRY[code];
    expect(committed).toContain(entry.meaning.replaceAll("|", "\\|"));
    expect(committed).toContain(entry.fix.split("|")[0]?.slice(0, 40) ?? "");
  });

  it("links every code to a URL built from DOCS_BASE_URL", () => {
    for (const code of MOVO_ERROR_CODES) {
      expect(committed).toContain(docsUrlFor(code));
      expect(docsUrlFor(code).startsWith(DOCS_BASE_URL)).toBe(true);
    }
  });

  it("says plainly that it is generated", () => {
    expect(committed).toContain("GENERATED FILE");
    expect(committed).toContain("pnpm generate:errors");
  });

  it("passes its own --check gate", () => {
    const output = execFileSync(process.execPath, [SCRIPT, "--check"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    expect(output).toContain("up to date");
  });

  it("fails --check against a page that has drifted from the registry", () => {
    // Proof of failure. A gate that has only ever been observed to pass has not been shown to
    // work (Spec Amendment 001 §5). The stale copy goes to a temporary directory rather than
    // over the committed page, so a crash here cannot leave the repository damaged.
    const directory = mkdtempSync(join(tmpdir(), "movo-error-docs-"));
    const stale = join(directory, "errors.md");
    try {
      writeFileSync(stale, committed.replace("MOVO_E_PAYTO_INVALID", "MOVO_E_RENAMED"), "utf8");

      let status = 0;
      let output = "";
      try {
        execFileSync(process.execPath, [SCRIPT, "--check", "--path", stale], {
          encoding: "utf8",
          cwd: REPO_ROOT,
        });
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        status = failure.status ?? -1;
        output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
      }

      expect(status).toBe(1);
      expect(output).toContain("is stale");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
