import { describe, it, expect } from "vitest";
import { parseStartAuthentication } from "../src/ciba-core/parse.js";

describe("parseStartAuthentication", () => {
  it("extracts fields from snake_case payloads", () => {
    const parsed = parseStartAuthentication({
      login_id: "login-123",
      binding_message: "Approve transfer",
      login_hint: "alice@example.com",
      subject: "user-1",
      scopes: ["openid", "profile"],
    });
    expect(parsed).toMatchObject({
      loginId: "login-123",
      bindingMessage: "Approve transfer",
      loginHint: "alice@example.com",
      subject: "user-1",
      scopes: ["openid", "profile"],
    });
  });

  it("accepts alternative id keys and a space-delimited scope string", () => {
    const parsed = parseStartAuthentication({ id: "abc", scope: "openid email" });
    expect(parsed.loginId).toBe("abc");
    expect(parsed.scopes).toEqual(["openid", "email"]);
  });

  it("handles scopes given as objects with name fields", () => {
    const parsed = parseStartAuthentication({
      loginId: "x",
      scopes: [{ name: "openid" }, { name: "profile" }],
    });
    expect(parsed.scopes).toEqual(["openid", "profile"]);
  });

  it("throws when no login id can be found", () => {
    expect(() => parseStartAuthentication({ foo: "bar" })).toThrow(/login id/);
  });

  it("parses the real SecureAuth /authentication/start payload", () => {
    const parsed = parseStartAuthentication({
      acr_values: null,
      binding_message: "Approve demo login",
      client_id: "d9de35e3bcb44d96ba5bca98058e993c",
      client_info: { client_name: "ciba-sample" },
      expires_at: "2026-05-29T10:49:34Z",
      login_id: "c0d3dd5b628347008d7bdbff5f09b094",
      login_state: "b0d8d8953c1e486884db3f42f124c209",
      requested_scopes: ["openid", "profile"],
      server_id: "ciba-sample",
      tenant_id: "janus",
      user_identifier: "test@test.com",
    });
    expect(parsed).toMatchObject({
      loginId: "c0d3dd5b628347008d7bdbff5f09b094",
      loginState: "b0d8d8953c1e486884db3f42f124c209",
      bindingMessage: "Approve demo login",
      loginHint: "test@test.com",
      clientName: "ciba-sample",
      expiresAt: "2026-05-29T10:49:34Z",
      scopes: ["openid", "profile"],
    });
  });

  it("preserves the raw payload", () => {
    const body = { id: "x", extra: true };
    expect(parseStartAuthentication(body).raw).toBe(body);
  });
});
