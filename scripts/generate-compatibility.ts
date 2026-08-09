/**
 * generate-compatibility — writes docs/COMPATIBILITY.md.
 *
 * The compatibility matrix is GENERATED and must never be hand-edited (spec §1.14). Two
 * facts about the environment change independently of Movo and both are load-bearing: the
 * exact `@x402/*` versions resolved in the lockfile, and what the configured facilitator
 * actually advertises at `/supported`. Hand-maintaining either produces a document that is
 * confidently wrong, which is worse than no document at all in a payments codebase.
 *
 * The live payload is embedded verbatim as well as summarised, so that an upstream shape
 * change is visible in the diff even if this script's summariser does not understand it yet.
 *
 * Usage:
 *   node scripts/generate-compatibility.ts
 *   MOVO_FACILITATOR_URL=https://example.test/facilitator node scripts/generate-compatibility.ts
 *   node scripts/generate-compatibility.ts --stdout      # print, do not write
 */

import { readdirSync, readFileSync, type Stats, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT: string = resolve(fileURLToPath(import.meta.url), "..", "..");

export const DEFAULT_FACILITATOR_URL = "https://www.x402.org/facilitator";

export interface InstalledPackage {
  readonly name: string;
  readonly versions: readonly string[];
}

export interface SupportedKind {
  readonly x402Version?: number;
  readonly scheme?: string;
  readonly network?: string;
  readonly extra?: { readonly [key: string]: unknown };
}

export interface SupportedPayload {
  readonly x402Version?: number;
  readonly kinds?: readonly SupportedKind[];
}

export interface ToolchainVersions {
  readonly node: string;
  readonly typescript: string;
  readonly pnpm: string;
}

export interface GenerateOptions {
  /** Directories to search for installed `@x402/*` packages. */
  readonly moduleRoots: readonly string[];
  readonly facilitatorUrl: string;
  readonly supported: SupportedPayload;
  readonly toolchain: ToolchainVersions;
  readonly generatedAt: string;
}

/**
 * Find every installed `@x402/*` package under the given roots.
 *
 * pnpm links workspace dependencies into each package's own `node_modules`, so a single
 * lookup at the repository root would miss packages depended on by a workspace member only.
 * More than one version for a name is not an error here — it is reported, because a split
 * `@x402/*` resolution is exactly the drift this document exists to surface.
 */
export function collectX402Packages(moduleRoots: readonly string[]): InstalledPackage[] {
  const versions = new Map<string, Set<string>>();

  for (const root of moduleRoots) {
    const scopeDirectory = join(root, "@x402");
    let entries: string[];
    try {
      entries = readdirSync(scopeDirectory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const manifestPath = join(scopeDirectory, entry, "package.json");
      let stats: Stats | undefined;
      try {
        stats = statSync(manifestPath, { throwIfNoEntry: false });
      } catch {
        continue;
      }
      if (stats === undefined || !stats.isFile()) continue;

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          name?: string;
          version?: string;
        };
        if (typeof manifest.name !== "string" || typeof manifest.version !== "string") continue;
        const bucket = versions.get(manifest.name) ?? new Set<string>();
        bucket.add(manifest.version);
        versions.set(manifest.name, bucket);
      } catch {}
    }
  }

  return [...versions.entries()]
    .map(([name, set]) => ({ name, versions: [...set].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Every `node_modules` directory in the workspace that could hold an `@x402/*` package. */
export function workspaceModuleRoots(repoRoot: string): string[] {
  const roots = [join(repoRoot, "node_modules")];
  const packagesDirectory = join(repoRoot, "packages");
  let entries: string[] = [];
  try {
    entries = readdirSync(packagesDirectory);
  } catch {
    return roots;
  }
  for (const entry of entries) {
    roots.push(join(packagesDirectory, entry, "node_modules"));
  }
  return roots;
}

export async function fetchSupported(facilitatorUrl: string): Promise<SupportedPayload> {
  const url = `${facilitatorUrl.replace(/\/+$/, "")}/supported`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as SupportedPayload;
}

export function readToolchainVersions(repoRoot: string): ToolchainVersions {
  let typescript = "unknown";
  try {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "node_modules", "typescript", "package.json"), "utf8"),
    ) as { version?: string };
    typescript = manifest.version ?? "unknown";
  } catch {
    typescript = "unknown";
  }

  let pnpm = "unknown";
  try {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      packageManager?: string;
    };
    pnpm = manifest.packageManager?.replace(/^pnpm@/, "") ?? "unknown";
  } catch {
    pnpm = "unknown";
  }

  return { node: process.version, typescript, pnpm };
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

export function renderCompatibility(options: GenerateOptions): string {
  const installed = collectX402Packages(options.moduleRoots);
  const kinds = options.supported.kinds ?? [];

  const advertisedVersions = unique(
    kinds.map((kind) => (kind.x402Version === undefined ? undefined : String(kind.x402Version))),
  );
  const protocolVersion =
    options.supported.x402Version !== undefined
      ? String(options.supported.x402Version)
      : advertisedVersions.join(", ") || "not advertised";

  const networks = unique(kinds.map((kind) => kind.network));
  const schemes = unique(kinds.map((kind) => kind.scheme));

  const stellarKinds = kinds.filter((kind) => (kind.network ?? "").startsWith("stellar:"));

  const extraFlags = new Map<string, string>();
  for (const kind of kinds) {
    if (kind.extra === undefined) continue;
    for (const [key, value] of Object.entries(kind.extra)) {
      const scope = `${kind.scheme ?? "?"} @ ${kind.network ?? "?"}`;
      extraFlags.set(`${scope} · ${key}`, JSON.stringify(value));
    }
  }

  const lines: string[] = [];
  lines.push("# Compatibility matrix");
  lines.push("");
  lines.push(
    "<!-- GENERATED FILE — DO NOT EDIT BY HAND. Regenerate with `pnpm generate:compat`. -->",
  );
  lines.push("");
  lines.push(`Generated at **${options.generatedAt}**.`);
  lines.push("");
  lines.push(
    "This file records what was actually installed and what the configured facilitator " +
      "actually advertised at the moment of generation. It is evidence, not intent; where it " +
      "disagrees with the architecture specification, this file is the one describing reality.",
  );
  lines.push("");

  lines.push("## Installed `@x402/*` packages");
  lines.push("");
  if (installed.length === 0) {
    lines.push("No `@x402/*` package is installed in this workspace.");
  } else {
    lines.push("| Package | Installed version(s) |");
    lines.push("|---|---|");
    for (const entry of installed) {
      const rendered = entry.versions.map((version) => `\`${version}\``).join(", ");
      const drift = entry.versions.length > 1 ? " ⚠️ **split resolution**" : "";
      lines.push(`| \`${entry.name}\` | ${rendered}${drift} |`);
    }
  }
  lines.push("");
  lines.push(
    "`@x402/*` versions are exact-pinned (spec §1.13). A bump is a dedicated PR that " +
      "regenerates this file and re-runs the conformance workflow.",
  );
  lines.push("");

  lines.push("## Toolchain");
  lines.push("");
  lines.push("| Component | Version |");
  lines.push("|---|---|");
  lines.push(`| Node.js (generating host) | \`${options.toolchain.node}\` |`);
  lines.push("| Node.js (supported) | `22`, `24`, `26` — CI matrix |");
  lines.push(`| TypeScript | \`${options.toolchain.typescript}\` |`);
  lines.push(`| pnpm | \`${options.toolchain.pnpm}\` |`);
  lines.push("");

  lines.push("## Facilitator");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push("|---|---|");
  lines.push(`| URL | \`${options.facilitatorUrl}\` |`);
  lines.push(`| Advertised x402 protocol version | \`${protocolVersion}\` |`);
  lines.push(`| Advertised kinds | ${kinds.length} |`);
  lines.push("");

  lines.push("### Supported networks");
  lines.push("");
  lines.push(
    networks.length === 0 ? "None advertised." : networks.map((n) => `- \`${n}\``).join("\n"),
  );
  lines.push("");

  lines.push("### Supported schemes");
  lines.push("");
  lines.push(
    schemes.length === 0 ? "None advertised." : schemes.map((s) => `- \`${s}\``).join("\n"),
  );
  lines.push("");

  lines.push("### Stellar kinds");
  lines.push("");
  if (stellarKinds.length === 0) {
    lines.push(
      "**This facilitator advertises no Stellar network.** Movo targets Stellar; a " +
        "facilitator without a `stellar:*` kind cannot settle a Movo payment.",
    );
  } else {
    lines.push("| Scheme | Network | `extra` |");
    lines.push("|---|---|---|");
    for (const kind of stellarKinds) {
      const extra = kind.extra === undefined ? "—" : `\`${JSON.stringify(kind.extra)}\``;
      lines.push(`| \`${kind.scheme ?? "?"}\` | \`${kind.network ?? "?"}\` | ${extra} |`);
    }
  }
  lines.push("");

  lines.push("### `extra` flags across all kinds");
  lines.push("");
  if (extraFlags.size === 0) {
    lines.push("No kind advertises an `extra` block.");
  } else {
    lines.push("| Kind · flag | Value |");
    lines.push("|---|---|");
    for (const [key, value] of [...extraFlags.entries()].sort()) {
      lines.push(`| ${key} | \`${value}\` |`);
    }
  }
  lines.push("");

  lines.push("## Raw `/supported` payload");
  lines.push("");
  lines.push(
    "Embedded verbatim so that an upstream shape change is visible in the diff even if the " +
      "summary above does not yet understand it.",
  );
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(options.supported, null, 2));
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { stdout: { type: "boolean", default: false } } });

  const facilitatorUrl = process.env["MOVO_FACILITATOR_URL"] ?? DEFAULT_FACILITATOR_URL;

  let supported: SupportedPayload;
  try {
    supported = await fetchSupported(facilitatorUrl);
  } catch (error) {
    process.stderr.write(
      `generate:compat FAILED: could not read /supported from ${facilitatorUrl}\n` +
        `  ${error instanceof Error ? error.message : String(error)}\n\n` +
        "The compatibility matrix records observed reality, so it is not written from a\n" +
        "cached or assumed payload. Set MOVO_FACILITATOR_URL to a reachable facilitator, or\n" +
        "retry when the service is available.\n",
    );
    process.exit(1);
    return;
  }

  const markdown = renderCompatibility({
    moduleRoots: workspaceModuleRoots(REPO_ROOT),
    facilitatorUrl,
    supported,
    toolchain: readToolchainVersions(REPO_ROOT),
    generatedAt: new Date().toISOString(),
  });

  if (values.stdout === true) {
    process.stdout.write(markdown);
    return;
  }

  const target = join(REPO_ROOT, "docs", "COMPATIBILITY.md");
  writeFileSync(target, markdown, "utf8");
  process.stdout.write(`wrote ${target}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}
