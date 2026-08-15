/**
 * Rendering findings, and the resolved configuration they were produced against.
 *
 * Two properties this file is responsible for.
 *
 * **The fix is never dropped.** A finding without its remedy is a log line, and spec §1.5 P4 is
 * explicit that diagnostics are a feature rather than logging. Every warn and error prints its
 * `fix` and, where the finding came from a registry code, its docs URL.
 *
 * **The configuration table cannot print a credential.** `movo doctor` prints configuration by
 * design, so the renderer runs every value through `redact()` and handles the one value
 * redaction alone cannot help with: `facilitator.authHeaders` is a *function*, and a function
 * closes over the credential rather than containing it under a sensitive-looking key. It is
 * rendered from its presence and never invoked (AC5.4).
 */

import { type Finding, type FindingLevel, type ResolvedConfig, redact } from "@movoframework/core";
import type { Styler } from "./style.js";
import { type Row, renderTable } from "./table.js";

/** The mark printed against each level. ASCII, so it survives every terminal and every paste. */
const MARK: Readonly<Record<FindingLevel, string>> = {
  ok: "ok  ",
  warn: "warn",
  error: "FAIL",
};

function paint(level: FindingLevel, style: Styler): string {
  const mark = MARK[level];
  if (level === "ok") return style.green(mark);
  if (level === "warn") return style.yellow(mark);
  return style.red(mark);
}

/**
 * What `facilitator.authHeaders` renders as.
 *
 * Exported because the zero-leakage test asserts against this exact constant rather than
 * against a copy of the string: a renderer that started printing something else would otherwise
 * pass a test that had quietly stopped describing it.
 */
export const HIDDEN_CREDENTIAL = "configured (hidden)";

/** What an unset optional value renders as. */
export const UNSET = "not set";

/**
 * Render a group of findings.
 *
 * @param findings - The findings, in the order they were produced
 * @param style - The styler
 * @returns The rendered block, newline-terminated, or an empty string when there are none
 */
export function renderFindings(findings: readonly Finding[], style: Styler): string {
  if (findings.length === 0) return "";

  const lines: string[] = [];

  for (const finding of findings) {
    lines.push(`  ${paint(finding.level, style)}  ${finding.title}`);
    lines.push(`        ${style.dim(finding.detail)}`);

    // An `ok` finding's fix, where one exists, is guidance for a state that is not a problem —
    // printing it would teach readers to ignore the fix line.
    if (finding.level !== "ok" && finding.fix !== undefined) {
      lines.push(`        ${style.bold("fix")}  ${finding.fix}`);
    }
    if (finding.level !== "ok" && finding.docs !== undefined) {
      lines.push(`        ${style.bold("docs")} ${style.blue(finding.docs)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

/** A resolved value flattened for display: what it is, and which layer supplied it. */
export interface ConfigRow {
  readonly key: string;
  readonly value: string;
  readonly source: string;
}

function show(value: unknown): string {
  if (value === undefined || value === null) return UNSET;
  if (Array.isArray(value)) return value.length === 0 ? UNSET : value.join(", ");
  if (typeof value === "string") return value.length === 0 ? UNSET : value;
  return String(redact(value));
}

/**
 * Flatten a resolved configuration into displayable rows, with provenance on every one.
 *
 * Shared by the human table and the `--json` payload, so the two cannot disagree about what
 * `movo doctor` considers safe to print.
 *
 * @param config - The resolved configuration
 * @returns One row per leaf, in a stable order
 */
export function configRows(config: ResolvedConfig): ConfigRow[] {
  return [
    { key: "env", value: show(config.env.value), source: config.env.source },
    { key: "network", value: show(config.network.value), source: config.network.source },
    { key: "payTo", value: show(config.payTo.value), source: config.payTo.source },
    {
      key: "facilitator.url",
      value: show(config.facilitator.url.value),
      source: config.facilitator.url.source,
    },
    {
      key: "facilitator.authHeaders",
      // Never invoked, never inspected, never stringified. The credential lives inside this
      // closure and the only safe fact about it is whether it exists.
      value: config.facilitator.authHeaders.value === undefined ? UNSET : HIDDEN_CREDENTIAL,
      source: config.facilitator.authHeaders.source,
    },
    {
      key: "facilitator.timeoutMs",
      value: show(config.facilitator.timeoutMs.value),
      source: config.facilitator.timeoutMs.source,
    },
    {
      key: "defaults.price",
      value: show(config.defaults.price.value),
      source: config.defaults.price.source,
    },
    {
      key: "defaults.maxTimeoutSeconds",
      value: show(config.defaults.maxTimeoutSeconds.value),
      source: config.defaults.maxTimeoutSeconds.source,
    },
    {
      key: "discovery.enabled",
      value: show(config.discovery.enabled.value),
      source: config.discovery.enabled.source,
    },
    {
      key: "discovery.serviceName",
      value: show(config.discovery.serviceName.value),
      source: config.discovery.serviceName.source,
    },
    {
      key: "discovery.tags",
      value: show(config.discovery.tags.value),
      source: config.discovery.tags.source,
    },
    {
      key: "discovery.iconUrl",
      value: show(config.discovery.iconUrl.value),
      source: config.discovery.iconUrl.source,
    },
    {
      key: "stellar.rpcUrl",
      value: show(config.stellar.rpcUrl.value),
      source: config.stellar.rpcUrl.source,
    },
  ];
}

/**
 * Render the resolved configuration with the provenance of every value.
 *
 * The provenance column is the reason this table exists at all. "It is using the wrong payTo"
 * is the most common support conversation a configurable payment tool has, and the answer is
 * always that a layer nobody was thinking about supplied it (ADR-0006).
 *
 * @param config - The resolved configuration
 * @param style - The styler
 * @returns The rendered table, newline-terminated
 */
export function renderConfig(config: ResolvedConfig, style: Styler): string {
  const rows: Row[] = configRows(config).map((row) => ({
    label: row.key,
    value: row.value,
    note: `from ${row.source}`,
  }));

  return `${renderTable(rows, { indent: "  ", note: style.dim })}\n`;
}
