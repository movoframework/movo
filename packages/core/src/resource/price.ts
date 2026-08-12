/**
 * Price validation — the place money bugs live, so the rules are explicit and the errors long.
 *
 * Movo validates the *shape* of a price and nothing else. It performs no decimal conversion,
 * because upstream already does it against the asset's real decimals: `convertToTokenAmount`
 * and `DEFAULT_TOKEN_DECIMALS` from `@x402/stellar`, and
 * `getAssetDecimalsForRequirements` on the resource server. A second implementation of that
 * arithmetic is the classic way to produce a payment that is out by a factor of ten million
 * (spec §1.8 D4, M1 prompt §C).
 *
 * Two forms are accepted and no others:
 *
 *  - a money string, `"$0.001"` — the `$` prefix is mandatory, so a price is never a bare
 *    number whose units the reader has to guess;
 *  - an asset amount, `{ asset: "C…", amount: "10000000" }` — `asset` is a SEP-41 contract
 *    address and `amount` is an integer string in base units.
 */

import { MovoError } from "../errors/MovoError.js";
import { validateStellarAssetAddress } from "../protocol/index.js";
import { isAssetAmount, type MovoPrice } from "./types.js";

/** A money string: `$` followed by a decimal number. */
const MONEY_STRING = /^\$\d+(\.\d+)?$/;

/** An integer string in base units. No sign, no decimal point, no exponent. */
const BASE_UNIT_AMOUNT = /^\d+$/;

/**
 * The advice attached to every asset-alias rejection.
 *
 * Written once and reused so that the error text and the registry's fix template say the same
 * thing. AC1.2 asserts all three facts are present: `getUsdcAddress`, the `C…` form, and the
 * 7-decimal base-unit conversion.
 */
const ASSET_ALIAS_ADVICE =
  "Stellar SEP-41 assets are identified by contract address, which begins with C — not by ticker. " +
  "Use getUsdcAddress(network) from @x402/stellar to obtain the USDC contract address for your network. " +
  'Stellar USDC has 7 decimals, so 1 USDC is "10000000" base units.';

/**
 * Validate a price, throwing a `MovoError` if it is not one of the two accepted forms.
 *
 * @param price - The price to validate
 * @param where - Human-readable location for the error context, e.g. `GET /weather`
 */
export function validatePrice(price: unknown, where: string): asserts price is MovoPrice {
  if (typeof price === "string") {
    if (MONEY_STRING.test(price)) return;
    throw new MovoError(
      "MOVO_E_PRICE_INVALID",
      `price ${JSON.stringify(price)} on ${where} is not a valid money string. ` +
        'Write it as "$0.001" — the $ prefix is required so that a price is never a bare number with ambiguous units.',
      { context: { where, price } },
    );
  }

  if (typeof price === "number") {
    throw new MovoError(
      "MOVO_E_PRICE_INVALID",
      `price ${String(price)} on ${where} is a bare number, which does not say what it is a number of. ` +
        `Write "$${String(price)}" for a currency amount, or { asset, amount } for base units of a specific asset.`,
      { context: { where, price } },
    );
  }

  if (!isAssetAmount(price as MovoPrice)) {
    throw new MovoError(
      "MOVO_E_PRICE_INVALID",
      `price on ${where} must be a money string such as "$0.001" or an object { asset, amount }, received ${typeof price}.`,
      { context: { where, receivedType: typeof price } },
    );
  }

  const candidate = price as { asset?: unknown; amount?: unknown };

  // The asset is checked before the amount, and deliberately so: `{ asset: "USDC" }` with no
  // amount at all must still report the alias problem, because naming the asset by ticker is
  // the misconception, and reporting a missing amount first would send the reader off to fix
  // the wrong thing.
  if (typeof candidate.asset !== "string" || !validateStellarAssetAddress(candidate.asset)) {
    throw new MovoError(
      "MOVO_E_PRICE_ASSET_ALIAS",
      `price.asset ${JSON.stringify(candidate.asset)} on ${where} is not a SEP-41 contract address. ${ASSET_ALIAS_ADVICE}`,
      { context: { where, asset: candidate.asset } },
    );
  }

  if (typeof candidate.amount !== "string" || !BASE_UNIT_AMOUNT.test(candidate.amount)) {
    throw new MovoError(
      "MOVO_E_PRICE_INVALID",
      `price.amount ${JSON.stringify(candidate.amount)} on ${where} must be an integer string in base units. ` +
        "A decimal point here is almost always a unit error — use convertToTokenAmount from @x402/stellar to turn a decimal amount into base units against the asset's real decimals, rather than writing the conversion out.",
      { context: { where, amount: candidate.amount } },
    );
  }
}
