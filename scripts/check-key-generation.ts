/**
 * check-key-generation — Movo never generates, derives, or persists a private key.
 *
 * Movo's server and testing layers may receive a signer from an operator or test author, but
 * must not manufacture one. This scans shipped packages and executable tests; fixtures are
 * excluded because proof-of-failure source must be able to contain the prohibited spellings.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

/** One prohibited key-generation API, defined once for the gate and its fixture. */
export const KEY_GENERATION_API = "Keypair.random";
export const KEY_GENERATION_PATTERN = new RegExp(
  `\\b${KEY_GENERATION_API.replace(".", "\\.")}\\s*\\(`,
);
export const KEY_GENERATION_FAILURE = "key generation gate FAILED";

export interface KeyGenerationViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function sources(directory: string, files: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === "fixtures") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) sources(path, files);
    else if (entry.endsWith(".ts")) files.push(path);
  }
  return files;
}

/** Scan a repository-shaped root for prohibited keypair construction. */
export function checkKeyGeneration(root: string): KeyGenerationViolation[] {
  const files = [...sources(join(root, "packages"), []), ...sources(join(root, "tests"), [])];
  const violations: KeyGenerationViolation[] = [];
  for (const file of files) {
    for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
      if (KEY_GENERATION_PATTERN.test(line)) {
        violations.push({
          file: relative(root, file).split(sep).join("/"),
          line: index + 1,
          text: line.trim(),
        });
      }
    }
  }
  return violations;
}

function main(): void {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const root = resolve(values.root ?? REPO_ROOT);
  const violations = checkKeyGeneration(root);
  for (const violation of violations) {
    process.stdout.write(
      `  VIOLATION ${violation.file}:${String(violation.line)} ${violation.text}\n`,
    );
  }
  if (violations.length > 0) {
    process.stderr.write(
      `${KEY_GENERATION_FAILURE}: ${String(violations.length)} prohibited API call(s).\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    "key generation gate PASSED: no keypair generation in packages or executable tests.\n",
  );
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) main();
