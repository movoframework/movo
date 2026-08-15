# Validation

Movo runs upstream's validators at build time and raises an error-level `Finding` for anything
upstream would silently drop.

## Why this exists

Upstream's runtime behaviour is a **soft drop**: an invalid field is removed and the rest of the
listing is catalogued. That is right for a facilitator — refusing a whole listing over one bad
field would serve nobody — and wrong for you, because nothing tells you it happened. Your listing
simply appears without an icon, or without a name, or not at all.

Escalation does not change the wire behaviour. It changes when you find out.

```ts no-check
import { validateDiscoveryStrict } from "@movoframework/bazaar";

for (const finding of validateDiscoveryStrict(compiled)) {
  console.log(`[${finding.level}] ${finding.title}`);
  if (finding.fix) console.log(`  fix: ${finding.fix}`);
}
```

Or let the mount do it, and fail the boot:

```ts no-check
await mountExpress(server, app, { config: { config }, strictDiscovery: true });
```

`strictDiscovery` is off by default — a soft-dropped icon should not stop a server booting — and
worth turning on in a deploy gate, where shipping a listing that will silently lose fields is the
worse outcome.

## The findings

| Finding id | Code | What upstream would do |
|---|---|---|
| `bazaar.route-template` | `MOVO_E_DISCOVERY_ROUTE_TEMPLATE_INVALID` | Refuse the resource a catalog key entirely |
| `bazaar.service-name` | `MOVO_E_DISCOVERY_SERVICE_NAME_INVALID` | Drop the name; listing appears unnamed |
| `bazaar.tags` | `MOVO_E_DISCOVERY_TAGS_INVALID` | Truncate to 5, drop invalid ones |
| `bazaar.icon-url` | `MOVO_E_DISCOVERY_ICON_URL_INVALID` | Drop the icon (SSRF control) |
| `bazaar.extension-spec` | `MOVO_E_DISCOVERY_EXTENSION_INVALID` | Reject the declaration |
| `bazaar.extension-consistency` | `MOVO_E_DISCOVERY_EXTENSION_INVALID` | Log a warning and serve it anyway |
| `bazaar.schema-underived` | `MOVO_W_DISCOVERY_SCHEMA_UNDERIVED` | Nothing — Movo had no schema to send |

Every one carries upstream's own reasoning in `detail`, verbatim where upstream supplied text.
Upstream's wording describes upstream's rule better than a paraphrase would, and paraphrasing is
how a second, drifting description of a rule gets created.

## `iconUrl` is an SSRF control, not a style rule

A catalog **fetches** this URL to display your icon. Loopback addresses, private ranges and IP
literals are refused because a catalog operator following a link into their own network is the
classic server-side request forgery. `http://127.0.0.1/icon.png` is not rejected for being
untidy.

## Movo owns none of these rules

Every check in `validateDiscoveryStrict` calls an upstream export:

| Check | Upstream function |
|---|---|
| Route template | `validateRouteTemplate` |
| Service metadata | `sanitizeResourceServiceMetadata`, `sanitizeTags` |
| Declaration | `validateDiscoveryExtensionSpec`, `validateDiscoveryExtension` |

`pnpm check:upstream-validators` enforces this mechanically (AC4.8). It fails on a declared
validator, a regular-expression literal, or a restated length constant in `packages/bazaar` — and
it also fails if the package stops importing upstream validators altogether, because a package
that validates nothing would otherwise satisfy every negative rule.

If you find a rule upstream genuinely does not cover, that is a contribution upstream, not a
validator in Movo.
