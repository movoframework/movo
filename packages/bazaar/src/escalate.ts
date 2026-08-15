/**
 * `validateDiscoveryStrict` — contribution (ii) of D3: severity escalation.
 *
 * Upstream's posture is deliberate and correct for upstream: a facilitator receiving a
 * declaration with an over-long `serviceName` drops that field and catalogues the rest, because
 * refusing the whole listing over one bad field would serve nobody. `sanitizeTags` truncates,
 * `sanitizeResourceServiceMetadata` drops, `validateRouteTemplate` returns `undefined`. All of
 * it happens silently, at runtime, on someone else's server.
 *
 * That is exactly wrong for the author. The first they learn of it is that their listing has no
 * icon, or no name, or does not appear at all — with no error anywhere and nothing to search
 * for. Movo's contribution is to run the same validators at build time and turn each soft-drop
 * into an error-level `Finding` with a fix.
 *
 * **Every validation call in this file resolves to an upstream export** (AC4.8). Movo owns no
 * validator, no regular expression, no length constant and no allowlist. What it owns is the
 * decision that a dropped field is worth failing a build over, and the sentence explaining why.
 *
 * **Upstream's validators return `{ valid, errors }`; they do not throw.** The discarded WIP
 * wrapped one in a `try/catch` and discarded its return value, producing delegation that was
 * present in the source and absent in behaviour (amendment 007 §1). Every call here uses the
 * returned value, and `escalate.test.ts` asserts that findings actually appear for known-bad
 * input rather than that the function merely runs.
 */

import {
  type CompiledApp,
  type Finding,
  findingFromCode,
  type MovoErrorCode,
  type RouteConfig,
} from "@movoframework/core";
import {
  sanitizeResourceServiceMetadata,
  sanitizeTags,
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
  validateRouteTemplate,
} from "@movoframework/core/bazaar";

/** A finding paired with the route it came from. */
function at(
  routeKey: string,
  code: MovoErrorCode,
  id: string,
  title: string,
  detail: string,
): Finding {
  return findingFromCode(code, id, `${routeKey}: ${title}`, detail);
}

/**
 * Escalate every soft-drop upstream would perform into an error-level finding.
 *
 * @param compiled - The compiled application
 * @returns One finding per field that upstream would silently drop or reject
 */
export function validateDiscoveryStrict(compiled: CompiledApp): Finding[] {
  const findings: Finding[] = [];
  const routes = compiled.routes as Record<string, RouteConfig>;

  for (const routeKey of compiled.discoveryDeclared) {
    const route = routes[routeKey];
    if (route === undefined) continue;

    const separator = routeKey.indexOf(" ");
    const method = routeKey.slice(0, separator);
    const path = routeKey.slice(separator + 1);

    // ─── Route template ───────────────────────────────────────────────────────────────────
    // Upstream returns undefined for an invalid template — including traversal, percent-encoded
    // traversal, wildcards and non-absolute paths. Movo does not re-check any of those.
    if (validateRouteTemplate(path) === undefined) {
      findings.push(
        at(
          routeKey,
          "MOVO_E_DISCOVERY_ROUTE_TEMPLATE_INVALID",
          "bazaar.route-template",
          "path is not a valid Bazaar route template",
          `Upstream's validateRouteTemplate rejects ${JSON.stringify(path)}. The route template is the catalog key a buyer finds this resource under, so an invalid one means the resource cannot be catalogued at all — and nothing at runtime would tell you.`,
        ),
      );
    }

    // ─── Service metadata ─────────────────────────────────────────────────────────────────
    // `sanitizeResourceServiceMetadata` is the authority on what survives. Comparing its output
    // against the input is how Movo learns what would have been dropped, without knowing any of
    // the rules that decided it.
    const declared = {
      url: `https://example.invalid${path}`,
      ...(route.serviceName === undefined ? {} : { serviceName: route.serviceName }),
      ...(route.tags === undefined ? {} : { tags: [...route.tags] }),
      ...(route.iconUrl === undefined ? {} : { iconUrl: route.iconUrl }),
    };
    const surviving = sanitizeResourceServiceMetadata(declared);

    if (route.serviceName !== undefined && surviving.serviceName === undefined) {
      findings.push(
        at(
          routeKey,
          "MOVO_E_DISCOVERY_SERVICE_NAME_INVALID",
          "bazaar.service-name",
          "serviceName would be dropped from the listing",
          `Upstream's isValidServiceName rejects ${JSON.stringify(route.serviceName)} (${String(route.serviceName.length)} characters). At runtime the field is dropped without complaint and the listing appears unnamed.`,
        ),
      );
    }

    if (route.tags !== undefined) {
      const kept = sanitizeTags([...route.tags]) ?? [];
      if (kept.length !== route.tags.length) {
        const dropped = route.tags.filter((tag) => !kept.includes(tag));
        findings.push(
          at(
            routeKey,
            "MOVO_E_DISCOVERY_TAGS_INVALID",
            "bazaar.tags",
            `${String(route.tags.length - kept.length)} of ${String(route.tags.length)} tags would be dropped`,
            `Upstream's sanitizeTags keeps ${JSON.stringify(kept)} and drops ${JSON.stringify(dropped)}. Tags are how a buyer narrows a catalog search, so a silently dropped tag is a resource that stops being findable the way you expected.`,
          ),
        );
      }
    }

    if (route.iconUrl !== undefined && surviving.iconUrl === undefined) {
      findings.push(
        at(
          routeKey,
          "MOVO_E_DISCOVERY_ICON_URL_INVALID",
          "bazaar.icon-url",
          "iconUrl would be dropped from the listing",
          `Upstream's isValidIconUrl rejects ${JSON.stringify(route.iconUrl)}. It enforces an SSRF control — a catalog fetches this URL, so loopback addresses, private ranges and IP literals are refused. The field is dropped silently at runtime.`,
        ),
      );
    }

    // ─── The declaration itself ───────────────────────────────────────────────────────────
    // `validateDiscoveryExtensionSpec` enforces protocol-level invariants: the input type, the
    // method, the body type, MCP's required fields. Its `errors` are surfaced verbatim, because
    // upstream's wording describes upstream's rule better than a paraphrase would.
    const extensions = route.extensions;
    if (extensions !== undefined) {
      for (const [key, declaration] of Object.entries(extensions)) {
        if (typeof declaration !== "object" || declaration === null) continue;

        // Two upstream validators, answering different questions, and both are needed.
        //
        // `validateDiscoveryExtensionSpec` checks protocol-level invariants: input type, method,
        // body type, MCP's required fields.
        //
        // `validateDiscoveryExtension` checks *internal consistency* — that the declared example
        // input actually satisfies the declared input schema. Running only the first misses the
        // commonest real mistake: a schema with required properties and no `discovery.example`
        // to match it, which upstream logs a warning about and then serves anyway.
        const spec = validateDiscoveryExtensionSpec(declaration as Record<string, unknown>);
        for (const error of spec.valid ? [] : (spec.errors ?? ["no reason given"])) {
          findings.push(
            at(
              routeKey,
              "MOVO_E_DISCOVERY_EXTENSION_INVALID",
              "bazaar.extension-spec",
              `the ${key} declaration fails upstream specification validation`,
              `Upstream reported: ${error}`,
            ),
          );
        }

        // `validateDiscoveryExtension` expects the **post-enrichment** shape. Upstream's
        // `bazaarResourceServerExtension` fills `info.input.method` from the route at request
        // time, so a freshly derived declaration has no method and the validator would report a
        // missing one — a complaint about a field that is not Movo's to supply yet.
        //
        // Supplying the method here is not validation and not invention: it is the exact value
        // enrichment will use, taken from the route key, so upstream's own consistency check can
        // run against the shape that will actually exist. That moves a warning upstream only
        // logs at request time into a build-time finding, which is M4's entire thesis.
        const consistency = validateDiscoveryExtension(
          withEnrichedMethod(declaration as Record<string, unknown>, method) as never,
        );
        for (const error of consistency.valid ? [] : (consistency.errors ?? ["no reason given"])) {
          findings.push(
            at(
              routeKey,
              "MOVO_E_DISCOVERY_EXTENSION_INVALID",
              "bazaar.extension-consistency",
              `the ${key} declaration's example does not satisfy its own schema`,
              `Upstream reported: ${error}. This usually means the resource declares an input schema with required fields but no discovery.example matching it — add one, so an agent reading the listing sees a request that would actually work.`,
            ),
          );
        }
      }
    }
  }

  return findings;
}

/**
 * Return a copy of a declaration carrying the method upstream's enrichment will add.
 *
 * The original is not mutated: it is the object on the compiled route and is about to be served.
 * A copy exists only long enough for upstream's post-enrichment validator to inspect it.
 *
 * @param declaration - A freshly derived discovery declaration
 * @param method - The HTTP method, taken from the route key
 * @returns A copy with `info.input.method` set, when the declaration has an HTTP input
 */
function withEnrichedMethod(
  declaration: Record<string, unknown>,
  method: string,
): Record<string, unknown> {
  const info = declaration["info"];
  if (typeof info !== "object" || info === null) return declaration;

  const input = (info as Record<string, unknown>)["input"];
  if (typeof input !== "object" || input === null) return declaration;

  // MCP declarations have no method and never gain one.
  if ((input as Record<string, unknown>)["type"] === "mcp") return declaration;

  return {
    ...declaration,
    info: { ...(info as Record<string, unknown>), input: { ...input, method } },
  };
}
