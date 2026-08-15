# `movo bazaar`

```bash
movo bazaar validate [--json]
movo bazaar list   [--facilitator <url>] [--type http|mcp] [--pay-to <G...>] [--json]
movo bazaar search --query "<text>" [--facilitator <url>] [--json]
```

## First, the honest part

**Declaring discovery metadata does not create a listing.** A listing is created by the
facilitator you configured, when a buyer pays and echoes your declaration, and only if that
facilitator operates a catalog at all. Movo cannot promise inclusion and does not.

What Movo can do is make the *silent* failures loud, which is what `validate` is for.

## `movo bazaar validate`

Upstream's posture is to drop an invalid discovery field and catalogue the rest. That is right for
a facilitator — refusing a whole listing over one bad field serves nobody — and wrong for you,
because the first you learn of it is a listing with no icon, no name, or no presence at all, with
no error anywhere and nothing to search for.

`validate` runs upstream's own validators at build time and turns each silent drop into an error
with a fix.

```bash
$ movo bazaar validate

  FAIL  GET /weather/:city: iconUrl would be dropped from the listing
        Upstream's isValidIconUrl rejects "http://localhost:3000/icon.png". It enforces an SSRF
        control — a catalog fetches this URL, so loopback addresses, private ranges and IP
        literals are refused. The field is dropped silently at runtime.
        fix  Use an absolute https URL with a public hostname.
        docs https://movoframework.github.io/movo/errors/MOVO_E_DISCOVERY_ICON_URL_INVALID
```

Exit `1` when any finding is an error, `0` otherwise.

### What it can tell you

| Finding id | Code | What upstream would have done |
|---|---|---|
| `bazaar.route-template` | `MOVO_E_DISCOVERY_ROUTE_TEMPLATE_INVALID` | Refused to catalogue the resource at all |
| `bazaar.service-name` | `MOVO_E_DISCOVERY_SERVICE_NAME_INVALID` | Dropped the name; the listing appears unnamed |
| `bazaar.tags` | `MOVO_E_DISCOVERY_TAGS_INVALID` | Dropped some tags; the resource stops being findable the way you expected |
| `bazaar.icon-url` | `MOVO_E_DISCOVERY_ICON_URL_INVALID` | Dropped the icon (an SSRF control) |
| `bazaar.extension-spec` | `MOVO_E_DISCOVERY_EXTENSION_INVALID` | Rejected the declaration on a protocol invariant |
| `bazaar.extension-consistency` | `MOVO_E_DISCOVERY_EXTENSION_INVALID` | Logged a warning at request time and served it anyway |
| `discovery.schema-underived` | `MOVO_W_DISCOVERY_SCHEMA_UNDERIVED` | Listed the resource with no parameter schema |

**Movo implements none of these validators.** Every one is an upstream `@x402/extensions` export
called through the narrow waist. `pnpm check:upstream-validators` enforces that mechanically —
see [ADR-0010](../adr/0010-bazaar-boundary.md).

The two commonest real failures are worth naming:

**`bazaar.extension-consistency`** almost always means your input schema has required fields and
no `discovery.example` matching them. Add one, so an agent reading your listing sees a request
that would actually work.

**`discovery.schema-underived`** means your validator's vendor has no JSON Schema converter.
Standard Schema describes validation, not introspection, so there is no vendor-neutral way to
produce one. Zod v4 (`import { z } from "zod/v4"`) converts; Zod's classic v3 schemas do not carry
the internals the converter reads. For anything else, set `discovery.inputSchema` explicitly —
Movo warns rather than guessing.

### In CI

```bash
movo bazaar validate --json | jq -e '.ok'
```

Or as a library call, which is the same code path:

```ts no-check
import { attachDiscovery } from "@movoframework/bazaar";
import { compileApp } from "@movoframework/core";

const compiled = compileApp(app, layers);
const findings = await attachDiscovery(compiled);   // derive, then validate
```

Derivation must run before validation — upstream's validator reads `route.extensions`, which a
freshly compiled app does not have. `attachDiscovery` does both in the right order, which is why
it exists as one call rather than two.

You can also fail the **mount** instead, with `strictDiscovery: true`, so a misdeclared listing
stops a server booting rather than shipping quietly.

## `movo bazaar list` and `search`

```bash
movo bazaar list --type http
movo bazaar search --query "weather forecast"
movo bazaar list --pay-to GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E
```

These query the facilitator's catalog. Without `--facilitator`, the one from your configuration is
used — querying a catalog other than the one you publish to answers a question nobody asked.

The response is printed as it arrived. Movo adds no filter, no ranking and no cache: catalog
policy belongs to the facilitator (spec §1.8 D3).

An empty result says so plainly rather than showing an empty table:

```text
  no resources returned. A facilitator is not obliged to operate a catalog, so an empty result
  may mean this one does not.
```

"No matches" and "this facilitator has no catalog" look identical in a table and mean very
different things.

`--json` prints the facilitator's response verbatim.

## Checking whether you were catalogued

A facilitator that received your declaration may say what it did with it, in the
`EXTENSION-RESPONSES` header of the paid response. There are **four** answers, not two:

| Status | Meaning |
|---|---|
| `success` | Catalogued |
| `processing` | Accepted, not yet catalogued |
| `rejected` | Refused, with a reason |
| `unknown` | No signal — the header was absent, empty or unreadable |

`unknown` is not a failure. A facilitator is not required to send the header at all, and treating
its absence as a rejection would report a problem that does not exist.

```ts no-check
import { isCatalogRejection, readCatalogOutcome } from "@movoframework/bazaar";

const outcome = readCatalogOutcome(response.headers.get("EXTENSION-RESPONSES"));
if (isCatalogRejection(outcome)) console.warn(outcome.rejectedReason);
```

Use `isCatalogRejection` rather than `status !== "success"` — the latter is the natural thing to
write and treats both `processing` and `unknown` as failures.
