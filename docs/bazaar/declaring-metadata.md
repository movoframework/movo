# Declaring metadata

Everything in a Bazaar listing comes from the resource declaration. This page covers the parts
derivation cannot infer, and the one place it has a real limit.

## The minimum

```ts no-check
export default defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current weather conditions for a city",
  input: z.object({ city: z.string().describe("City name or IATA code") }),
  discovery: {},                       // ← opts in; everything else is derived
  handler: (ctx) => ({ tempC: 14 }),
});
```

`discovery: {}` is a complete declaration. The method, path, description and schemas are already
on the resource, and derivation reads them from there.

**`discovery: false` is not the same as omitting it.** It states "we decided not to list this",
which a reader can tell apart from "nobody thought about it".

## Service metadata

`serviceName`, `tags` and `iconUrl` may sit on the resource or on project config, where they
apply to every resource that does not override them.

```ts no-check
export default defineConfig({
  discovery: {
    enabled: true,
    serviceName: "Example Weather",     // ≤ 32 printable ASCII
    tags: ["weather", "forecast"],      // ≤ 5, each ≤ 32 printable ASCII
    iconUrl: "https://example.com/icon.png",
  },
});
```

Those limits are upstream's, not Movo's — Movo neither restates nor re-checks them. If you exceed
one, upstream drops the field silently and Movo raises an error-level finding telling you so. See
[validation](validation.md).

## `example` is worth supplying

```ts no-check
discovery: {
  example: { city: "SFO" },
  outputExample: { city: "SFO", tempC: 14, conditions: "foggy" },
}
```

Upstream validates the example against the derived input schema. A schema with required fields
and no example produces a declaration whose own example would not satisfy it — an agent copying
it from your listing gets a 400. Upstream logs a warning about this at request time; Movo raises
it at build time as `bazaar.extension-consistency`.

## Input schema derivation, and its limit

Movo resolves the listing's `inputSchema` in four steps, most explicit first:

1. an explicit `discovery.inputSchema` — always wins
2. a value that already is a JSON Schema
3. a vendor Movo can convert
4. nothing, plus a `MOVO_W_DISCOVERY_SCHEMA_UNDERIVED` warning

**Step 3 is where the real limit lives, and it is structural.** Standard Schema v1 describes
*validation* — a `validate` function and, at type level, the input and output types. It carries
no JSON Schema and no way to produce one. A vendor-neutral conversion is therefore not merely
unimplemented, it is not expressible.

Movo converts **Zod v4 schemas** by optional dynamic import, so Zod is never a dependency of
`@movoframework/bazaar` — a project using Valibot pays nothing for this, and a project using Zod
gets derivation for free.

```ts no-check
import { z } from "zod/v4";            // ← the v4 entry, even inside Zod 3.25+
```

Zod's **classic (v3) schemas are not convertible**: only the v4 shape carries the internals
`toJSONSchema` reads. Both report the vendor `"zod"`, so Movo detects the flavour and says which
one you have rather than failing obscurely:

```
[warn] GET /weather/:city declares discovery but its input schema could not be
       converted to JSON Schema
       GET /weather/:city: this is a Zod 3 "classic" schema, which has no JSON Schema
       converter. Import your schema builder from "zod/v4" (available inside Zod 3.25+ as
       well as Zod 4), or supply an explicit inputSchema.
```

### The override

Use it when derivation is impossible, or when it is lossy — a `.transform()` or a branded type
describes something JSON Schema cannot:

```ts no-check
discovery: {
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", description: "City name or IATA code" } },
    required: ["city"],
  },
}
```

The override always wins. An author who has written one has made a decision, and Movo does not
re-derive and prefer its own answer.

## MCP tools

A resource can be declared as an MCP tool instead of an HTTP endpoint:

```ts no-check
discovery: {
  toolName: "financial_analysis",
  transport: "streamable-http",
}
```

Upstream requires an `inputSchema` for MCP, so a tool whose schema cannot be derived needs the
override.

One upstream note worth recording: the specification names both `declareDiscoveryExtension` and
`declareMcpDiscoveryExtension`, but the installed package exports only the first, which
dispatches on whether `toolName` is present. Movo follows the package rather than the
specification here, and asserts it in `upstream-conformance.test.ts` so a future change is caught
by a test rather than by a broken listing.

## Body types

Methods that carry a body (POST, PUT, PATCH) need a `bodyType`; it defaults to `"json"`.

```ts no-check
discovery: { bodyType: "form-data" }
```

Query methods (GET, HEAD, DELETE) take none — upstream's config for them has no such field, and
setting one produces a shape its own validator rejects.
