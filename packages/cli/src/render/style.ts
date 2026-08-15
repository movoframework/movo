/**
 * Terminal styling that degrades to nothing.
 *
 * Three ways colour is wrong, and all three are common: `NO_COLOR` is set, output is a pipe or
 * a file rather than a terminal, or the value is being captured by CI. Movo's own doctor output
 * is meant to be pasted into a bug report, so escape sequences leaking into that paste is a
 * real cost rather than a cosmetic one.
 *
 * The rule is therefore inverted from the usual default: colour is off unless it is positively
 * known to be safe. A missing `isTTY` is treated as not-a-terminal.
 *
 * @see https://no-color.org
 */

/** What the styling decision depends on. Injected so the decision is testable. */
export interface StyleEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isTTY: boolean;
}

/**
 * Should output carry ANSI colour?
 *
 * `NO_COLOR` disables colour when **present at all**, including when empty — that is what the
 * specification says, and implementations that require a truthy value are the reason people
 * have to set it twice.
 *
 * `FORCE_COLOR` wins over the TTY check but not over `NO_COLOR`, so a CI system that renders
 * ANSI can opt in without also overriding a user's explicit opt-out.
 *
 * @param environment - Environment variables and whether the stream is a terminal
 * @returns Whether to emit colour
 */
export function shouldColour(environment: StyleEnvironment): boolean {
  if (environment.env["NO_COLOR"] !== undefined) return false;
  if (environment.env["TERM"] === "dumb") return false;
  if (environment.env["FORCE_COLOR"] !== undefined) return true;
  return environment.isTTY;
}

const CODES = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  red: "\u001B[31m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  blue: "\u001B[34m",
  cyan: "\u001B[36m",
} as const;

/** The named styles the CLI uses. */
export type StyleName = keyof Omit<typeof CODES, "reset">;

/** A styling function set, either real or entirely inert. */
export type Styler = Readonly<Record<StyleName, (text: string) => string>>;

const PLAIN: Styler = {
  bold: (text) => text,
  dim: (text) => text,
  red: (text) => text,
  green: (text) => text,
  yellow: (text) => text,
  blue: (text) => text,
  cyan: (text) => text,
};

const COLOURED: Styler = {
  bold: (text) => `${CODES.bold}${text}${CODES.reset}`,
  dim: (text) => `${CODES.dim}${text}${CODES.reset}`,
  red: (text) => `${CODES.red}${text}${CODES.reset}`,
  green: (text) => `${CODES.green}${text}${CODES.reset}`,
  yellow: (text) => `${CODES.yellow}${text}${CODES.reset}`,
  blue: (text) => `${CODES.blue}${text}${CODES.reset}`,
  cyan: (text) => `${CODES.cyan}${text}${CODES.reset}`,
};

/**
 * Build a styler for the given environment.
 *
 * @param environment - Environment variables and whether the stream is a terminal
 * @returns A styler that either colours or returns its input unchanged
 */
export function createStyler(environment: StyleEnvironment): Styler {
  return shouldColour(environment) ? COLOURED : PLAIN;
}

/** A styler that never emits an escape sequence. Useful for tests and for `--json`. */
export const plainStyler: Styler = PLAIN;
