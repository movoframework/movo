/**
 * A two- and three-column aligned table.
 *
 * Deliberately not a dependency. `movo dev`'s boot output and `movo doctor`'s config table are
 * the only tables in the product, both are fixed-shape, and a table library would add an
 * install-time surface to a CLI whose whole argument is that the toolchain should be small.
 * Node's `util.parseArgs` was chosen over an argument parser for the same reason (spec §10, M5
 * dependencies).
 *
 * No wrapping and no truncation: a Stellar address is 56 characters and truncating one turns a
 * copy-pasteable value into a value that has to be retyped from a wallet.
 */

/** One row: a label, its value, and an optional trailing note such as provenance. */
export interface Row {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

function widthOf(rows: readonly Row[], pick: (row: Row) => string): number {
  return rows.reduce((widest, row) => Math.max(widest, pick(row).length), 0);
}

/**
 * Render rows as an aligned, borderless table.
 *
 * Borderless because the output is read in a terminal and pasted into issues, where box-drawing
 * characters are the first thing to break.
 *
 * @param rows - The rows to render
 * @param options - Left indent, and a decorator applied to each note
 * @returns One line per row, without a trailing newline
 */
export function renderTable(
  rows: readonly Row[],
  options?: { readonly indent?: string; readonly note?: (text: string) => string },
): string {
  if (rows.length === 0) return "";

  const indent = options?.indent ?? "  ";
  const decorate = options?.note ?? ((text: string): string => text);
  const labelWidth = widthOf(rows, (row) => row.label);
  const valueWidth = widthOf(rows, (row) => row.value);

  return rows
    .map((row) => {
      const label = row.label.padEnd(labelWidth);
      if (row.note === undefined) return `${indent}${label}  ${row.value}`.trimEnd();
      const value = row.value.padEnd(valueWidth);
      return `${indent}${label}  ${value}  ${decorate(row.note)}`.trimEnd();
    })
    .join("\n");
}
