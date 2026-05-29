import { describe, it, expect } from "vitest";
import {
  interpretTokenResponse,
  nextInterval,
  shouldContinue,
  SLOW_DOWN_INCREMENT,
} from "../src/ciba-core/poll.js";

describe("interpretTokenResponse", () => {
  it("treats 200 as success and carries the tokens", () => {
    const result = interpretTokenResponse(200, {
      access_token: "abc",
      token_type: "bearer",
    });
    expect(result).toEqual({
      kind: "success",
      tokens: { access_token: "abc", token_type: "bearer" },
    });
  });

  it("maps authorization_pending to pending", () => {
    expect(
      interpretTokenResponse(400, { error: "authorization_pending" }),
    ).toEqual({ kind: "pending" });
  });

  it("maps slow_down to slow_down", () => {
    expect(interpretTokenResponse(400, { error: "slow_down" })).toEqual({
      kind: "slow_down",
    });
  });

  it("maps expired_token to expired", () => {
    expect(interpretTokenResponse(400, { error: "expired_token" })).toEqual({
      kind: "expired",
    });
  });

  it("maps access_denied to denied and keeps the description", () => {
    expect(
      interpretTokenResponse(400, {
        error: "access_denied",
        error_description: "user said no",
      }),
    ).toEqual({ kind: "denied", error: "access_denied", description: "user said no" });
  });

  it("maps unknown OAuth errors to error", () => {
    expect(interpretTokenResponse(400, { error: "invalid_grant" })).toEqual({
      kind: "error",
      error: "invalid_grant",
      description: undefined,
    });
  });

  it("falls back to invalid_response when no error field is present", () => {
    expect(interpretTokenResponse(500, "boom")).toEqual({
      kind: "error",
      error: "invalid_response",
      description: undefined,
    });
  });
});

describe("nextInterval", () => {
  it("increments the interval on slow_down", () => {
    expect(nextInterval(5, { kind: "slow_down" })).toBe(5 + SLOW_DOWN_INCREMENT);
  });

  it("keeps the interval unchanged otherwise", () => {
    expect(nextInterval(5, { kind: "pending" })).toBe(5);
    expect(
      nextInterval(5, { kind: "success", tokens: { access_token: "", token_type: "" } }),
    ).toBe(5);
  });
});

describe("shouldContinue", () => {
  it("continues while pending or slowing down", () => {
    expect(shouldContinue({ kind: "pending" })).toBe(true);
    expect(shouldContinue({ kind: "slow_down" })).toBe(true);
  });

  it("stops on terminal results", () => {
    expect(shouldContinue({ kind: "expired" })).toBe(false);
    expect(shouldContinue({ kind: "denied", error: "access_denied" })).toBe(false);
    expect(
      shouldContinue({ kind: "success", tokens: { access_token: "", token_type: "" } }),
    ).toBe(false);
  });
});
