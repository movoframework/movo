/**
 * Fixture secrets, used only to assert that redaction works.
 *
 * These are synthetic strings with the right *shape* and no cryptographic validity — they
 * carry no strkey checksum and correspond to no account on any network. That is deliberate:
 * a test fixture that was a real key, even a worthless testnet one, would be a real key in a
 * public repository, and the argument for why that is fine is one nobody should have to make.
 *
 * Shape is all redaction inspects, so shape is all the fixture needs.
 */

/** Base32 alphabet used by Stellar strkeys. */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Build a shape-valid Stellar key: a version letter followed by 55 base32 characters.
 *
 * @param version - Version letter: `S` secret seed, `G` account, `C` contract
 * @param nonce - Varies the body so distinct fixtures do not collide
 * @returns A 56-character strkey-shaped string
 */
export function fixtureStrkey(version: "S" | "G" | "C", nonce: number): string {
  let body = "";
  for (let index = 0; index < 55; index += 1) {
    body += BASE32[(index * 7 + nonce * 13) % BASE32.length];
  }
  return `${version}${body}`;
}

/** The canonical fixture secret seed. Must appear in zero bytes of any Movo output. */
export const FIXTURE_STELLAR_SEED: string = fixtureStrkey("S", 1);

/**
 * A fixture facilitator credential.
 *
 * Assembled from words rather than written as one literal, and the reason is not style. The
 * first version of this line was a single high-entropy string under a name containing
 * `API_KEY`, and the repository's own gitleaks scan flagged it — correctly. A secret scanner
 * cannot tell a convincing fake from a real credential, which is the whole point of it, so a
 * fixture that looks like a credential either fails the scan or has to be allowlisted. An
 * allowlist entry is worse: it is permanent, it applies to a file that will keep changing, and
 * it teaches the next contributor that suppressing the scanner is routine.
 *
 * A fixture only has to be a *distinctive string that must not appear in output*. Nothing
 * about the tests needs it to look random. This version cannot trip any detector, and if it
 * ever does surface in a failure message a human reads it and immediately knows it is a
 * fixture.
 */
export const FIXTURE_API_KEY: string = [
  "movo",
  "fixture",
  "facilitator",
  "credential",
  "not",
  "a",
  "real",
  "key",
].join("-");

/**
 * Assert that no fixture secret appears anywhere in a body of text.
 *
 * @param text - Serialised output to inspect
 * @param secrets - Secrets that must be absent
 * @returns The secrets that were found, empty when the output is clean
 */
export function findLeakedSecrets(text: string, secrets: readonly string[]): readonly string[] {
  return secrets.filter((secret) => text.includes(secret));
}
