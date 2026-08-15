/**
 * `movo doctor` — the flagship command.
 *
 * The framework's claim is that the project layer and the diagnostics are the missing piece.
 * This command is where that claim is delivered or lost, so two things matter more than the
 * feature list.
 *
 * **Every failure carries its remedy.** A doctor that reports "trustline check failed" has
 * moved the problem, not solved it. Each finding prints the `fix` its library attached, and the
 * fixes name the actual thing to do — friendbot's URL, Circle's faucet, the config key.
 *
 * **Nothing it prints can be a credential.** The command exists to print configuration, which
 * makes it the single most likely place in the product for a secret to escape. The rendering
 * path handles that (`renderConfig`), and AC5.4 asserts it byte-for-byte rather than trusting
 * the reasoning.
 */

import type { Finding, FindingLevel } from "@movoframework/core";
import { DOCTOR_CHECK_IDS, type DoctorReport, exceedsThreshold, runDoctor } from "../doctor/run.js";
import { loadProject } from "../project.js";
import { configRows, renderConfig, renderFindings } from "../render/findings.js";
import type { Styler } from "../render/style.js";
import type { CommandContext } from "./context.js";

/** The `--json` payload. Stable: this is a machine interface (spec §5.12). */
export interface DoctorJson {
  readonly ok: boolean;
  readonly findings: readonly {
    readonly id: string;
    readonly level: FindingLevel;
    readonly title: string;
    readonly detail: string;
    readonly fix?: string;
    readonly docs?: string;
    readonly group: string;
  }[];
  readonly config: readonly {
    readonly key: string;
    readonly value: string;
    readonly source: string;
  }[];
}

function summarise(findings: readonly Finding[]): Record<FindingLevel, number> {
  const counts: Record<FindingLevel, number> = { ok: 0, warn: 0, error: 0 };
  for (const finding of findings) counts[finding.level] += 1;
  return counts;
}

/**
 * Build the `--json` payload.
 *
 * Shares `configRows` with the human table, so a value that is hidden in one is hidden in the
 * other — the alternative is two serialisers and one of them eventually printing the credential
 * the other suppresses.
 *
 * @param report - The doctor report
 * @returns The payload
 */
export function toJson(report: DoctorReport): DoctorJson {
  return {
    ok: report.ok,
    findings: report.groups.flatMap((group) =>
      group.findings.map((finding) => ({
        id: finding.id,
        level: finding.level,
        title: finding.title,
        detail: finding.detail,
        ...(finding.fix === undefined ? {} : { fix: finding.fix }),
        ...(finding.docs === undefined ? {} : { docs: finding.docs }),
        group: group.title,
      })),
    ),
    config: configRows(report.config),
  };
}

/** Parsed `movo doctor` flags. */
export interface DoctorOptions {
  readonly json?: boolean;
  readonly check?: readonly string[];
  readonly failOn?: Exclude<FindingLevel, "ok">;
  readonly timeoutMs?: number;
}

function renderHuman(report: DoctorReport, style: Styler): string {
  const out: string[] = [];

  out.push("");
  out.push(style.bold("Resolved configuration"));
  out.push(renderConfig(report.config, style));

  for (const group of report.groups) {
    if (group.findings.length === 0) continue;
    out.push(style.bold(group.title));
    out.push(renderFindings(group.findings, style));
  }

  const counts = summarise(report.findings);
  const parts = [
    style.green(`${String(counts.ok)} ok`),
    style.yellow(`${String(counts.warn)} warning`),
    style.red(`${String(counts.error)} error`),
  ];
  out.push(`${parts.join("  ")}`);
  out.push("");

  return out.join("\n");
}

/**
 * Run `movo doctor`.
 *
 * @param options - Parsed flags
 * @param context - Streams, environment and styling
 * @returns The process exit code
 */
export async function doctorCommand(
  options: DoctorOptions,
  context: CommandContext,
): Promise<number> {
  const unknown = (options.check ?? []).filter((id) => !DOCTOR_CHECK_IDS.includes(id));
  if (unknown.length > 0) {
    // Failing rather than ignoring: a typo in `--check stellar.trustlien` that silently ran
    // nothing would report a clean bill of health for a check that never executed.
    context.stderr(
      `Unknown check id(s): ${unknown.join(", ")}\nAvailable: ${DOCTOR_CHECK_IDS.join(", ")}\n`,
    );
    return 2;
  }

  const failOn = options.failOn ?? "error";

  const project = await loadProject({ cwd: context.cwd, env: context.env });
  const report = await runDoctor(project, {
    ...(options.check === undefined ? {} : { only: options.check }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    failOn,
  });

  if (options.json === true) {
    context.stdout(`${JSON.stringify(toJson(report), null, 2)}\n`);
  } else {
    context.stdout(renderHuman(report, context.style));
  }

  return exceedsThreshold(report.findings, failOn) ? 1 : 0;
}
