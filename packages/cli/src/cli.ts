/**
 * Argument parsing and dispatch.
 *
 * `util.parseArgs` rather than an argument-parsing dependency. Movo's pitch is that the
 * toolchain should be small, and a CLI with four commands and eleven flags that pulls in a
 * parser has already contradicted it. The cost is that help text and validation are written by
 * hand, which for eleven flags is a smaller cost than the dependency.
 *
 * `run()` takes argv and a context and returns an exit code rather than calling
 * `process.exit()`. That is what lets the tests drive every command end to end and capture every
 * byte it writes — which is the only way AC5.4's "zero bytes" claim can be checked rather than
 * argued.
 */

import { parseArgs } from "node:util";
import type { FindingLevel } from "@movoframework/core";
import { bazaarList, bazaarSearch, bazaarValidate } from "./commands/bazaar.js";
import type { CommandContext } from "./commands/context.js";
import { devCommand, FACILITATOR_MODES, type FacilitatorMode } from "./commands/dev.js";
import { doctorCommand } from "./commands/doctor.js";
import { testCommand } from "./commands/test.js";
import { DOCTOR_CHECK_IDS } from "./doctor/run.js";
import { renderUnknownError } from "./render/error.js";

/** The version reported by `movo --version`. */
export const VERSION = "0.0.0";

const HELP = `
movo — the project framework and operations toolkit for machine-payable Stellar APIs

USAGE
  movo <command> [options]

COMMANDS
  dev      Start the development server, printing resolved configuration and every paid route
  doctor   Run every diagnostic check and explain each failure
  test     Run the project's tests (a thin Vitest wrapper)
  bazaar   validate | list | search — discovery metadata and catalog queries

  movo dev [--facilitator config|in-process|mock] [--port N] [--no-watch]
  movo doctor [--json] [--check <id>]... [--fail-on warn|error]
  movo test [...vitest args]
  movo bazaar validate [--json]
  movo bazaar list [--facilitator <url>] [--type http|mcp] [--pay-to <G...>] [--json]
  movo bazaar search --query "<text>" [--facilitator <url>] [--json]

DOCTOR CHECKS
  ${DOCTOR_CHECK_IDS.join(", ")}

Movo collects no telemetry. Nothing in this CLI reports usage anywhere.
`;

function parseFailOn(value: string | undefined): Exclude<FindingLevel, "ok"> | undefined {
  if (value === undefined) return undefined;
  if (value === "warn" || value === "error") return value;
  throw new Error(`--fail-on accepts "warn" or "error", not ${JSON.stringify(value)}`);
}

function parseFacilitatorMode(value: string | undefined): FacilitatorMode | undefined {
  if (value === undefined) return undefined;
  if ((FACILITATOR_MODES as readonly string[]).includes(value)) return value as FacilitatorMode;
  throw new Error(
    `--facilitator accepts ${FACILITATOR_MODES.join(", ")}, not ${JSON.stringify(value)}`,
  );
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`--port accepts 1–65535, not ${JSON.stringify(value)}`);
  }
  return port;
}

async function dispatch(argv: readonly string[], context: CommandContext): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    context.stdout(`${HELP.trimStart()}`);
    return 0;
  }

  if (command === "--version" || command === "-v") {
    context.stdout(`${VERSION}\n`);
    return 0;
  }

  switch (command) {
    case "dev": {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          facilitator: { type: "string" },
          port: { type: "string" },
          // `parseArgs` has no `--no-x` negation, so the documented `--no-watch` is declared as
          // its own boolean rather than left to fail with "Unknown option". Both spellings are
          // accepted because both are in the help text and in §5.12.
          watch: { type: "boolean" },
          "no-watch": { type: "boolean" },
        },
      });
      const facilitator = parseFacilitatorMode(values.facilitator);
      const port = parsePort(values.port);
      return await devCommand(
        {
          ...(facilitator === undefined ? {} : { facilitator }),
          ...(port === undefined ? {} : { port }),
          watch: values["no-watch"] === true ? false : values.watch !== false,
        },
        context,
      );
    }

    case "doctor": {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          json: { type: "boolean", default: false },
          // Repeatable, so `--check node --check pins` selects two.
          check: { type: "string", multiple: true },
          "fail-on": { type: "string" },
          timeout: { type: "string" },
        },
      });
      const failOn = parseFailOn(values["fail-on"]);
      const timeout = values.timeout === undefined ? undefined : Number(values.timeout);
      return await doctorCommand(
        {
          json: values.json === true,
          ...(values.check === undefined ? {} : { check: values.check }),
          ...(failOn === undefined ? {} : { failOn }),
          ...(timeout === undefined || Number.isNaN(timeout) ? {} : { timeoutMs: timeout }),
        },
        context,
      );
    }

    case "test":
      // Not parsed at all — every argument belongs to Vitest.
      return await testCommand(rest, context);

    case "bazaar": {
      const [subcommand, ...bazaarArgs] = rest;
      const { values } = parseArgs({
        args: [...bazaarArgs],
        options: {
          facilitator: { type: "string" },
          type: { type: "string" },
          "pay-to": { type: "string" },
          query: { type: "string" },
          json: { type: "boolean", default: false },
        },
      });

      const options = {
        ...(values.facilitator === undefined ? {} : { facilitator: values.facilitator }),
        ...(values.type === undefined ? {} : { type: values.type }),
        ...(values["pay-to"] === undefined ? {} : { payTo: values["pay-to"] }),
        ...(values.query === undefined ? {} : { query: values.query }),
        json: values.json === true,
      };

      if (subcommand === "validate") return await bazaarValidate(context, options.json);
      if (subcommand === "list") return await bazaarList(options, context);
      if (subcommand === "search") return await bazaarSearch(options, context);

      context.stderr(
        `Unknown bazaar subcommand ${JSON.stringify(subcommand ?? "")}. Expected validate, list or search.\n`,
      );
      return 2;
    }

    default:
      context.stderr(`Unknown command ${JSON.stringify(command)}.\n\n${HELP.trimStart()}`);
      return 2;
  }
}

/**
 * Run the CLI.
 *
 * Every thrown value is rendered rather than escaping as a stack trace. A `MovoError` reaching a
 * user as an unhandled rejection would waste the code, the fix and the docs link the error was
 * constructed with.
 *
 * @param argv - Arguments after the binary name
 * @param context - Streams, environment and styling
 * @returns The process exit code
 */
export async function run(argv: readonly string[], context: CommandContext): Promise<number> {
  try {
    return await dispatch(argv, context);
  } catch (error) {
    context.stderr(renderUnknownError(error, context.style));
    return 1;
  }
}
