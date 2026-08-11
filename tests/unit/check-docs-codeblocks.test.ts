import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectBlocks, extractCodeBlocks } from "../../scripts/check-docs-codeblocks.ts";

/**
 * The documentation gate, and its proof of failure.
 *
 * No gate ships without one (Spec Amendment 001 §5). The proof runs the real script against a
 * fixture directory containing a snippet that cannot compile, and asserts a non-zero exit —
 * because a documentation checker that silently passes everything is indistinguishable from no
 * documentation checker, and rather more reassuring.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-docs-codeblocks.ts");

interface Run {
  readonly status: number;
  readonly output: string;
}

function runGate(docsRoot: string): Run {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--docs", docsRoot], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

function withFixtureDocs(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "movo-docs-fixture-"));
  try {
    mkdirSync(root, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(root, name), content, "utf8");
    }
    run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe("block extraction", () => {
  it("finds ts and typescript fences and ignores other languages", () => {
    const blocks = extractCodeBlocks(
      [
        "```ts",
        "const a = 1;",
        "```",
        "```bash",
        "pnpm test",
        "```",
        "```typescript",
        "const b = 2;",
        "```",
      ].join("\n"),
      "fixture.md",
    );

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.source)).toEqual(["const a = 1;", "const b = 2;"]);
  });

  it("reads the no-check and expect-error markers off the fence", () => {
    const blocks = extractCodeBlocks(
      [
        "```ts no-check",
        "whatever",
        "```",
        "```ts expect-error",
        "const a: number = 'x';",
        "```",
      ].join("\n"),
      "fixture.md",
    );

    expect(blocks.map((block) => block.mode)).toEqual(["no-check", "expect-error"]);
  });

  it("records the line the fence opened on, so a failure is navigable", () => {
    const blocks = extractCodeBlocks(
      ["# Title", "", "```ts", "const a = 1;", "```"].join("\n"),
      "f.md",
    );
    expect(blocks[0]?.line).toBe(3);
  });
});

describe("the gate on the real documentation", () => {
  it("finds blocks to check", () => {
    expect(collectBlocks(join(REPO_ROOT, "docs")).length).toBeGreaterThan(0);
  });

  it("excludes the specification and its amendments", () => {
    const files = new Set(collectBlocks(join(REPO_ROOT, "docs")).map((block) => block.file));
    expect([...files].some((file) => file.includes("docs/context/"))).toBe(false);
  });

  it("excludes the spike report, which is evidence rather than instruction", () => {
    const files = new Set(collectBlocks(join(REPO_ROOT, "docs")).map((block) => block.file));
    expect([...files].some((file) => file.includes("SPIKE_REPORT"))).toBe(false);
  });
});

describe("proof of failure", () => {
  it("exits non-zero on a document whose snippet does not compile", { timeout: 180_000 }, () => {
    withFixtureDocs(
      {
        "broken.md": [
          "# Broken",
          "",
          "```ts",
          'const value: number = "not a number";',
          "```",
          "",
        ].join("\n"),
      },
      (root) => {
        const result = runGate(root);
        expect(result.status).toBe(1);
        expect(result.output).toContain("docs codeblocks FAILED");
        expect(result.output).toContain("broken.md");
      },
    );
  });

  it("exits non-zero when a block marked expect-error compiles cleanly", {
    timeout: 180_000,
  }, () => {
    // The inverse failure. Without it, an `expect-error` fence would be a way to smuggle an
    // unchecked block past the gate for ever.
    withFixtureDocs(
      {
        "wrong.md": ["```ts expect-error", "const value: number = 1;", "```", ""].join("\n"),
      },
      (root) => {
        const result = runGate(root);
        expect(result.status).toBe(1);
        expect(result.output).toContain("UNEXPECTED SUCCESS");
      },
    );
  });

  it("passes a document whose snippet compiles", { timeout: 180_000 }, () => {
    withFixtureDocs(
      {
        "fine.md": ["```ts", "const value: number = 1;", "export { value };", "```", ""].join("\n"),
      },
      (root) => {
        expect(runGate(root).status).toBe(0);
      },
    );
  });
});
