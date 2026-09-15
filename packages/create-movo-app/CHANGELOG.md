# create-movo-app

## 0.1.0

### Minor Changes

- 5706a06: The CLI, the scaffolder, and the developer experience layer.

  **`create-movo-app`.** `npm create movo-app my-api` produces a real working project: two
  templates, `minimal` and `discoverable`, both of them **workspace members** compiled, linted and
  tested by CI. A template kept as an embedded string rots within weeks and rots invisibly, because
  nothing compiles it. Three things are rewritten at scaffold time and cannot survive the copy:
  `workspace:*` ranges, which no registry can resolve; `tsconfig.json`, which extends a monorepo
  base a generated project cannot see; and `gitignore` → `.gitignore`, because npm renames a
  published `.gitignore` to `.npmignore` and a user's `.env` would arrive unignored.

  **`@movoframework/cli`.** Four commands. `movo doctor` runs every check Movo has — Node version,
  `@x402/*` pin drift, configuration, compilation, six Stellar preflight checks, discovery
  validation — renders each with its fix and docs link, and exits on a `--fail-on` threshold you
  choose. **It composes library exports and implements no check of its own**, because a check that
  only a CLI can run cannot be run by a downstream project's CI. `movo dev` prints the resolved
  configuration with the provenance of every value and every paid route's method, path, price,
  network and `payTo`, then watches with Node's own `--watch`. `movo test` wraps Vitest and
  forwards arguments verbatim. `movo bazaar validate|list|search` exposes M4's escalation from a
  terminal.

  A configured facilitator API key appears in **zero bytes** of any output, asserted byte-for-byte
  rather than argued for. `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb` and TTY state are all honoured;
  colour is off unless positively known to be safe, because doctor output gets pasted into bug
  reports. No argument parser, no table library, no colour library — `util.parseArgs` and about
  thirty lines.

  **`@movoframework/core`.** Two new environment checks, `checkNodeVersion` and `checkPinDrift`,
  as pure functions over injected data — the CLI reads the environment, the library judges, so core
  stays free of I/O while the judgement stays reusable. Three new codes:
  `MOVO_W_NODE_VERSION_UNSUPPORTED`, `MOVO_W_X402_PIN_DRIFT`, and
  `MOVO_E_FACILITATOR_PUBNET_REFUSED` — the last one distinct from `MOVO_E_PUBNET_NOT_ENABLED`
  because that code's fix is "set `MOVO_ALLOW_PUBNET=1`" and this refusal fires _after_ that has
  been set. Handing a reader a remedy they have already applied is worse than handing them none.

  **`@movoframework/bazaar`.** `attachDiscovery` is now a public export: derive every declaration,
  attach it, then escalate. The ordering is the part that is easy to get wrong — upstream's
  validator reads `route.extensions`, which a freshly compiled app does not have, so validating
  first reports nothing and reads as a clean bill of health. It was previously private to the
  mount; `movo doctor` and `movo bazaar validate` need exactly the same sequence, and a second copy
  in the CLI would have been two orderings free to drift.

  **`@movoframework/testing`.** A `./setup` subpath registering the matchers, preloaded by `movo
test`. `withPaidServer` accepts `config` layers, so a generated test passes on a fresh clone
  rather than only on a machine that already has `MOVO_PAY_TO` set.

  **`@movoframework/server`.** The mount now calls `attachDiscovery` and keeps only the
  `strictDiscovery` policy locally — whether a misdeclared listing should stop a server booting is
  a deployment decision, not a fact about the metadata.

- M8 — the testnet-complete v0.1.0 release. No new features.

  Adds the dedicated stock-client conformance suite (§1.16 layer 4, the RFP's literal acceptance
  test): an unmodified `@x402/fetch` + `@x402/stellar` client drives a full payment through the Movo
  stack, with the scheme matrix read from the deployment's own `/supported` and the network matrix
  carrying both networks from the start. Settlement is confirmed from Horizon, not from the
  `PAYMENT-RESPONSE` header, and every rejection is asserted to carry a distinct non-null reason.

  Pubnet is a configuration flip rather than a code change, behind an explicit opt-in that is
  separate from its credentials — holding pubnet keys is not sufficient to spend them. v0.1.0 is
  **testnet-complete**: pubnet settlement, the mainnet production tag and the third-party security
  review are the committed production follow-on, not part of this release.

  Release engineering: npm OIDC trusted publishing with automatic provenance and no long-lived
  token, `LICENSE` and repository metadata in every package, `CODEOWNERS`, and the key-management
  threat model the future third-party review reads.
