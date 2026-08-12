/**
 * Findings — the currency of Movo's diagnostics.
 *
 * A `Finding` is data, never an exception. A missing trustline, an undescribed parameter, a
 * facilitator that does not advertise the configured network: each is a fact about the world,
 * and the library's job is to report it accurately. Deciding whether a given fact should fail
 * a build is policy, and policy belongs to the caller — `movo doctor --fail-on warn` is a CLI
 * flag precisely because the library must not presume (spec §5.6).
 *
 * `Finding.id` is stable for the same reason error codes are: CI configurations filter on it.
 */

import { docsUrlFor, type MovoErrorCode, registryEntry } from "./errors/registry.js";

/** How serious a finding is. */
export type FindingLevel = "ok" | "warn" | "error";

/** One diagnostic observation. */
export interface Finding {
  /** Stable dotted identifier, e.g. `resource.param-undescribed`. Changing one is a major. */
  readonly id: string;
  readonly level: FindingLevel;
  readonly title: string;
  readonly detail: string;
  /** A copy-pasteable remedy, where one exists. */
  readonly fix?: string;
  /** Documentation URL, when the finding corresponds to a registry code. */
  readonly docs?: string;
}

/**
 * Build a finding from a registry code, so its fix text and docs URL cannot drift from the
 * registry's.
 *
 * @param code - A registry code
 * @param id - Stable finding id
 * @param title - Short summary
 * @param detail - What was observed, specifically
 * @returns The finding
 */
export function findingFromCode(
  code: MovoErrorCode,
  id: string,
  title: string,
  detail: string,
): Finding {
  const entry = registryEntry(code);
  return {
    id,
    level: entry.severity === "error" ? "error" : "warn",
    title,
    detail,
    fix: entry.fix,
    docs: docsUrlFor(code),
  };
}
