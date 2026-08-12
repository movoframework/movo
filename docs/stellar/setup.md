# Stellar setup

Four steps, in order. Step 3 is the one everybody misses, and missing it produces a failure that
says nothing about the account that caused it.

## 1. A keypair

You need two accounts to test a payment: one that receives (the seller) and one that pays (the
buyer). Create them in [Stellar Lab](https://lab.stellar.org) or with the Stellar CLI:

```bash
stellar keys generate seller --network testnet
stellar keys address seller     # G... — this is what MOVO_PAY_TO wants
```

**Public addresses begin with `G`. Secret seeds begin with `S`.** `MOVO_PAY_TO` is published in
the `PAYMENT-REQUIRED` header of every unpaid request, so it must be the `G` value. Movo rejects
an `S` address at startup with `MOVO_E_PAYTO_INVALID` — that guard exists because the two strings
look alike, sit next to each other in every wallet UI, and one of them being in the wrong
variable would broadcast your signing key to every buyer that touched your API.

A Movo resource server never needs a secret key at all. It names an address; the buyer signs.

## 2. Funding

An account does not exist on Stellar until it holds the base reserve:

```bash
curl "https://friendbot.stellar.org/?addr=<G...>"
```

Until this succeeds, Horizon answers 404 for the address and the `account` preflight check
reports it as an error.

## 3. The USDC trustline — the step that catches people

**An account cannot receive an asset it does not trust.** There is no error when you configure
it, no warning when the server starts, and the eventual failure talks about the asset rather than
about your account.

Add a trustline to Circle's testnet USDC on **both** accounts:

```bash
stellar tx new change-trust \
  --source-account seller \
  --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --network testnet
```

Or use the change-trust flow in [Stellar Lab](https://lab.stellar.org).

Do not take that issuer from this page on trust. Movo derives it from the contract itself, and
you can too:

```ts no-check
import { getUsdcAddress } from "@movoframework/core";
import { readAssetMetadata } from "@movoframework/stellar";

const contract = getUsdcAddress("stellar:testnet");
const { classic } = await readAssetMetadata(contract, "stellar:testnet");
console.log(classic); // { code: "USDC", issuer: "GBBD47IF…" }
```

This matters more than it looks. **Asset codes are not unique on Stellar** — anyone can issue an
asset called USDC. A trustline to the wrong issuer looks correct in a wallet and still cannot
receive payment, so Movo's `trustline` check verifies the issuer, not just the code, and reports
a wrong-issuer trustline as a distinct error.

## 4. Testnet USDC for the buyer

Get it from [Circle's faucet](https://faucet.circle.com), choosing Stellar Testnet. The faucet is
captcha-gated, so this step is manual by design and cannot be scripted. The seller does not need
a balance — only a trustline — but the buyer needs both.

## Check your work

```ts no-check
import { resolveConfig } from "@movoframework/core";
import { preflight } from "@movoframework/stellar";

for (const finding of await preflight(resolveConfig())) {
  console.log(`[${finding.level}] ${finding.title}`);
  if (finding.fix) console.log(`  fix: ${finding.fix}`);
}
```

Six checks run in order — account, trustline, asset, facilitator, expiry, clock — and the order
is deliberate: the first failure you see is the most fundamental one, rather than three errors
all describing the same missing account.

A green run looks like this:

```
[ok] payTo account exists and is funded
[ok] payTo trusts the configured asset
[ok] asset contract resolves and declares its decimals
[ok] facilitator is reachable and supports this network and scheme
[ok] maxTimeoutSeconds leaves usable headroom
[ok] local clock agrees with the network
```

## Notes worth having

**Fees are sponsored on testnet.** The public facilitator advertises `areFeesSponsored: true`, and
it holds: in a settled Movo transaction the *source account* is the facilitator's, not the
buyer's. The buyer pays the asset amount and none of the Stellar network fee. If you configure a
facilitator that does not sponsor, buyers need XLM as well as USDC, and the `facilitator` check
says so.

**Decimals are read, not assumed.** Stellar USDC has 7, so one USDC is `10000000` base units. Movo
never computes that conversion itself — `@x402/stellar` does it against the asset's real
decimals, and the `asset` check reads the value from the contract rather than trusting the
default.

**Clock skew is worth a glance.** Payment authorisations are bounded by ledger sequence, and a
machine whose clock has drifted computes expiry against the wrong "now". Containers on a
suspended host are the usual culprit. The `clock` check measures skew against Horizon's own
`Date` header.
