# `movo doctor`

```bash
movo doctor [--json] [--check <id>]... [--fail-on warn|error] [--timeout <ms>]
```

Run it first, and run it again whenever something is confusing.

A payment failure is one of the least informative errors in software: the message describes the
payment, and the cause is almost always something about the account, the trustline or the
facilitator that nobody looked at. `movo doctor` looks at all of it in advance and attaches a
remedy to everything it finds.

## What it checks

Checks run in order of how fundamental their failures are. A developer whose Node is too old
should read that before six timeouts caused by it.

### Environment

| id | Checks | Level when it fails |
|---|---|---|
| `node` | The running Node is 22 or later | `warn` |
| `pins` | Installed `@x402/*` versions match `docs/COMPATIBILITY.md` | `warn` |

**`node`** — Node 22 is the first line with native TypeScript stripping, which is what lets a
Movo project run `src/server.ts` with no build step. Below it, nothing loads.

**`pins`** — `@x402/*` versions are exact-pinned (spec §1.13) because upstream ships roughly
weekly with `~`-tight cross-package pins. A drifted install is running against a protocol surface
no conformance run has covered. A package installed but *absent* from the matrix counts as drift
too: the matrix is generated evidence, and a dependency it does not record is one nothing checked.

**Fix:** either regenerate the matrix with `pnpm generate:compat` after deliberately bumping the
pin, or reinstall to match it.

### Configuration

| id | Checks | Level when it fails |
|---|---|---|
| `config` | `movo.config.ts` resolves, and every resource compiles | `error` |

Reaching this check at all means the pubnet interlock, the network identifier, the `payTo` format
and the secret-in-config rule already passed — each of those throws during resolution.

What remains is compilation: missing prices, duplicate route keys, wildcard paths, undescribed
parameters. A compilation failure is reported as an error-level **finding**, not as a crash, so
the remaining checks still run. A doctor that aborted on the first throw would show one problem
and hide the rest.

### Stellar

| id | Checks | Level when it fails |
|---|---|---|
| `stellar.account` | The `payTo` account exists and is funded | `error` |
| `stellar.trustline` | It has a trustline for the asset you charge in | `error` |
| `stellar.asset` | The asset contract resolves, and its decimals are read from the contract | `error` |
| `stellar.facilitator` | The facilitator is reachable and `/supported` advertises your network and `exact` | `error` |
| `stellar.expiry` | `maxTimeoutSeconds` leaves enough ledger headroom | `warn` |
| `stellar.clock` | Local clock skew against the network | `warn` |

These run **sequentially**, and the order is deliberate. `account` before `trustline` before
`asset` means the first failure you read is the most fundamental one, rather than three findings
all describing the same missing account.

**`trustline` is the check that justifies the package.** A Stellar account cannot hold an asset
it has no trustline for, and a payment to an account without one fails with a message that says
nothing about the trustline. Its fix walks through friendbot, the Lab's change-trust flow, and
[Circle's faucet](https://faucet.circle.com) — which is captcha-gated, so that step is manual by
design and Movo does not try to work around it.

**`facilitator` never sends a credential.** It reads `/supported` only. A preflight that
authenticated would be probing with a secret to answer a question that does not need one.

A network timeout produces a **`warn`, never an `error`**: a slow RPC is not a misconfiguration,
and failing a deploy gate because someone's network was briefly congested teaches people to
disable the gate.

### Discovery

| id | Checks | Level when it fails |
|---|---|---|
| `bazaar` | Every declared discovery field survives upstream's own validators | `error` |

Derivation runs before validation, because upstream's validator reads `route.extensions` and a
freshly compiled app does not have them yet. Validating first would report nothing and read as a
clean bill of health.

See [bazaar.md](bazaar.md) for what each discovery finding means.

## Selecting checks

```bash
movo doctor --check node --check pins        # environment only
movo doctor --check stellar.trustline        # one Stellar check
```

An unknown id is an error (exit `2`), not a silent no-op. A typo that ran nothing would report
success for a check that never executed.

## Exit codes and `--fail-on`

By default the command exits non-zero when any finding is at `error`. `--fail-on warn` lowers the
threshold.

```bash
movo doctor --fail-on warn    # for a deploy gate
```

Severity policy is yours, not the library's. `Finding.level` is a fact about the world; whether a
warning should fail a build depends on what you are doing, which is why this is a flag and not a
constant baked into `@movoframework/stellar` (spec §5.6).

## `--json`

```bash
movo doctor --json | jq '.findings[] | select(.level == "error")'
```

```json
{
  "ok": true,
  "findings": [
    {
      "id": "env.node-version",
      "level": "ok",
      "title": "Node.js version",
      "detail": "v24.14.0 (minimum 22).",
      "group": "Environment"
    }
  ],
  "config": [
    { "key": "network", "value": "stellar:testnet", "source": "config" },
    { "key": "payTo", "value": "GCQQ…MQ4E", "source": "env" },
    { "key": "facilitator.authHeaders", "value": "configured (hidden)", "source": "config" }
  ]
}
```

Nothing but JSON goes to stdout, so the stream parses whole. `--json` respects `--fail-on` the
same way the human output does.

`findings[].id` is stable — CI configurations filter on it, so changing one is a major version.

## The configuration table

Every resolved value, with the **layer that supplied it**:

```text
Resolved configuration
  env                         testnet                                                   from config
  network                     stellar:testnet                                           from config
  payTo                       GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E  from env
  facilitator.url             https://www.x402.org/facilitator                          from config
  facilitator.authHeaders     configured (hidden)                                       from config
  facilitator.timeoutMs       10000                                                     from default
```

The provenance column is the reason the table exists. Five layers —
`default < config < env < resource < argument` — and the most common support conversation a
configurable payment tool has is "it is charging the wrong account", where the answer is always
that a layer nobody was thinking about supplied it. One line of output replaces that conversation.

**A configured API key appears in zero bytes of this output**, in either format. It renders as
`configured (hidden)` — never a prefix, never a suffix, never a length, since four characters is
enough to confirm a guess and a length narrows a search. This is asserted byte-for-byte in
`tests/integration/cli-doctor.test.ts` rather than argued for here.

## Running the checks in your own CI

Every check is a library export. That is deliberate: a check that only a CLI can run cannot be
run by your pipeline.

```ts no-check
import { checkNodeVersion, checkPinDrift } from "@movoframework/core";
import { preflight } from "@movoframework/stellar";

const findings = await preflight(resolvedConfig, { checks: ["account", "trustline"] });
const failed = findings.filter((finding) => finding.level === "error");
```

`preflight` returns findings and **never throws for a negative result**. A missing trustline is
data about the world, not an exceptional condition.
