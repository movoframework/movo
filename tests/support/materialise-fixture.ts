/**
 * Materialise a `.tmpl` fixture tree into a real directory, substituting Movo identifiers.
 *
 * Proof-of-failure fixtures are committed as templates, not as runnable files, so that no
 * fixture can carry a stale copy of an identifier the gate under test derives from a
 * constant. The M0 scope rename is the reason: the track-isolation gate and its fixtures each
 * spelled `@movo/` out in full, the rename updated the fixtures, and the fixture test kept
 * passing while the gate matched nothing in real code.
 *
 * A template is any file named `<name>.tmpl`. It is written out as `<name>` with every
 * placeholder replaced. Files without the `.tmpl` suffix are copied verbatim.
 *
 * @see packages/core/src/identity.ts
 */

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MOVO_SCOPE } from "../../packages/core/src/identity.ts";

/** Placeholders substituted into every `.tmpl` fixture. */
const PLACEHOLDERS: ReadonlyMap<string, string> = new Map([["__MOVO_SCOPE__", MOVO_SCOPE]]);

const TEMPLATE_SUFFIX = ".tmpl";

/**
 * Substitute every known placeholder in a template body.
 *
 * @param source - Raw template text
 * @returns The text with placeholders replaced
 */
export function renderTemplate(source: string): string {
  let rendered = source;
  for (const [placeholder, value] of PLACEHOLDERS) {
    rendered = rendered.split(placeholder).join(value);
  }
  return rendered;
}

function renderTree(directory: string): void {
  for (const entry of readdirSync(directory)) {
    const child = join(directory, entry);
    if (statSync(child).isDirectory()) {
      renderTree(child);
      continue;
    }
    if (!entry.endsWith(TEMPLATE_SUFFIX)) continue;
    const rendered = renderTemplate(readFileSync(child, "utf8"));
    const target = child.slice(0, -TEMPLATE_SUFFIX.length);
    writeFileSync(target, rendered, "utf8");
    rmSync(child);
  }
}

/**
 * Copy a fixture tree to a fresh temporary directory and render its templates.
 *
 * @param fixtureDirectory - Absolute path of the committed fixture tree
 * @returns An object carrying the rendered tree's path and a cleanup function
 */
export function materialiseFixture(fixtureDirectory: string): {
  readonly path: string;
  cleanup(): void;
} {
  const root = mkdtempSync(join(tmpdir(), "movo-fixture-"));
  const target = join(root, "tree");
  mkdirSync(target, { recursive: true });
  cpSync(fixtureDirectory, target, { recursive: true });
  renderTree(target);
  return {
    path: target,
    cleanup: (): void => {
      rmSync(root, { force: true, recursive: true });
    },
  };
}
