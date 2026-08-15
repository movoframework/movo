/**
 * `movo dev` — the development server.
 *
 * The boot output is the feature. A paid API has four values that decide whether a payment can
 * possibly succeed — network, `payTo`, price, facilitator — and every one of them can be set in
 * five places. Printing them with their provenance turns the single most common support
 * conversation ("it is charging the wrong account") into one line of output that says which
 * layer supplied it (ADR-0006, spec §1.17).
 *
 * **Watching uses Node's own `--watch`.** Not chokidar, not nodemon. The M5 scope names this
 * explicitly, and the reason generalises: a framework whose pitch is that the toolchain should
 * be small cannot ship a file watcher.
 *
 * **The pubnet refusal is enforced here as well as in the library.** `createInProcessFacilitator`
 * already refuses mainnet, and duplicating a check normally means one of the two will drift.
 * This one is different: the CLI refuses *before spawning a process*, so the failure arrives as
 * a message about the flag the developer typed rather than as an exception from inside a server
 * that has already opened a port and printed a banner.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compileApp,
  MovoError,
  type PaymentOption,
  STELLAR_PUBNET_CAIP2,
} from "@movoframework/core";
import { FACILITATOR_MODE_ENV, PORT_ENV } from "../dev-runner.js";
import { loadProject } from "../project.js";
import { renderConfig } from "../render/findings.js";
import { type Row, renderTable } from "../render/table.js";
import type { CommandContext } from "./context.js";

/** How `movo dev` obtains a facilitator. */
export type FacilitatorMode = "config" | "in-process" | "mock";

/** Every accepted value of `--facilitator`. */
export const FACILITATOR_MODES: readonly FacilitatorMode[] = ["config", "in-process", "mock"];

/** Parsed `movo dev` flags. */
export interface DevOptions {
  readonly facilitator?: FacilitatorMode;
  readonly port?: number;
  readonly watch?: boolean;
}

/**
 * Refuse an in-process facilitator on mainnet.
 *
 * The in-process facilitator performs **real settlement** — it is named that way precisely so
 * nobody mistakes it for an offline stub (spec §5.11). Running one against pubnet from a
 * development command would move real money on a keystroke, and there is no development
 * scenario that wants it.
 *
 * @param mode - The requested facilitator mode
 * @param network - The resolved network
 */
export function assertFacilitatorAllowed(mode: FacilitatorMode, network: string): void {
  if (mode !== "in-process" || network !== STELLAR_PUBNET_CAIP2) return;

  throw new MovoError(
    "MOVO_E_FACILITATOR_PUBNET_REFUSED",
    `\`movo dev --facilitator in-process\` refuses to start on ${STELLAR_PUBNET_CAIP2}. The in-process facilitator performs real verification and real on-chain settlement, so on mainnet it would move real funds from a development command.`,
    { context: { facilitator: mode, network } },
  );
}

/**
 * Render the boot banner: resolved configuration with provenance, then every paid route.
 *
 * Split out from the command so the snapshot test asserts against the text rather than against
 * a spawned process's captured output — a snapshot that requires a port to be free is a
 * snapshot that fails for reasons unrelated to verbosity.
 *
 * @param project - The loaded project
 * @param options - Parsed flags
 * @param context - Streams and styling
 * @returns The banner, newline-terminated
 */
export function renderBanner(
  project: Awaited<ReturnType<typeof loadProject>>,
  options: DevOptions,
  context: CommandContext,
): string {
  const style = context.style;
  const out: string[] = [];
  const mode = options.facilitator ?? "config";

  out.push("");
  out.push(`${style.bold("movo dev")}  ${style.dim(project.root)}`);
  out.push("");
  out.push(style.bold("Resolved configuration"));
  out.push(renderConfig(project.resolved, style));
  out.push(`${style.bold("Facilitator")}  ${mode}`);
  out.push("");

  if (project.app === undefined) {
    out.push(style.yellow("  no app module found, so no resources are listed"));
    out.push("");
    return `${out.join("\n")}\n`;
  }

  const compiled = compileApp(project.app, project.layers);
  const rows: Row[] = [];

  for (const [routeKey, handler] of compiled.handlers) {
    const route = (compiled.routes as unknown as Record<string, { accepts?: PaymentOption }>)[
      routeKey
    ];
    const accepts = route?.accepts;
    rows.push({
      label: `${handler.method} ${handler.path}`,
      value: String(accepts?.price ?? "?"),
      note: `${String(accepts?.network ?? "?")}  →  ${String(accepts?.payTo ?? "?")}`,
    });
  }

  out.push(`${style.bold("Paid resources")}  ${String(rows.length)}`);
  out.push(renderTable(rows, { indent: "  ", note: style.dim }));
  out.push("");

  return `${out.join("\n")}\n`;
}

/**
 * Run `movo dev`.
 *
 * @param options - Parsed flags
 * @param context - Streams, environment and styling
 * @returns The process exit code
 */
export async function devCommand(options: DevOptions, context: CommandContext): Promise<number> {
  const project = await loadProject({ cwd: context.cwd, env: context.env });
  const mode = options.facilitator ?? "config";

  // Before anything is spawned and before a banner is printed, so a refusal reads as an answer
  // about the flag rather than as a crash from a half-started server.
  assertFacilitatorAllowed(mode, project.resolved.network.value);

  context.stdout(renderBanner(project, options, context));

  // The runner ships with the CLI. Spawning the *project's* server.ts instead would mean the
  // facilitator strings had to be resolved somewhere the CLI cannot reach, which is exactly the
  // dependency inversion amendment 005 §1 removed from `MountOptions`.
  const runner = fileURLToPath(new URL("../dev-runner.js", import.meta.url));
  const args = options.watch === false ? [runner] : ["--watch", runner];

  const child = spawn(process.execPath, args, {
    cwd: project.root,
    stdio: "inherit",
    env: {
      ...process.env,
      [FACILITATOR_MODE_ENV]: mode,
      ...(options.port === undefined ? {} : { [PORT_ENV]: String(options.port) }),
    },
  });

  return await new Promise<number>((resolve) => {
    child.on("exit", (code, signal) => {
      // A signal-terminated child has no exit code. Reporting 0 would tell CI that a server
      // killed by the OOM killer shut down cleanly.
      resolve(signal !== null ? 1 : (code ?? 0));
    });
    child.on("error", () => {
      resolve(1);
    });
  });
}
