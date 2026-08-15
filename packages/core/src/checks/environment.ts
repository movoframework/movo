/**
 * Environment checks — the two `movo doctor` runs before it touches the network.
 *
 * **These live in the library, not in the CLI, and that placement is load-bearing.** The M5
 * architectural rule is that every check `movo doctor` runs must already be callable
 * programmatically, because a check that exists only inside a CLI command cannot be run by a
 * downstream project's own CI. A team that wants "fail the build if our x402 pins drifted"
 * should not have to shell out to `movo doctor --json` and parse it.
 *
 * **They are pure functions over injected data.** `@movoframework/core` performs no filesystem
 * or network I/O — that is what lets the unit suite stay hermetic and lets the compiler analyse
 * a project statically. So the CLI reads `process.version` and the installed `package.json`
 * files, and passes the values in. The *reading* is environment access; the *judgement* — what
 * counts as drift, how serious it is, what to do about it — is the check, and the check is
 * here.
 *
 * @see spec §5.12, §5.6
 */

import { type Finding, findingFromCode } from "../diagnostics.js";

/**
 * The lowest Node major Movo is tested against.
 *
 * Node 22 is not an arbitrary floor. It is the first release line where native TypeScript type
 * stripping is available, which is what allows a scaffolded project to run `src/server.ts`
 * directly with no build step — the property the whole quickstart depends on.
 */
export const MINIMUM_NODE_MAJOR = 22;

/** Stable finding ids, so a CI configuration can filter on them. */
export const ENVIRONMENT_CHECK_IDS = {
  node: "env.node-version",
  pins: "env.x402-pins",
} as const;

/**
 * Parse the major version out of a Node version string.
 *
 * @param version - A version string such as `v24.14.0` or `24.14.0`
 * @returns The major version, or undefined when the string is not a version
 */
export function nodeMajorOf(version: string): number | undefined {
  const match = /^v?(\d+)\./.exec(version);
  const major = match?.[1];
  if (major === undefined) return undefined;
  const parsed = Number.parseInt(major, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Is the running Node new enough?
 *
 * @param version - The running version, normally `process.version`
 * @param minimumMajor - The lowest acceptable major
 * @returns One finding, `ok` or `warn`
 */
export function checkNodeVersion(
  version: string,
  minimumMajor: number = MINIMUM_NODE_MAJOR,
): Finding {
  const major = nodeMajorOf(version);

  if (major === undefined) {
    return {
      id: ENVIRONMENT_CHECK_IDS.node,
      level: "warn",
      title: "Node.js version",
      detail: `Could not read a major version from ${JSON.stringify(version)}.`,
      fix: `Movo is tested on Node ${String(minimumMajor)} and later.`,
    };
  }

  if (major >= minimumMajor) {
    return {
      id: ENVIRONMENT_CHECK_IDS.node,
      level: "ok",
      title: "Node.js version",
      detail: `${version} (minimum ${String(minimumMajor)}).`,
    };
  }

  return findingFromCode(
    "MOVO_W_NODE_VERSION_UNSUPPORTED",
    ENVIRONMENT_CHECK_IDS.node,
    "Node.js version",
    `Running ${version}; Movo is tested on ${String(minimumMajor)} and later.`,
  );
}

/** An `@x402/*` package, as installed and as documented. */
export interface PinComparison {
  readonly name: string;
  /** The version actually resolved in `node_modules`, or undefined when not installed. */
  readonly installed: string | undefined;
  /** The version `docs/COMPATIBILITY.md` records, or undefined when the matrix omits it. */
  readonly documented: string | undefined;
}

/**
 * Compare installed `@x402/*` versions against the recorded compatibility matrix.
 *
 * Returns **one** finding rather than one per package, because the remedy is the same for all
 * of them and a doctor run listing five identical warnings buries the four other checks.
 *
 * A package that is installed but absent from the matrix counts as drift: the matrix is
 * generated evidence (spec §1.14), and a dependency it does not mention is one no conformance
 * run covered. A package documented but not installed also counts, for the same reason in
 * reverse.
 *
 * @param comparisons - One entry per `@x402/*` package known to either side
 * @returns A single finding, `ok` when every pair agrees
 */
export function checkPinDrift(comparisons: readonly PinComparison[]): Finding {
  if (comparisons.length === 0) {
    return {
      id: ENVIRONMENT_CHECK_IDS.pins,
      level: "warn",
      title: "@x402/* versions match docs/COMPATIBILITY.md",
      detail:
        "No @x402/* packages were found, either installed or in the compatibility matrix. Nothing was compared.",
      fix: "Run `pnpm install`, then regenerate the matrix with `pnpm generate:compat`. A pin check that compares nothing reports success without checking anything.",
    };
  }

  const drifted = comparisons.filter(
    (comparison) => comparison.installed !== comparison.documented,
  );

  if (drifted.length === 0) {
    return {
      id: ENVIRONMENT_CHECK_IDS.pins,
      level: "ok",
      title: "@x402/* versions match docs/COMPATIBILITY.md",
      detail: `${String(comparisons.length)} package(s) match: ${comparisons
        .map((comparison) => `${comparison.name}@${comparison.installed ?? "?"}`)
        .join(", ")}.`,
    };
  }

  const detail = drifted
    .map(
      (comparison) =>
        `${comparison.name}: installed ${comparison.installed ?? "(absent)"}, matrix records ${comparison.documented ?? "(absent)"}`,
    )
    .join("; ");

  return findingFromCode(
    "MOVO_W_X402_PIN_DRIFT",
    ENVIRONMENT_CHECK_IDS.pins,
    "@x402/* versions match docs/COMPATIBILITY.md",
    `${String(drifted.length)} of ${String(comparisons.length)} differ — ${detail}.`,
  );
}
