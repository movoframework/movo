# Bazaar discovery

**Declaring discovery metadata does not create a Bazaar listing.** A listing is created by the
facilitator you configured, when a buyer pays your resource and echoes your declaration back, and
only if that facilitator operates a catalog. Movo reports what your facilitator said. It cannot
promise inclusion, and neither can anyone else in the chain except the operator of the catalog
itself.

That sentence is first because over-claiming discovery is the fastest available way to lose the
trust of the people this framework is for. If you read nothing else on this page, read it.

## Four concepts, four owners

The word "discovery" gets used for all four of these, which is why they are so easily confused —
and why a framework that blurs them ends up promising something it does not control.

| # | Concept | What happens | Who owns it |
|---|---|---|---|
| **(a)** | **Metadata authoring** | A resource declares what it accepts and returns | **You**, through `defineResource`. Movo derives the upstream declaration from it |
| **(b)** | **Advertisement** | The declaration travels on the 402 in `extensions.bazaar` | **Movo + upstream.** Movo attaches it; `bazaarResourceServerExtension` enriches it |
| **(c)** | **Cataloging** | A paid, echoed declaration is validated and stored | **The facilitator you configured** — not Movo, not you |
| **(d)** | **Discovery infrastructure** | Listing, search, ranking, the catalog API | **The facilitator**, if it runs one at all |

Movo participates in (a) and (b). It reports (c)'s outcome when the facilitator chooses to tell
you. It has no part in (d) whatsoever.

**The load-bearing consequence:** you can do everything on this page correctly and still not
appear in any catalog, because your facilitator may not operate one. That is not a Movo bug and
not a configuration error. It is the architecture.

## What Movo actually contributes

Upstream `@x402/extensions` already ships every Bazaar validator, including the icon-URL SSRF
check and route-template validation with percent-decoded traversal detection. Movo implements
none of them and never will — two validators that disagree is a bug factory, and the
security-relevant ones belong upstream where the whole ecosystem benefits from a fix.

Movo contributes exactly two things.

### Derivation — the metadata cannot drift from the route

```ts no-check
export default defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  input: z.object({ city: z.string().describe("City name or IATA code") }),
  discovery: { example: { city: "SFO" } },
  handler: (ctx) => ({ tempC: 14 }),
});
```

One declaration. The route, the handler, the input schema and the listing all come from it, so a
listing cannot advertise a path you renamed last week. Upstream's model asks you to maintain
those as separate artefacts and detects nothing when they stop agreeing.

### Escalation — upstream's silence becomes your build error

A facilitator that receives an over-long `serviceName` **drops that field and catalogues the
rest**. That is correct for a facilitator: refusing a whole listing over one bad field would
serve nobody. But it means the first you hear of it is a listing with no name, no error anywhere,
and nothing to search for.

Movo runs the same upstream validators at build time and raises an error-level `Finding` with a
fix. The wire behaviour is unchanged — escalation changes *when you find out*, not what happens.

```
[error] GET /weather/:city: iconUrl would be dropped from the listing
        Upstream's isValidIconUrl rejects "http://127.0.0.1:8080/icon.png". It enforces an
        SSRF control — a catalog fetches this URL, so loopback addresses, private ranges and
        IP literals are refused. The field is dropped silently at runtime.
   fix: Use an absolute https URL with a public hostname.
```

## Reading the outcome

When a buyer pays, the facilitator *may* return an `EXTENSION-RESPONSES` header saying what it
did with your declaration. **Its absence carries no signal** — the specification makes it
optional and at least one major facilitator never emits it.

```ts no-check
import { readCatalogOutcome } from "@movoframework/bazaar";

const outcome = readCatalogOutcome(response.headers.get("EXTENSION-RESPONSES"));
```

| Status | Means | Is it a problem? |
|---|---|---|
| `success` | Catalogued | No |
| `processing` | **Accepted**, indexing later | **No** |
| `rejected` | The facilitator declined, with a reason when it gave one | Yes |
| `unknown` | No signal: absent, malformed, or no bazaar entry | **No** |

Two of those four trip people up. `processing` is an acceptance, not a failure. `unknown` is the
absence of information, not the presence of bad news. `readCatalogOutcome` never returns
`undefined`, precisely so that `if (!outcome)` cannot become a false failure path — and
`isCatalogRejection` exists because `outcome.status !== "success"` is the natural thing to write
and is wrong three ways.

## Where to go next

- [Declaring metadata](declaring-metadata.md) — what to put in `discovery`, and the schema
  derivation limits
- [Validation](validation.md) — every escalated finding and how to fix it
- [Troubleshooting visibility](troubleshooting-visibility.md) — "I declared discovery and I am
  not in the catalog"
