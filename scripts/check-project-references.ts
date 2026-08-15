/**
 * check-project-references — every workspace dependency is also a TypeScript project reference.
 *
 * `tsc --build` derives its build order from each project's own `references`, never from the
 * order projects appear in the root tsconfig. A project that declares a `workspace:*` dependency
 * but no matching reference is therefore treated as dependency-free and can be scheduled ahead
 * of the package whose `dist/*.d.ts` its imports resolve to.
 *
 * The failure is invisible on a warm tree, because a previous build has already emitted those
 * declarations. Only a clean checkout hits it, so it reaches CI before it reaches a developer —
 * which is exactly what happened to `packages/testing` at M4.
 *
 * The inverse is also a violation: a reference to a package that is not a declared dependency
 * makes the build order depend on something the manifest does not record, so the two drift.
 *
 * Usage:
 *   node scripts/check-project-references.ts                 # this repository
 *   node scripts/check-project-references.ts --root <dir>    # any repository-shaped directory
 *   node scripts/check-project-references.ts --json
 *
 * `--root` exists so the gate can be pointed at tests/fixtures/project-references/*, which is
 * how it is proven to fire.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT: string = resolve(fileURLToPath(import.meta.url), "..", "..");

/** Directories scanned for projects, relative to the root. */
const PROJECT_PARENTS: readonly string[] = ["packages", "examples"];

/** The protocol marking a dependency as resolved from this workspace rather than the registry. */
const WORKSPACE_PROTOCOL = "workspace:";

/**
 * Manifest fields carrying a workspace dependency that a project's own sources may import.
 *
 * `peerDependencies` is excluded deliberately: a peer is supplied by the consumer, and a
 * reference to one would make this project's build order depend on a package it does not
 * itself install.
 */
const DEPENDENCY_FIELDS: readonly string[] = ["dependencies", "devDependencies"];

export interface ReferenceViolation {
  readonly project: string;
  readonly rule: "missing-reference" | "dangling-reference" | "unreadable-tsconfig";
  readonly detail: string;
  readonly why: string;
}

export interface ReferenceReport {
  readonly scanned: number;
  /** Workspace dependencies seen across all projects — the gate's own positive baseline. */
  readonly edges: number;
  readonly violations: readonly ReferenceViolation[];
}

interface Project {
  readonly name: string;
  /** Root-relative, forward-slashed, e.g. `packages/testing`. */
  readonly directory: string;
  readonly absoluteDirectory: string;
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function readJson(path: string): { [key: string]: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as { [key: string]: unknown };
  } catch {
    return null;
  }
}

function listProjects(root: string): Project[] {
  const projects: Project[] = [];

  for (const parent of PROJECT_PARENTS) {
    const parentPath = join(root, parent);
    let entries: string[];
    try {
      entries = readdirSync(parentPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absoluteDirectory = join(parentPath, entry);
      if (!statSync(absoluteDirectory, { throwIfNoEntry: false })?.isDirectory()) continue;

      const manifest = readJson(join(absoluteDirectory, "package.json"));
      const name = manifest?.["name"];
      if (typeof name !== "string") continue;

      // A project without a tsconfig is not part of the build graph, so it has no ordering to
      // get wrong.
      if (
        statSync(join(absoluteDirectory, "tsconfig.json"), { throwIfNoEntry: false }) === undefined
      )
        continue;

      projects.push({ name, directory: `${parent}/${entry}`, absoluteDirectory });
    }
  }

  return projects;
}

/**
 * Workspace dependency names declared by a project's manifest.
 *
 * @param absoluteDirectory - The project directory
 * @returns The dependency names whose version uses the `workspace:` protocol
 */
export function workspaceDependencies(absoluteDirectory: string): string[] {
  const manifest = readJson(join(absoluteDirectory, "package.json"));
  if (manifest === null) return [];

  const names: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const block = manifest[field];
    if (typeof block !== "object" || block === null) continue;
    for (const [name, range] of Object.entries(block as { [key: string]: unknown })) {
      if (typeof range === "string" && range.startsWith(WORKSPACE_PROTOCOL)) names.push(name);
    }
  }
  return names;
}

/**
 * Project directories named by a tsconfig's `references`, resolved against the repository root.
 *
 * @param absoluteDirectory - The project directory
 * @returns Root-relative directories, or `null` when the tsconfig could not be read
 */
export function referencedDirectories(absoluteDirectory: string, root: string): string[] | null {
  const tsconfig = readJson(join(absoluteDirectory, "tsconfig.json"));
  if (tsconfig === null) return null;

  const references = tsconfig["references"];
  if (references === undefined) return [];
  if (!Array.isArray(references)) return null;

  const directories: string[] = [];
  for (const reference of references) {
    if (typeof reference !== "object" || reference === null) continue;
    const path = (reference as { path?: unknown }).path;
    if (typeof path !== "string") continue;
    directories.push(toPosix(relative(root, resolve(absoluteDirectory, path))));
  }
  return directories;
}

export function checkProjectReferences(root: string): ReferenceReport {
  const projects = listProjects(root);
  const directoryByName = new Map(projects.map((project) => [project.name, project.directory]));
  const violations: ReferenceViolation[] = [];
  let edges = 0;

  for (const project of projects) {
    const referenced = referencedDirectories(project.absoluteDirectory, root);
    if (referenced === null) {
      violations.push({
        project: project.directory,
        rule: "unreadable-tsconfig",
        detail: `${project.directory}/tsconfig.json could not be parsed, or its "references" is not an array`,
        why: "A tsconfig this gate cannot read is a tsconfig whose build order it cannot check, which would let the gate pass by failing to look.",
      });
      continue;
    }

    const expected: string[] = [];
    for (const dependency of workspaceDependencies(project.absoluteDirectory)) {
      const directory = directoryByName.get(dependency);
      // A workspace dependency on a package with no tsconfig contributes no build ordering.
      if (directory === undefined) continue;
      expected.push(directory);
      edges += 1;
    }

    for (const directory of expected) {
      if (referenced.includes(directory)) continue;
      violations.push({
        project: project.directory,
        rule: "missing-reference",
        detail: `${project.directory} depends on ${directory} but does not reference it`,
        why: "tsc --build orders projects by their own references, so an unreferenced dependency can be built after the project that imports its declarations — passing on a warm tree and failing on a clean checkout.",
      });
    }

    for (const directory of referenced) {
      if (expected.includes(directory)) continue;
      violations.push({
        project: project.directory,
        rule: "dangling-reference",
        detail: `${project.directory} references ${directory}, which is not one of its workspace dependencies`,
        why: "A reference the manifest does not record makes the build order depend on something no dependency resolver can see, so removing the dependency silently leaves the reference behind.",
      });
    }
  }

  return { scanned: projects.length, edges, violations };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const root = values.root === undefined ? REPO_ROOT : resolve(values.root);
  const report = checkProjectReferences(root);

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.violations.length === 0 ? 0 : 1);
  }

  if (report.violations.length > 0) {
    for (const violation of report.violations) {
      process.stderr.write(`  [${violation.rule}] ${violation.detail}\n      ${violation.why}\n`);
    }
    process.stderr.write(
      `\nproject references FAILED: ${report.violations.length} problem(s) across ${report.scanned} project(s).\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `project references PASSED: ${report.scanned} project(s), ${report.edges} workspace dependency edge(s) all referenced.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
