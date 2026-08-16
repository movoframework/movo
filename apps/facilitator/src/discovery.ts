/**
 * The discovery HTTP surface — `GET /discovery/resources` and `GET /discovery/search`.
 *
 * Mounted on the same Hono app as `/verify`, `/settle` and `/supported`, because that is where
 * the specification puts it and where `withBazaar` looks for it: a buyer wraps their
 * `HTTPFacilitatorClient` and calls `extensions.bazaar.listResources()`, which hits
 * `<facilitator>/discovery/resources`. A catalog on a different host is a catalog no stock
 * client finds.
 *
 * **Both responses are upstream's shapes**, produced by `@movoframework/catalog` from
 * `DiscoveryResourcesResponse` and `SearchDiscoveryResourcesResponse`. Nothing here adds a
 * field. That is what §25.11 means by not being a walled garden — the wire format is the one
 * every other facilitator emits, so a Stellar listing is legible to a client that has never
 * heard of Movo.
 */

import type { Catalog } from "@movoframework/catalog";
import type { Hono } from "hono";

/** Parse a bounded integer query parameter, ignoring anything unparseable. */
function integerParam(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

/**
 * Mount the two discovery routes.
 *
 * @param app - The facilitator's Hono application
 * @param catalog - The catalog backing them
 */
export function mountDiscoveryRoutes(app: Hono, catalog: Catalog): void {
  app.get("/discovery/resources", async (context) => {
    const query = context.req.query();

    // Every filter the specification names: type, payTo, scheme, network, extensions, limit,
    // offset. Absent parameters are omitted rather than passed as undefined, so a filter is
    // either applied or not present — never "applied with an undefined value".
    const response = await catalog.list({
      ...(query["type"] === undefined ? {} : { type: query["type"] }),
      ...(query["payTo"] === undefined ? {} : { payTo: query["payTo"] }),
      ...(query["scheme"] === undefined ? {} : { scheme: query["scheme"] }),
      ...(query["network"] === undefined ? {} : { network: query["network"] }),
      ...(query["extensions"] === undefined ? {} : { extensions: query["extensions"] }),
      ...(integerParam(query["limit"]) === undefined
        ? {}
        : { limit: integerParam(query["limit"]) as number }),
      ...(integerParam(query["offset"]) === undefined
        ? {}
        : { offset: integerParam(query["offset"]) as number }),
    });

    return context.json(response, 200);
  });

  app.get("/discovery/search", async (context) => {
    const query = context.req.query();

    const response = await catalog.search({
      query: query["query"] ?? "",
      ...(query["type"] === undefined ? {} : { type: query["type"] }),
      ...(query["payTo"] === undefined ? {} : { payTo: query["payTo"] }),
      ...(query["scheme"] === undefined ? {} : { scheme: query["scheme"] }),
      ...(query["network"] === undefined ? {} : { network: query["network"] }),
      ...(query["extensions"] === undefined ? {} : { extensions: query["extensions"] }),
      ...(integerParam(query["limit"]) === undefined
        ? {}
        : { limit: integerParam(query["limit"]) as number }),
      ...(query["cursor"] === undefined ? {} : { cursor: query["cursor"] }),
    });

    return context.json(response, 200);
  });

  // A read-only browse page for humans. Explicitly not a marketplace: no accounts, no
  // ordering the operator controls, no promotion. It renders what the API returns, and it
  // exists because a catalog nobody can look at is hard to trust or debug.
  app.get("/browse", async (context) => {
    const searchTerm = context.req.query("q") ?? "";
    const response =
      searchTerm === ""
        ? await catalog.list({ limit: 50 })
        : await catalog.search({ query: searchTerm, limit: 50 });

    const items = "items" in response ? response.items : response.resources;

    const escapeHtml = (value: string): string =>
      value.replace(
        /[&<>"']/g,
        (character) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
          character,
      );

    const rows = items
      .map(
        (item) => `<tr>
      <td>${escapeHtml(item.serviceName ?? "—")}</td>
      <td><code>${escapeHtml(item.resource)}</code></td>
      <td>${escapeHtml(item.description ?? "")}</td>
      <td>${escapeHtml((item.tags ?? []).join(", "))}</td>
      <td>${escapeHtml(item.type)}</td>
    </tr>`,
      )
      .join("\n");

    return context.html(
      `<!doctype html><meta charset="utf-8"><title>Bazaar catalog</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;max-width:70rem}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}
code{font-size:.85em;word-break:break-all}</style>
<h1>Bazaar catalog</h1>
<form><input name="q" value="${escapeHtml(searchTerm)}" placeholder="search…" size="40"><button>Search</button></form>
<p>${String(items.length)} listing(s). Ranking is never for sale — see docs/discovery/search-quality.md.</p>
<table><tr><th>Service</th><th>Resource</th><th>Description</th><th>Tags</th><th>Type</th></tr>
${rows}</table>`,
      200,
    );
  });
}
