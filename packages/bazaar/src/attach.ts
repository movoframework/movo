/**
 * `attachDiscovery` — derive every declared extension, attach it, then escalate.
 *
 * This is the sequence that has to happen before anything can ask a meaningful question about a
 * project's discovery metadata, and the ordering inside it is the part that is easy to get
 * wrong: escalation must run **after** attachment, so it validates what will actually go on the
 * wire rather than what was intended. Upstream's `validateDiscoveryExtensionSpec` reads
 * `route.extensions`, which does not exist until derivation has run — a validation pass over a
 * freshly compiled app therefore reports nothing and reads as "your metadata is fine".
 *
 * It lives in the library rather than in `@movoframework/server`'s mount, where it was first
 * written, because `movo doctor` and `movo bazaar validate` need exactly the same sequence. A
 * second copy in the CLI would be a check that only the CLI can run, which M5's architectural
 * rule forbids — and, worse, two orderings that could drift, with the wrong one silently
 * validating nothing.
 */

import type { CompiledApp, Finding, RouteConfig } from "@movoframework/core";
import { deriveDiscovery } from "./derive.js";
import { validateDiscoveryStrict } from "./escalate.js";

/**
 * Derive each declared Bazaar extension, attach it to its compiled route, and escalate what
 * upstream would silently drop.
 *
 * **Mutates `compiled.routes`, deliberately and in one place.** `CompiledApp` comes from a pure
 * function and is otherwise treated as immutable, but rebuilding the whole structure to add one
 * field per route would fork the object callers hold — leaving them with a copy lacking the
 * extensions the server is actually serving.
 *
 * @param compiled - The compiled application, whose routes gain `extensions.bazaar`
 * @returns Findings from derivation followed by findings from escalation
 */
export async function attachDiscovery(compiled: CompiledApp): Promise<Finding[]> {
  if (compiled.discoveryDeclared.length === 0) return [];

  const routes = compiled.routes as Record<
    string,
    RouteConfig & { extensions?: Record<string, unknown> }
  >;
  const findings: Finding[] = [];

  for (const routeKey of compiled.discoveryDeclared) {
    const route = routes[routeKey];
    const handler = compiled.handlers.get(routeKey);
    if (route === undefined || handler === undefined) continue;

    const derived = await deriveDiscovery(handler.resource, compiled.resolvedConfig, routeKey);
    findings.push(...derived.findings);

    if (derived.extension !== undefined) {
      route.extensions = { ...route.extensions, ...derived.extension };
    }
  }

  findings.push(...validateDiscoveryStrict(compiled));

  return findings;
}
