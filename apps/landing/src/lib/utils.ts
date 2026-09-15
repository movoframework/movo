type ClassValue = string | false | null | undefined;

/** Joins Tailwind class fragments, dropping falsy values. No conflict resolution — the callers here never pass conflicting utilities for the same property. */
export function cn(...values: readonly ClassValue[]): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}
