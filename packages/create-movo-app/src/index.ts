/**
 * `create-movo-app` — `npm create movo-app my-api`.
 *
 * Fully usable without a prompt: `--template` and `--yes` cover every decision, because the
 * first thing anyone does with a scaffolder is put it in a script.
 */

import { parseArgs } from "node:util";
import {
  DEFAULT_DEPENDENCY_RANGE,
  GENERATED_TSCONFIG,
  rewriteManifest,
  type ScaffoldOptions,
  type ScaffoldResult,
  scaffold,
  TEMPLATES,
  type TemplateName,
} from "./scaffold.js";

export {
  DEFAULT_DEPENDENCY_RANGE,
  GENERATED_TSCONFIG,
  rewriteManifest,
  type ScaffoldOptions,
  type ScaffoldResult,
  scaffold,
  TEMPLATES,
  type TemplateName,
};

/** The published version of this package. */
export const VERSION: string = "0.0.0";

const HELP = `
create-movo-app — scaffold a paid, Stellar-settled HTTP API

USAGE
  npm create movo-app <directory> [--template minimal|discoverable] [--yes]

OPTIONS
  --template   minimal (Express and one paid route) or discoverable (adds Bazaar metadata
               and a buyer client). Default: minimal
  --yes        Accept defaults without prompting. Implied whenever stdin is not a terminal.
  --name       Package name for the generated project. Default: the directory name

Movo collects no telemetry.
`;

/** What {@link runCreate} writes to. Injected so the scaffold test can capture it. */
export interface CreateContext {
  readonly cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
}

/**
 * Run the scaffolder.
 *
 * @param argv - Arguments after the binary name
 * @param context - Working directory and streams
 * @returns The process exit code
 */
export function runCreate(argv: readonly string[], context: CreateContext): number {
  let values: { template?: string; yes?: boolean; name?: string; help?: boolean };
  let positionals: string[];

  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        template: { type: "string" },
        yes: { type: "boolean", default: false },
        name: { type: "string" },
        help: { type: "boolean", default: false },
      },
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (error) {
    context.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  if (values.help === true) {
    context.stdout(HELP.trimStart());
    return 0;
  }

  const target = positionals[0];
  if (target === undefined) {
    context.stderr(`A directory name is required.\n\n${HELP.trimStart()}`);
    return 2;
  }

  const template = values.template ?? "minimal";
  if (!(TEMPLATES as readonly string[]).includes(template)) {
    context.stderr(
      `Unknown template ${JSON.stringify(template)}. Expected one of: ${TEMPLATES.join(", ")}.\n`,
    );
    return 2;
  }

  try {
    const result = scaffold({
      target,
      template: template as TemplateName,
      cwd: context.cwd,
      ...(values.name === undefined ? {} : { name: values.name }),
    });

    context.stdout(
      [
        "",
        `Created ${result.name} (${result.template}) in ${result.root}`,
        `  ${String(result.files.length)} files`,
        "",
        "Next:",
        `  cd ${target}`,
        "  npm install",
        "  cp .env.example .env      # set MOVO_PAY_TO to your Stellar address",
        "  npx movo doctor",
        "  npx movo dev",
        "",
      ].join("\n"),
    );

    return 0;
  } catch (error) {
    context.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
