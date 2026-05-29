// Pure helpers for the consumption-device token-polling state machine.
// No I/O here — just interpreting responses and computing the next interval —
// so the logic is fully unit-testable.

import type { TokenPollResult, Tokens } from "./types.js";

// How much to back off (seconds) when the server returns slow_down, per the
// CIBA spec recommendation.
export const SLOW_DOWN_INCREMENT = 5;

/**
 * Interpret a single token-endpoint response into a typed poll result.
 *
 * @param status HTTP status code of the response.
 * @param body   Parsed JSON body (may be a token set or an OAuth error object).
 */
export function interpretTokenResponse(
  status: number,
  body: unknown,
): TokenPollResult {
  if (status === 200) {
    return { kind: "success", tokens: body as Tokens };
  }

  const err =
    body && typeof body === "object" && "error" in body
      ? String((body as Record<string, unknown>).error)
      : "invalid_response";
  const description =
    body && typeof body === "object" && "error_description" in body
      ? String((body as Record<string, unknown>).error_description)
      : undefined;

  switch (err) {
    case "authorization_pending":
      return { kind: "pending" };
    case "slow_down":
      return { kind: "slow_down" };
    case "expired_token":
      return { kind: "expired" };
    case "access_denied":
      return { kind: "denied", error: err, description };
    default:
      return { kind: "error", error: err, description };
  }
}

/** Compute the next poll interval given the current one and the latest result. */
export function nextInterval(current: number, result: TokenPollResult): number {
  return result.kind === "slow_down" ? current + SLOW_DOWN_INCREMENT : current;
}

/** Whether polling should continue after a given result. */
export function shouldContinue(result: TokenPollResult): boolean {
  return result.kind === "pending" || result.kind === "slow_down";
}
