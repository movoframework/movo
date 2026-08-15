/**
 * The process `movo dev` spawns under `node --watch`.
 *
 * **This is where the facilitator is constructed**, and that placement is a ruling rather than a
 * convenience. Amendment 005 §1 deleted `"in-process"` and `"mock"` from
 * `MountOptions.facilitator` because `@movoframework/server` resolving those strings would mean
 * depending on `@movoframework/testing` at runtime, which the dependency direction forbids. The
 * strings survive as a **CLI** flag, and construction happens in `@movoframework/cli`, which
 * may depend on the testing toolkit. The server only ever receives a constructed
 * `FacilitatorClient`.
 *
 * It is a separate entry point from the command, rather than the command mounting in-process,
 * because `node --watch` restarts the process it is given. Pointing it at the CLI itself would
 * re-run argument parsing and re-print the banner on every file save; pointing it here restarts
 * only the server.
 *
 * The command communicates through the environment rather than argv because `--watch` re-execs
 * with the original arguments, and an environment variable survives that unchanged.
 */

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import type { FacilitatorClient } from "@movoframework/core";
import { MovoError, STELLAR_PUBNET_CAIP2 } from "@movoframework/core";
import { createEd25519Signer } from "@movoframework/core/client";
import { mountNodeHttp } from "@movoframework/server";
import { createInProcessFacilitator, MockFacilitator } from "@movoframework/testing";
import { loadProject } from "./project.js";

/** Environment variable carrying the `--facilitator` selection to the spawned runner. */
export const FACILITATOR_MODE_ENV = "MOVO_DEV_FACILITATOR";

/** Environment variable carrying the `--port` selection. */
export const PORT_ENV = "MOVO_DEV_PORT";

/** Default development port. */
export const DEFAULT_DEV_PORT = 4021;

/**
 * Construct the facilitator a development server should use.
 *
 * @param mode - `config`, `in-process` or `mock`
 * @param network - The resolved network
 * @param env - Environment, read for `STELLAR_PRIVATE_KEY` in the in-process case
 * @returns The client, or `"config"` for the mount to build from configuration
 */
export function createDevFacilitator(
  mode: string,
  network: string,
  env: Readonly<Record<string, string | undefined>>,
): FacilitatorClient | "config" {
  if (mode === "mock") return new MockFacilitator();

  if (mode === "in-process") {
    if (network === STELLAR_PUBNET_CAIP2) {
      throw new MovoError(
        "MOVO_E_FACILITATOR_PUBNET_REFUSED",
        "The in-process facilitator performs real on-chain settlement and will not run against stellar:pubnet from a development command.",
        { context: { network } },
      );
    }

    const secret = env["STELLAR_PRIVATE_KEY"];
    if (secret === undefined || secret.length === 0) {
      throw new MovoError(
        "MOVO_E_APP_INVALID",
        "`--facilitator in-process` needs STELLAR_PRIVATE_KEY: the in-process facilitator signs and submits real testnet transactions, so it needs a funded testnet key to submit them with.",
        { context: { facilitator: mode } },
      );
    }

    return createInProcessFacilitator({
      // Never logged, never stored on the returned object: the signer closes over the seed and
      // `MovoError` redacts any `S…` string that reaches a message (spec §1.5 P6).
      signer: createEd25519Signer(secret, network as never),
      network: network as never,
    });
  }

  return "config";
}

async function main(): Promise<void> {
  const project = await loadProject({ requireApp: true });
  const mode = process.env[FACILITATOR_MODE_ENV] ?? "config";
  const network = project.resolved.network.value;

  const facilitator = createDevFacilitator(mode, network, process.env);

  if (project.app === undefined) throw new Error("unreachable: requireApp was set");

  const mounted = await mountNodeHttp(project.app, {
    facilitator,
    config: project.layers,
    onFinding: (finding) => {
      if (finding.level === "ok") return;
      process.stdout.write(`  ${finding.level}  ${finding.title}\n        ${finding.detail}\n`);
      if (finding.fix !== undefined) process.stdout.write(`        fix  ${finding.fix}\n`);
    },
  });

  const port = Number(process.env[PORT_ENV] ?? process.env["PORT"] ?? DEFAULT_DEV_PORT);
  const server = createServer(mounted.listener as never);

  server.listen(port, () => {
    process.stdout.write(`  listening on http://localhost:${String(port)}\n\n`);
  });
}

// Only when executed as the entry point, so the exported helpers stay importable from a test
// without starting a server. Comparing resolved URLs rather than matching the filename, because
// a filename match is also true when a test imports this module.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
