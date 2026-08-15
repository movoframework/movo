import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { movoPackageName } from "../../packages/core/src/identity.ts";
import {
  DEFAULT_DEPENDENCY_RANGE,
  rewriteManifest,
  scaffold,
  TEMPLATES,
} from "../../packages/create-movo-app/src/index.ts";

/**
 * AC5.1 — the automated form of "a fresh clone works".
 *
 * This is the most valuable test in M5, and the reason is that every other test in the repository
 * runs inside the workspace, where imports resolve because pnpm linked them. A generated project
 * is outside all of that. The failures it can have are entirely its own: a `workspace:*` range no
 * registry can satisfy, a `tsconfig` extending a base that does not exist, a `.js` specifier Node
 * will not rewrite, a missing `@types/node`. None of them are visible from inside the monorepo,
 * and all of them make the first five minutes of using Movo fail.
 *
 * The full install-and-run form is gated behind `MOVO_SCAFFOLD_E2E=1`, because a real `npm
 * install` takes minutes and reaches the network — which the PR gate must never do (`ci.yml`).
 * What runs unconditionally is everything that does not need an install, and that is deliberately
 * a lot: the copy, the rewrites, and a **typecheck against the workspace's own TypeScript**.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

// Derived, never spelled out. `tests/unit/scope-drift.test.ts` fails a test that writes the
// scope as a literal, because the M0 rename left fixtures green while the gate they were
// meant to prove matched nothing in real code.
const CORE = movoPackageName("core");
const TESTING = movoPackageName("testing");
const TEMPLATE = movoPackageName("template-minimal");
const scaffoldE2E = process.env["MOVO_SCAFFOLD_E2E"] === "1";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  // `.movo-tmp/` rather than `node_modules`: Node refuses to strip types for files underneath
  // node_modules, so a generated project placed there could never be run the way a real one is.
  const parent = join(REPO_ROOT, ".movo-tmp");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "scaffold-"));
  temporaryRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true });
});

describe("rewriteManifest", () => {
  it("replaces every workspace range, because npm cannot resolve one", () => {
    const rewritten = rewriteManifest(
      {
        name: TEMPLATE,
        dependencies: { [CORE]: "workspace:*", express: "5.2.1" },
        devDependencies: { [TESTING]: "workspace:*" },
      },
      "my-api",
    );

    const dependencies = rewritten["dependencies"] as Record<string, string>;
    const devDependencies = rewritten["devDependencies"] as Record<string, string>;

    expect(dependencies[CORE]).toBe(DEFAULT_DEPENDENCY_RANGE);
    expect(devDependencies[TESTING]).toBe(DEFAULT_DEPENDENCY_RANGE);

    // Third-party ranges are left exactly as the template pinned them.
    expect(dependencies["express"]).toBe("5.2.1");
  });

  it("leaves no workspace: range anywhere in the generated manifest", () => {
    // Stated as a whole-document property rather than key by key: a new dependency field added
    // to a template later would slip past a per-key assertion.
    const rewritten = rewriteManifest(
      {
        name: "t",
        dependencies: { [CORE]: "workspace:*" },
        devDependencies: { [TESTING]: "workspace:^" },
      },
      "my-api",
    );

    expect(JSON.stringify(rewritten)).not.toContain("workspace:");
  });

  it("points ranges into the working tree when linking, so the test checks this branch", () => {
    const rewritten = rewriteManifest(
      { name: "t", dependencies: { [CORE]: "workspace:*" } },
      "my-api",
      "/repo",
    );

    const dependencies = rewritten["dependencies"] as Record<string, string>;
    expect(dependencies[CORE]).toContain("file:");
    expect(dependencies[CORE]).toContain("core");
  });

  it("takes the user's name and drops our licence", () => {
    const rewritten = rewriteManifest({ name: TEMPLATE, license: "Apache-2.0" }, "my-api");

    expect(rewritten["name"]).toBe("my-api");
    // A generated project is the user's. Leaving Apache-2.0 on it would be us choosing their
    // licence for them.
    expect(rewritten["license"]).toBeUndefined();
  });
});

describe.each(TEMPLATES)("the %s template scaffolds a real project", (template) => {
  it("produces the files a project needs, and none of ours", () => {
    const root = temporaryRoot();
    const result = scaffold({ target: join(root, "my-api"), template, cwd: root });

    for (const required of [
      "package.json",
      "movo.config.ts",
      "src/app.ts",
      "src/server.ts",
      "README.md",
      "tsconfig.json",
      ".env.example",
    ]) {
      expect(result.files, `${template} is missing ${required}`).toContain(required);
    }

    // `.gitignore` cannot be shipped as a dotfile — npm renames it to `.npmignore` on publish —
    // so it is committed as `gitignore` and renamed here. If that rename regressed, a user's
    // `.env` would be one `git add .` away from a public repository.
    expect(existsSync(join(result.root, ".gitignore"))).toBe(true);
    expect(readFileSync(join(result.root, ".gitignore"), "utf8")).toContain(".env");
    expect(result.files).not.toContain("gitignore");
  });

  it("contains no secret and no key", () => {
    const root = temporaryRoot();
    const result = scaffold({ target: join(root, "my-api"), template, cwd: root });

    for (const file of result.files) {
      const contents = readFileSync(join(result.root, file), "utf8");
      // A Stellar secret seed is `S` followed by 55 base32 characters. A template that shipped
      // one would put a working key into every project made from it.
      expect(contents, `${file} contains something shaped like a Stellar seed`).not.toMatch(
        /(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])/,
      );
    }

    // `.env` itself must never be generated — only the example.
    expect(existsSync(join(result.root, ".env"))).toBe(false);
  });

  it("substitutes the project name into the README", () => {
    const root = temporaryRoot();
    const result = scaffold({
      target: join(root, "my-api"),
      template,
      cwd: root,
      name: "acme-weather",
    });
    const readme = readFileSync(join(result.root, "README.md"), "utf8");

    expect(readme).toContain("acme-weather");
    expect(readme).not.toContain("{{projectName}}");
  });

  it("typechecks with the workspace's own TypeScript", () => {
    // The generated `tsconfig.json` is written from scratch rather than copied, because the
    // template's extends a base that a generated project has no access to. This is the assertion
    // that the replacement is actually usable — and it needs no install, because the link mode
    // resolves the workspace packages straight out of the working tree.
    const root = temporaryRoot();
    const result = scaffold({
      target: join(root, "my-api"),
      template,
      cwd: root,
      linkWorkspace: REPO_ROOT,
    });

    // pnpm's layout does not place workspace packages at the repository root by default, so the
    // typecheck is pointed at the root `node_modules` explicitly. That is the same resolution a
    // real install produces, without spending minutes producing it.
    const tsc = join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

    expect(() => {
      execFileSync(process.execPath, [tsc, "--noEmit", "-p", "tsconfig.json"], {
        cwd: result.root,
        encoding: "utf8",
        timeout: 180_000,
        env: { ...process.env, NODE_PATH: join(REPO_ROOT, "node_modules") },
      });
    }).not.toThrow();
  });

  it("refuses to scaffold into a directory that already has files in it", () => {
    const root = temporaryRoot();
    const target = join(root, "my-api");
    scaffold({ target, template, cwd: root });

    // Merging into an existing project would leave a half-overwritten tree, which is worse than
    // either outcome. Refusing is the only safe answer.
    expect(() => scaffold({ target, template, cwd: root })).toThrow(/already exists/);
  });
});

describe("AC5.1 — create, install, typecheck, test", () => {
  const gated = scaffoldE2E ? it : it.skip;

  gated(
    "a scaffolded minimal project installs, typechecks and passes its generated test",
    () => {
      const root = temporaryRoot();
      const result = scaffold({
        target: join(root, "my-api"),
        template: "minimal",
        cwd: root,
        linkWorkspace: REPO_ROOT,
      });

      const run = (command: string, args: readonly string[]): string =>
        execFileSync(command, [...args], {
          cwd: result.root,
          encoding: "utf8",
          timeout: 600_000,
          shell: process.platform === "win32",
        });

      run("npm", ["install", "--no-audit", "--no-fund"]);
      run("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"]);

      const output = run("npx", ["vitest", "run"]);
      expect(output).toContain("passed");
    },
    900_000,
  );
});
