# "I declared discovery and I am not in the catalog"

Work through these in order. The first two are by far the most common, and neither is a bug.

## 1. Does your facilitator operate a catalog at all?

Cataloging happens at the facilitator you configured — concept (c) in
[the overview](overview.md). Many facilitators verify and settle without running a catalog, and
one that does not will never list you no matter how correct your declaration is.

```bash
curl -s https://www.x402.org/facilitator/discovery/resources | head
```

A 404 answers the question.

## 2. Has anyone actually paid?

**A listing is created when a buyer pays and echoes your declaration.** Declaring metadata puts
it in your 402; it does not push anything to a catalog. A resource nobody has bought has nothing
to be catalogued from.

This surprises people because the metadata is visible in the 402 immediately, which makes it feel
published. It is not.

## 3. Did upstream drop the field you are looking for?

Run the validator. Upstream drops invalid fields silently at runtime, so a listing can exist with
your name and tags missing:

```ts no-check
import { validateDiscoveryStrict } from "@movoframework/bazaar";
console.log(validateDiscoveryStrict(compiled));
```

See [validation](validation.md). If you mounted with `strictDiscovery: true` this would already
have failed your boot.

## 4. What did the facilitator say?

```ts no-check
import { readCatalogOutcome } from "@movoframework/bazaar";
const outcome = readCatalogOutcome(response.headers.get("EXTENSION-RESPONSES"));
```

- `rejected` — it declined, and `rejectedReason` says why when it gave one
- `processing` — **accepted**, indexing later. Wait, then look again
- `success` — catalogued
- `unknown` — no signal. **Not a failure.** Many facilitators never send this header

`unknown` is the most common answer in practice and tells you nothing about whether cataloging
worked. If you are debugging visibility, it means go back to step 1 rather than conclude
anything.

## 5. Is discovery enabled?

```ts no-check
discovery: { enabled: true }
```

Disabled project-wide, nothing is derived and no extension is attached. A resource with
`discovery: false` is likewise excluded deliberately.

You can check what was declared:

```ts no-check
console.log(mounted.compiled.discoveryDeclared);   // route keys carrying a declaration
```

An empty array here means nothing was going to be catalogued regardless of what the facilitator
does.

## What Movo cannot tell you

Whether the facilitator's catalog will *rank* you, *retain* you, or show you to a particular
buyer. Inclusion policy belongs to the operator. Movo reports what it was told and does not
model, cache or predict a catalog's behaviour.
