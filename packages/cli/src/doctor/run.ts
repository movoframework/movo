/**
 * `movo doctor` — the check runner.
 *
 * **This file composes. It decides nothing.** Every check it runs is a library export:
 * `checkNodeVersion` and `checkPinDrift` from `@movoframework/core`, the six preflight checks
 * from `@movoframework/stellar`, `validateDiscoveryStrict` from `@movoframework/bazaar`, and
 * compilation's own static diagnostics. No check logic lives here, because a check that exists
 * only inside a CLI command cannot be run by a downstream project's CI — and "run our payment
 * preflight in our own pipeline" is the first thing a team adopting this will want (M5's
 * ARCHITECTURAL RULE, spec §5.12).
 *
 * What this file does own is **sequencing and policy**: which group runs first, and how a set of
 * findings becomes an exit code. That is genuinely CLI-shaped. `Finding.level` is data about
 * the world; whether a `warn` should fail a build is the caller's decision, which is why
 * `--fail-on` is a flag and not a library constant (spec §5.6).
 */

import { attachDiscovery } from "@movoframework/bazaar";
import {
  checkNodeVersion,
  checkPinDrift,
  compileApp,
  type Finding,
  type FindingLevel,
  isMovoError,
  type ResolvedConfig,
} from "@movoframework/core";
import { ALL_CHECKS, CHECK_IDS, checks as stellarChecks } from "@movoframework/stellar";
import type { Project } from "../project.js";
import { collectPinComparisons } from "./pins.js";

/**
 * Every check `movo doctor` can run, in run order. Stable: `--check` filters on these.
 *
 * The Stellar entries are the **dotted finding ids** (`stellar.trustline`), not the library's
 * internal short names (`trustline`). They have to be the same strings the findings carry:
 * `movo doctor --json` reports `id: "stellar.trustline"`, and a reader who filters on that and
 * then tries `--check stellar.trustline` must not be told the id does not exist. One vocabulary,
 * used by both halves of the interface.
 */
export const DOCTOR_CHECK_IDS: readonly string[] = [
  "node",
  "pins",
  "config",
  ...ALL_CHECKS.map((check) => CHECK_IDS[check]),
  "bazaar",
];

/** A group of findings sharing a heading. */
export interface FindingGroup {
  readonly title: string;
  readonly findings: readonly Finding[];
}

/** What a doctor run produced. */
export interface DoctorReport {
  readonly ok: boolean;
  readonly groups: readonly FindingGroup[];
  readonly findings: readonly Finding[];
  readonly config: ResolvedConfig;
}

/** Options for {@link runDoctor}. */
export interface RunDoctorOptions {
  /** Restrict the run to these check ids. Defaults to all of them. */
  readonly only?: readonly string[];
  /** Bound on each network call, forwarded to preflight. */
  readonly timeoutMs?: number;
  /** Injectable fetch, so the facilitator check is testable without a network. */
  readonly fetch?: typeof globalThis.fetch;
  /** Injectable clock, for the skew check. */
  readonly now?: () => number;
  /** The level at or above which the run is not `ok`. Defaults to `error`. */
  readonly failOn?: Exclude<FindingLevel, "ok">;
}

const RANK: Readonly<Record<FindingLevel, number>> = { ok: 0, warn: 1, error: 2 };

/**
 * Is any finding at or above the threshold?
 *
 * @param findings - The findings
 * @param failOn - The threshold level
 * @returns Whether the run should be considered a failure
 */
export function exceedsThreshold(
  findings: readonly Finding[],
  failOn: Exclude<FindingLevel, "ok">,
): boolean {
  return findings.some((finding) => RANK[finding.level] >= RANK[failOn]);
}

function selected(only: readonly string[] | undefined, id: string): boolean {
  return only === undefined || only.includes(id);
}

/**
 * Turn a thrown error into a finding.
 *
 * Compilation throws — a route with no price is a `MovoError`, not a warning — but a doctor run
 * that aborted on the first throw would report one problem and hide the rest, which is the
 * opposite of what a diagnostic command is for. The throw is caught here and rendered as an
 * error-level finding so the remaining checks still run.
 */
function findingFromThrow(id: string, title: string, error: unknown): Finding {
  if (isMovoError(error)) {
    return {
      id,
      level: "error",
      title,
      detail: error.message,
      fix: error.fix,
      docs: error.docs,
    };
  }

  return {
    id,
    level: "error",
    title,
    detail: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Run the checks against a loaded project.
 *
 * Groups run in order of how fundamental their failures are: environment, then configuration,
 * then the network-dependent Stellar checks, then discovery. A developer whose Node is too old
 * should read that first rather than after six timeouts caused by it.
 *
 * @param project - The loaded project
 * @param options - Which checks to run and how to reach the network
 * @returns The grouped report
 */
export async function runDoctor(
  project: Project,
  options?: RunDoctorOptions,
): Promise<DoctorReport> {
  const only = options?.only;
  const groups: FindingGroup[] = [];

  // ── Environment ────────────────────────────────────────────────────────────────────────
  const environment: Finding[] = [];
  if (selected(only, "node")) environment.push(checkNodeVersion(process.version));
  if (selected(only, "pins")) environment.push(checkPinDrift(collectPinComparisons(project.root)));
  if (environment.length > 0) groups.push({ title: "Environment", findings: environment });

  // ── Configuration and compilation ──────────────────────────────────────────────────────
  //
  // `resolveConfig` already ran in `loadProject` — reaching this point at all means the pubnet
  // interlock, the network identifier, the payTo format and the secret-in-config rule all
  // passed, because each of those throws. Compilation is what remains: prices, duplicate
  // routes, wildcard paths, undescribed parameters.
  let compiled: ReturnType<typeof compileApp> | undefined;
  if (selected(only, "config")) {
    const configFindings: Finding[] = [
      {
        id: "config.resolved",
        level: "ok",
        title: "configuration resolves",
        detail: `Loaded ${project.configPath}; env ${project.resolved.env.value}, network ${project.resolved.network.value}.`,
      },
    ];

    if (project.app !== undefined) {
      try {
        compiled = compileApp(project.app, project.layers);
        configFindings.push({
          id: "config.compiled",
          level: "ok",
          title: "resources compile",
          detail: `${String(compiled.handlers.size)} paid route(s).`,
        });
        configFindings.push(...compiled.diagnostics);
      } catch (error) {
        configFindings.push(findingFromThrow("config.compiled", "resources compile", error));
      }
    }

    groups.push({ title: "Configuration", findings: configFindings });
  }

  // ── Stellar preflight ──────────────────────────────────────────────────────────────────
  //
  // Sequential, and that is `preflight`'s deliberate design rather than an oversight: `account`
  // before `trustline` before `asset` means the first failure shown is the most fundamental
  // one, instead of three findings all describing the same missing account.
  const stellar: Finding[] = [];
  for (const id of ALL_CHECKS) {
    // Selected by the dotted finding id, which is what the user typed and what `--json` reports.
    if (!selected(only, CHECK_IDS[id])) continue;
    stellar.push(
      await stellarChecks[id](project.resolved, {
        ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options?.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options?.now === undefined ? {} : { now: options.now }),
      }),
    );
  }
  if (stellar.length > 0) groups.push({ title: "Stellar", findings: stellar });

  // ── Bazaar discovery ───────────────────────────────────────────────────────────────────
  //
  // Escalation runs against the compiled app, so it needs compilation to have succeeded. When
  // it did not, saying so is more useful than reporting no discovery problems — an empty result
  // would read as "your metadata is fine".
  if (selected(only, "bazaar")) {
    const discovery: Finding[] = [];

    if (project.app === undefined) {
      discovery.push({
        id: "bazaar.skipped",
        level: "ok",
        title: "discovery metadata",
        detail: "No app module found, so there is no discovery metadata to validate.",
      });
    } else if (compiled === undefined) {
      discovery.push({
        id: "bazaar.skipped",
        level: "warn",
        title: "discovery metadata",
        detail: "Not checked: the resources did not compile.",
        fix: "Fix the compilation errors above, then run `movo doctor` again.",
      });
    } else {
      // Derivation must run before validation: upstream's spec validator reads
      // `route.extensions`, which does not exist on a freshly compiled app. Validating without
      // deriving first would report nothing and read as "your metadata is fine".
      const findings = await attachDiscovery(compiled);
      discovery.push(
        ...(findings.length > 0
          ? findings
          : [
              {
                id: "bazaar.valid",
                level: "ok" as const,
                title: "discovery metadata",
                detail: `${String(compiled.discoveryDeclared.length)} resource(s) declare discovery; upstream validation raised nothing.`,
              },
            ]),
      );
    }

    groups.push({ title: "Discovery", findings: discovery });
  }

  const findings = groups.flatMap((group) => group.findings);

  return {
    ok: !exceedsThreshold(findings, options?.failOn ?? "error"),
    groups,
    findings,
    config: project.resolved,
  };
}
