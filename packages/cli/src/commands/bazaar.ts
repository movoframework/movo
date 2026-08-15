/**
 * `movo bazaar validate | list | search`.
 *
 * **`validate` is the one that earns the command's place in the product.** It runs the same
 * derive-attach-escalate sequence the mount runs, so a developer can ask "would my listing
 * survive a facilitator?" before deploying — which is the whole of M4's thesis made reachable
 * from a terminal. Upstream drops an invalid field silently at request time, on someone else's
 * server; this is the only place that fact becomes visible before it costs anything.
 *
 * `list` and `search` are thin: they exist because a catalog is only useful if you can see
 * yourself in it, and "did my resource actually appear" is the question that follows every
 * deployment. Neither adds a filter, a ranking or a cache — the facilitator's response is
 * printed as it arrived (spec §1.8 D3: catalog policy belongs to the facilitator).
 */

import {
  attachDiscovery,
  isCatalogRejection,
  queryCatalog,
  readCatalogOutcome,
} from "@movoframework/bazaar";
import { compileApp, type Finding, MovoError } from "@movoframework/core";
import { loadProject } from "../project.js";
import { renderFindings } from "../render/findings.js";
import type { CommandContext } from "./context.js";

/** Parsed `movo bazaar` flags. */
export interface BazaarOptions {
  readonly facilitator?: string;
  readonly type?: string;
  readonly payTo?: string;
  readonly query?: string;
  readonly json?: boolean;
}

/**
 * Validate the project's discovery metadata.
 *
 * @param context - Streams and styling
 * @param json - Emit machine-readable findings instead of a table
 * @returns The process exit code
 */
export async function bazaarValidate(context: CommandContext, json: boolean): Promise<number> {
  const project = await loadProject({ cwd: context.cwd, env: context.env, requireApp: true });
  if (project.app === undefined) throw new Error("unreachable: requireApp was set");

  const compiled = compileApp(project.app, project.layers);

  // Derive before validating. Upstream's spec validator reads `route.extensions`, which a
  // freshly compiled app does not have — validating first would report nothing at all and read
  // as a clean bill of health.
  const findings: Finding[] = await attachDiscovery(compiled);

  if (json) {
    context.stdout(`${JSON.stringify({ ok: !hasError(findings), findings }, null, 2)}\n`);
  } else if (findings.length === 0) {
    context.stdout(
      `\n  ${context.style.green("ok")}  ${String(compiled.discoveryDeclared.length)} resource(s) declare discovery; upstream validation raised nothing.\n\n`,
    );
  } else {
    context.stdout("\n");
    context.stdout(renderFindings(findings, context.style));
    context.stdout("\n");
  }

  return hasError(findings) ? 1 : 0;
}

function hasError(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.level === "error");
}

/**
 * Resolve which facilitator to query: the flag, else the project's configured one.
 *
 * Falling back to configuration rather than to a hardcoded default, because querying a catalog
 * other than the one you publish to answers a question nobody asked.
 */
async function facilitatorUrl(context: CommandContext, override?: string): Promise<string> {
  if (override !== undefined) return override;

  const project = await loadProject({ cwd: context.cwd, env: context.env });
  return project.resolved.facilitator.url.value;
}

/**
 * List catalogued resources.
 *
 * @param options - Flags
 * @param context - Streams and styling
 * @returns The process exit code
 */
export async function bazaarList(options: BazaarOptions, context: CommandContext): Promise<number> {
  const url = await facilitatorUrl(context, options.facilitator);
  const catalog = queryCatalog(url);

  const response = await catalog.list({
    ...(options.type === undefined ? {} : { type: options.type as never }),
    ...(options.payTo === undefined ? {} : { payTo: options.payTo }),
  });

  return printCatalog(response, url, options, context);
}

/**
 * Search the catalog.
 *
 * @param options - Flags; `query` is required
 * @param context - Streams and styling
 * @returns The process exit code
 */
export async function bazaarSearch(
  options: BazaarOptions,
  context: CommandContext,
): Promise<number> {
  if (options.query === undefined || options.query.length === 0) {
    throw new MovoError("MOVO_E_APP_INVALID", '`movo bazaar search` needs --query "<text>".', {
      context: { command: "bazaar search" },
    });
  }

  const url = await facilitatorUrl(context, options.facilitator);
  const catalog = queryCatalog(url);
  const response = await catalog.search({ query: options.query });

  return printCatalog(response, url, options, context);
}

function printCatalog(
  response: unknown,
  url: string,
  options: BazaarOptions,
  context: CommandContext,
): number {
  if (options.json === true) {
    context.stdout(`${JSON.stringify(response, null, 2)}\n`);
    return 0;
  }

  // `resources`, which is upstream's field name — read from the installed `.d.mts` rather than
  // guessed. `items` is the name this originally used and it silently produced an empty list.
  const items = (response as { resources?: readonly Record<string, unknown>[] }).resources ?? [];
  const style = context.style;

  context.stdout(`\n${style.dim(url)}\n\n`);

  if (items.length === 0) {
    // Said plainly rather than as an empty table, because "no results" and "the catalog does
    // not exist" look identical in a table and mean very different things. A facilitator is not
    // required to operate a catalog at all (ADR-0010).
    context.stdout(
      `  no resources returned. A facilitator is not obliged to operate a catalog, so an empty result may mean this one does not.\n\n`,
    );
    return 0;
  }

  for (const item of items) {
    const resource = String(item["resource"] ?? item["url"] ?? "?");
    const name = item["serviceName"];
    context.stdout(`  ${style.bold(resource)}${name === undefined ? "" : `  ${String(name)}`}\n`);
    if (item["description"] !== undefined) {
      context.stdout(`      ${style.dim(String(item["description"]))}\n`);
    }
  }

  context.stdout(`\n  ${String(items.length)} resource(s)\n\n`);
  return 0;
}

/**
 * Report what a facilitator said about a declaration it received.
 *
 * Exposed as `movo bazaar outcome` is not — this is used by the `list`/`search` paths only when
 * a response carries the header. `readCatalogOutcome`'s `unknown` state is the honest answer to
 * "no signal", and `isCatalogRejection` exists because `status !== "success"` is the natural
 * thing to write and treats both `processing` and `unknown` as failures.
 *
 * @param headerValue - The `EXTENSION-RESPONSES` header, or null when absent
 * @returns A one-line summary
 */
export function describeOutcome(headerValue: string | null | undefined): string {
  const outcome = readCatalogOutcome(headerValue ?? undefined);

  if (outcome.status === "success") return "catalogued";
  if (outcome.status === "processing") return "accepted, still processing";

  // `isCatalogRejection` rather than `status !== "success"`, which is the natural thing to write
  // and treats both `processing` and `unknown` as rejections — reporting a failure for a
  // facilitator that simply said nothing.
  if (isCatalogRejection(outcome)) {
    return `rejected: ${outcome.rejectedReason ?? "no reason given"}`;
  }

  return `no catalog signal (${outcome.status === "unknown" ? outcome.reason : "unrecognised status"})`;
}
