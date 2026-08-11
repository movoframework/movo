/**
 * A small structured logger whose only interesting property is that it cannot print a secret.
 *
 * Movo does not ship a logging framework and does not want one. What it ships is the guarantee
 * that `debug` still redacts (spec §5.13): the level controls volume, never disclosure. A
 * developer raising the level to diagnose a payment failure is exactly the moment a naive
 * logger starts printing authorisation headers, so the redaction is not attached to the level.
 *
 * Output goes through an injectable sink so tests can capture bytes and assert on them, which
 * is what makes the "zero occurrences of the fixture seed" assertion a real measurement rather
 * than a claim about code that was read.
 */

import { redact } from "./redact.js";

/** Log levels, ordered from quietest to loudest. */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/** One emitted record, after redaction. */
export interface LogRecord {
  readonly level: Exclude<LogLevel, "silent">;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Where a logger writes. Injectable so tests can capture output. */
export type LogSink = (record: LogRecord) => void;

/** Options for {@link createLogger}. */
export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly sink?: LogSink;
}

/** The logger surface. */
export interface Logger {
  readonly level: LogLevel;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

const defaultSink: LogSink = (record) => {
  process.stderr.write(`${JSON.stringify(record)}\n`);
};

/**
 * Read a log level from an environment value, falling back to `info`.
 *
 * @param value - Raw `MOVO_LOG_LEVEL` value
 * @returns A valid level
 */
export function parseLogLevel(value: string | undefined): LogLevel {
  return value !== undefined && Object.hasOwn(LEVEL_RANK, value) ? (value as LogLevel) : "info";
}

/**
 * Create a logger that redacts every message and every field before emitting.
 *
 * @param options - Level and sink
 * @returns A logger
 */
export function createLogger(options?: LoggerOptions): Logger {
  const level: LogLevel = options?.level ?? "info";
  const sink: LogSink = options?.sink ?? defaultSink;
  const threshold = LEVEL_RANK[level];

  function emit(
    recordLevel: Exclude<LogLevel, "silent">,
    message: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void {
    if (LEVEL_RANK[recordLevel] > threshold) return;
    // Redaction happens here, on the way out, for every level including debug. The message is
    // redacted as part of the record so that an interpolated secret is caught too.
    const redacted = redact({ message, fields: fields ?? {} }) as {
      message: string;
      fields: Record<string, unknown>;
    };
    sink({ level: recordLevel, message: redacted.message, fields: redacted.fields });
  }

  return {
    level,
    error: (message, fields) => {
      emit("error", message, fields);
    },
    warn: (message, fields) => {
      emit("warn", message, fields);
    },
    info: (message, fields) => {
      emit("info", message, fields);
    },
    debug: (message, fields) => {
      emit("debug", message, fields);
    },
  };
}
