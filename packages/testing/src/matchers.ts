import { PAYMENT_HEADERS } from "@movoframework/core";

interface MatcherResult {
  readonly pass: boolean;
  message(): string;
}

function responseLike(value: unknown): value is { status: number; headers: Headers } {
  return typeof value === "object" && value !== null && "status" in value && "headers" in value;
}

/** Vitest-compatible matchers; install with `expect.extend(movoMatchers)`. */
export const movoMatchers = {
  toBePaymentRequired(received: unknown): MatcherResult {
    const pass =
      responseLike(received) &&
      received.status === 402 &&
      received.headers.get(PAYMENT_HEADERS.required) !== null;
    return { pass, message: () => "expected a 402 response carrying PAYMENT-REQUIRED" };
  },
  toBeSettled(received: unknown): MatcherResult {
    const pass =
      responseLike(received) &&
      received.status >= 200 &&
      received.status < 300 &&
      received.headers.get(PAYMENT_HEADERS.response) !== null;
    return { pass, message: () => "expected a successful response carrying PAYMENT-RESPONSE" };
  },
  toBeRejectedWithReason(received: unknown, reason: string): MatcherResult {
    const actual =
      typeof received === "object" && received !== null && "invalidReason" in received
        ? (received as { invalidReason?: unknown }).invalidReason
        : undefined;
    const pass = typeof actual === "string" && actual.includes(reason);
    return {
      pass,
      message: () => `expected a verification rejection containing ${JSON.stringify(reason)}`,
    };
  },
};

/** Reject logs that still contain credentials or payment-wire material. */
export function assertNoSecretsLogged(
  lines: readonly string[],
  secrets: readonly string[] = [],
): void {
  const forbidden = [
    "authorization:",
    "bearer ",
    PAYMENT_HEADERS.signature.toLowerCase(),
    ...secrets,
  ];
  for (const line of lines) {
    const leaked = forbidden.find((value) => line.toLowerCase().includes(value.toLowerCase()));
    if (leaked !== undefined)
      throw new Error(`secret or payment payload leaked to logs: ${leaked}`);
  }
}
