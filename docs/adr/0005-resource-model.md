# ADR-0005 — The resource model

- **Status:** Accepted
- **Date:** 2026-08-11
- **Milestone:** M1
- **Supersedes:** nothing
- **Related:** ADR-0001 (framework abstraction model), ADR-0004 (x402 narrow waist), ADR-0006 (config precedence)

## Context

Upstream's model asks a developer to maintain three artefacts and keep them in step by hand: a
routes object naming price, network and `payTo`; a handler; and a discovery declaration
duplicating much of the route's metadata. Nothing enforces the correspondence, and when it
breaks it breaks silently — a route with no handler 404s, a handler with no route is free, and a
discovery declaration pointing at a path that no longer exists advertises a resource that cannot
be bought.

This is the one genuine ergonomic gap in the upstream packages. Everything else Movo was
originally scoped to build turned out to exist already (ADR-0001).

## Decision

**The unit of authorship is a file exporting one `defineResource({...})` object.** It compiles
to a route entry, a typed handler, and — from M4 — a discovery declaration, all derived from one
declaration.

Four properties are load-bearing:

**1. `define*` free functions returning plain data.** Not `movo.resource(...)` on a mutable app
instance, and not `createResource(...)`. `define*` signals "declare a value, no side effects".
A resource is therefore serialisable, inspectable and constructible in a test without starting a
server — which is what makes `movo doctor` able to analyse a project statically, and what makes
it cheap and reliable.

**2. Explicit registration is the documented default.** `defineApp({ resources: [a, b] })`. A
directory scan may arrive as an opt-in; it will not become the default. A scan makes the set of
paid routes depend on the filesystem at boot, and that is exactly the kind of thing that differs
between a laptop and a container — leaving a route unpaid in production.

**3. Types flow end to end.** `TIn` comes from the `input` schema into the handler's context;
`TOut` comes from the handler out to the buyer's call site. `NoInfer` on the handler's context
parameter is what makes the schema the single source of `TIn`; without it the handler parameter
contributes a competing inference candidate and the whole thing collapses to `unknown`.

**4. Structural errors throw at definition; config-dependent errors throw at compilation.** A
wildcard in a path is wrong however the project is configured. A missing `payTo` is only wrong
once you know configuration does not supply one.

Schemas are accepted through the [Standard Schema](https://standardschema.dev) interface rather
than through a dependency on Zod. The interface is declared locally because it is a published
specification whose entire purpose is to be a shape libraries agree on independently; adding a
package to obtain a type that carries no runtime code would put a dependency in the install path
of every Movo consumer for nothing.

## Alternatives considered

**`movo.resource(...)` on a mutable app instance.** Rejected: implicit global state, poor for
testing, hostile to serverless, and impossible to analyse statically.

**A `paid()` handler decorator, in the style of Next route handlers.** Retained only as a
possible thin adapter later. It cannot express route-level discovery metadata cleanly, which is
half the point.

**Config-file-driven routes.** Rejected: it discards the type inference from handler to client,
which is the largest single thing Movo adds over writing the routes object by hand.

**Reusing upstream's `RouteConfig` as the authoring surface.** Rejected: it has no handler, no
schemas and no place for input/output examples, so the three-artefact problem would remain.

## Consequences

`defineResource` is the API most exposed to backwards-compatibility pressure, and it gets the
strictest stability treatment. It is Stable from v0.1.0.

`price`, `network` and `payTo` are sugar for the single-payment-option case. A resource needing
several options writes the upstream `accepts` array. That escape hatch is documented rather than
hidden: making the common case short must not make the general case unreachable.

The `MOVO_W_PARAM_UNDESCRIBED` warning is vendor-limited. Standard Schema exposes validation but
not introspection, so there is no vendor-neutral way to ask a schema whether its fields carry
descriptions. Movo inspects a Zod-shaped `shape` when present and reports nothing otherwise — the
honest behaviour, and documented as such. A warning that silently never fires for Valibot users
would be worse than one known to be partial.

## The type-erasure trap, recorded because it cost time

`AnyMovoResource` is the element type of a heterogeneous resource list, and each field has to be
erased in the direction its variance requires:

- `handler` takes `MovoRequestContext<never>`, because the context is a contravariant position.
- `input`/`output` are `StandardSchemaV1<unknown, unknown>`, because a schema is covariant in
  its output.

Writing `MovoResource<never, unknown>` for the whole interface gets the handler right and the
schemas exactly backwards. The symptom was that `defineApp({ resources: [a, b] })` failed to
compile whenever the resources had different input types — the ordinary case.

It was caught by the documentation-codeblock gate, not by the unit suite, because every existing
test happened to build its list from resources that inferred compatibly. That is the finding
worth carrying forward: compiling the documentation exercised a shape the tests did not, which
is an argument for the gate independent of the documentation it protects.
