/**
 * The scaffolder.
 *
 * **The templates are real workspace members**, not string literals in this file. They are
 * type-checked, linted and tested by the same CI that checks everything else, which is the only
 * arrangement under which they stay correct — a template kept as an embedded string rots within
 * weeks, and rots invisibly, because nothing compiles it.
 *
 * Scaffolding is therefore a copy with three edits: the package name, the dependency versions,
 * and `.gitignore`. Everything else is the file as committed.
 *
 * **`workspace:*` cannot survive the copy.** The templates declare workspace protocol ranges
 * because that is what makes them members; a generated project is not in this workspace and
 * `npm install` would fail on the first dependency. They are rewritten to real ranges — or, for
 * the automated scaffold test, to `file:` links back into the monorepo, which is what makes
 * "create, install, typecheck, test" a genuine end-to-end check rather than a check against
 * whatever happens to be published.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The templates this scaffolder ships. */
export const TEMPLATES = ["minimal", "discoverable"] as const;

/** A template name. */
export type TemplateName = (typeof TEMPLATES)[number];

/** The version range generated projects depend on. */
export const DEFAULT_DEPENDENCY_RANGE = "^0.1.0-alpha.0";

/** The workspace protocol prefix the templates use. */
const WORKSPACE_PROTOCOL = "workspace:";

/**
 * Files renamed on copy.
 *
 * `.gitignore` cannot be published to npm — the registry silently renames it to `.npmignore` on
 * publish, so a template shipping one would arrive at users without it and their `.env` would be
 * one `git add .` away from a public repository. It is committed as `gitignore` and renamed
 * here.
 */
const RENAMES: ReadonlyMap<string, string> = new Map([["gitignore", ".gitignore"]]);

/** Where the templates live, relative to the built module. */
function templatesRoot(): string {
  // `../../templates` from `dist/`, and from `src/` when running unbuilt.
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    resolve(here, "..", "templates"),
    resolve(here, "..", "..", "templates"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("create-movo-app could not locate its templates directory.");
}

/** Options for {@link scaffold}. */
export interface ScaffoldOptions {
  /** Absolute or relative path of the directory to create. */
  readonly target: string;
  /** Which template. */
  readonly template: TemplateName;
  /** The generated project's package name. Defaults to the target directory's basename. */
  readonly name?: string;
  /**
   * Replace `workspace:*` with `file:` links into this monorepo instead of a published range.
   *
   * Used by the automated scaffold test, so it installs and typechecks against the code in the
   * working tree rather than against the registry. A scaffold test that resolved published
   * packages would pass on a broken branch.
   */
  readonly linkWorkspace?: string;
  /** Base directory for relative targets. Defaults to `process.cwd()`. */
  readonly cwd?: string;
}

/** What {@link scaffold} produced. */
export interface ScaffoldResult {
  readonly root: string;
  readonly name: string;
  readonly template: TemplateName;
  readonly files: readonly string[];
}

/**
 * Rewrite a template manifest for a generated project.
 *
 * @param manifest - The parsed template `package.json`
 * @param name - The generated project's name
 * @param linkWorkspace - Monorepo root to link against, or undefined for published ranges
 * @returns The rewritten manifest
 */
export function rewriteManifest(
  manifest: Record<string, unknown>,
  name: string,
  linkWorkspace?: string,
): Record<string, unknown> {
  const rewritten: Record<string, unknown> = {
    ...manifest,
    name,
    // A generated project is the user's, not ours.
    version: "0.1.0",
    private: true,
  };
  delete rewritten["license"];

  for (const field of ["dependencies", "devDependencies"]) {
    const block = manifest[field];
    if (typeof block !== "object" || block === null) continue;

    const updated: Record<string, string> = {};
    for (const [dependency, range] of Object.entries(block as Record<string, string>)) {
      if (!range.startsWith(WORKSPACE_PROTOCOL)) {
        updated[dependency] = range;
        continue;
      }

      updated[dependency] =
        linkWorkspace === undefined
          ? DEFAULT_DEPENDENCY_RANGE
          : `file:${join(linkWorkspace, "packages", dependency.replace("@movoframework/", ""))}`;
    }
    rewritten[field] = updated;
  }

  return rewritten;
}

function listFiles(directory: string, base: string, into: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      listFiles(path, base, into);
      continue;
    }
    into.push(
      path
        .slice(base.length + 1)
        .split("\\")
        .join("/"),
    );
  }
}

/**
 * Create a project from a template.
 *
 * @param options - Target, template, name and link mode
 * @returns What was created
 */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const cwd = options.cwd ?? process.cwd();
  const root = resolve(cwd, options.target);
  const name = options.name ?? root.split(/[\\/]/).pop() ?? "movo-app";

  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(
      `${root} already exists and is not empty. Choose a different directory, or remove it first — refusing rather than merging into it, because a half-overwritten project is worse than either outcome.`,
    );
  }

  const source = join(templatesRoot(), options.template);
  if (!existsSync(source)) {
    throw new Error(`Unknown template ${JSON.stringify(options.template)}.`);
  }

  mkdirSync(root, { recursive: true });
  cpSync(source, root, {
    recursive: true,
    // The workspace install put a `node_modules` inside every template. Copying it would produce
    // a project wired to the monorepo rather than to its own install.
    filter: (from) => !from.includes(`${"node_modules"}`) && !from.endsWith(".tsbuildinfo"),
  });

  for (const [from, to] of RENAMES) {
    const path = join(root, from);
    if (!existsSync(path)) continue;
    writeFileSync(join(root, to), readFileSync(path, "utf8"), "utf8");
    rmSync(path);
  }

  // The manifest.
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  writeFileSync(
    manifestPath,
    `${JSON.stringify(rewriteManifest(manifest, name, options.linkWorkspace), null, 2)}\n`,
    "utf8",
  );

  // The template's tsconfig extends the monorepo's base, which will not exist in a generated
  // project. It is replaced with a self-contained one carrying the same settings that matter.
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(GENERATED_TSCONFIG, null, 2)}\n`,
    "utf8",
  );

  // The README's title.
  const readmePath = join(root, "README.md");
  if (existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      readFileSync(readmePath, "utf8").replaceAll("{{projectName}}", name),
      "utf8",
    );
  }

  const files: string[] = [];
  listFiles(root, root, files);

  return { root, name, template: options.template, files: files.sort() };
}

/**
 * The `tsconfig.json` a generated project gets.
 *
 * Written out rather than copied because the template's own extends the monorepo base, which a
 * generated project has no access to. The strictness is deliberately kept: a payment API is the
 * wrong place to discover that a value was `undefined` all along.
 */
export const GENERATED_TSCONFIG = {
  compilerOptions: {
    target: "es2023",
    lib: ["es2023"],
    module: "nodenext",
    moduleResolution: "nodenext",
    types: ["node"],
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    noPropertyAccessFromIndexSignature: true,
    noImplicitOverride: true,
    verbatimModuleSyntax: true,
    // Node's type stripping does not rewrite module specifiers, so `./app.js` would not resolve
    // in a project that has no build step. The files import `./app.ts` directly, and this is
    // what lets TypeScript agree with what Node actually does.
    erasableSyntaxOnly: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["src/**/*.ts", "movo.config.ts"],
} as const;
