import { describe, it, expect } from "vitest";
import {
  createSecureAuthClient,
  type FetchLike,
  type MinimalResponse,
} from "../src/ciba-core/client.js";

function jsonResponse(status: number, body: unknown): MinimalResponse {
  return {
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

interface Call {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

// Build a fake fetch that records calls and replies based on the URL.
function fakeFetch(
  handler: (call: Call) => MinimalResponse,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { url, ...init };
    calls.push(call);
    return handler(call);
  };
  return { fetch, calls };
}

const DISCOVERY = {
  backchannel_authentication_endpoint: "https://op.example.com/bc-authorize",
  token_endpoint: "https://op.example.com/token",
};

const config = {
  issuerUrl: "https://op.example.com",
  clientId: "cd-client",
  clientSecret: "cd-secret",
  clientAuthMethod: "client_secret_basic" as const,
  systemApi: {
    baseUrl: "https://op.example.com/api/system/tenant",
    getPath: "/scope-grant-requests/{login}",
    acceptPath: "/scope-grant-requests/{login}/accept",
    rejectPath: "/scope-grant-requests/{login}/reject",
    tokenUrl: "https://op.example.com/system/token",
    clientId: "sys-client",
    clientSecret: "sys-secret",
    clientAuthMethod: "client_secret_basic" as const,
    scope: "manage_logins",
  },
};

describe("createSecureAuthClient.bcAuthorize", () => {
  it("posts login_hint/scope with basic auth and returns the auth_req_id", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/.well-known/openid-configuration"))
        return jsonResponse(200, DISCOVERY);
      if (call.url.endsWith("/bc-authorize"))
        return jsonResponse(200, {
          auth_req_id: "req-1",
          expires_in: 300,
          interval: 5,
        });
      throw new Error("unexpected url " + call.url);
    });

    const client = createSecureAuthClient(config, fetch);
    const result = await client.bcAuthorize({
      loginHint: "alice",
      scope: "openid",
      bindingMessage: "hi",
    });

    expect(result).toEqual({ authReqId: "req-1", interval: 5, expiresIn: 300 });
    const bc = calls.find((c) => c.url.endsWith("/bc-authorize"))!;
    expect(bc.headers?.authorization).toMatch(/^Basic /);
    expect(bc.body).toContain("login_hint=alice");
    expect(bc.body).toContain("binding_message=hi");
  });

  it("sends credentials in the body when client_secret_post is configured", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/.well-known/openid-configuration"))
        return jsonResponse(200, DISCOVERY);
      return jsonResponse(200, { auth_req_id: "req-2", expires_in: 120, interval: 5 });
    });

    const client = createSecureAuthClient(
      { ...config, clientAuthMethod: "client_secret_post" },
      fetch,
    );
    await client.bcAuthorize({ loginHint: "alice", scope: "openid" });

    const bc = calls.find((c) => c.url.endsWith("/bc-authorize"))!;
    expect(bc.headers?.authorization).toBeUndefined();
    expect(bc.body).toContain("client_id=cd-client");
    expect(bc.body).toContain("client_secret=cd-secret");
  });
});

describe("createSecureAuthClient.pollToken", () => {
  it("returns pending then success across polls", async () => {
    let calls = 0;
    const { fetch } = fakeFetch((call) => {
      if (call.url.endsWith("/.well-known/openid-configuration"))
        return jsonResponse(200, DISCOVERY);
      calls += 1;
      return calls === 1
        ? jsonResponse(400, { error: "authorization_pending" })
        : jsonResponse(200, { access_token: "tok", token_type: "bearer" });
    });

    const client = createSecureAuthClient(config, fetch);
    expect(await client.pollToken("req-1")).toEqual({ kind: "pending" });
    expect(await client.pollToken("req-1")).toEqual({
      kind: "success",
      tokens: { access_token: "tok", token_type: "bearer" },
    });
  });
});

describe("createSecureAuthClient system API decisions", () => {
  it("fetches a system token then accepts with a bearer header", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/system/token"))
        return jsonResponse(200, { access_token: "sys-tok", expires_in: 300 });
      if (call.url.includes("/accept")) return jsonResponse(200, { status: "ok" });
      throw new Error("unexpected url " + call.url);
    });

    const client = createSecureAuthClient(config, fetch);
    await client.acceptScopeGrantRequest("login-9", 1_000, { granted_scopes: ["openid"] });

    const accept = calls.find((c) => c.url.includes("/accept"))!;
    expect(accept.url).toBe(
      "https://op.example.com/api/system/tenant/scope-grant-requests/login-9/accept",
    );
    expect(accept.headers?.authorization).toBe("Bearer sys-tok");
    expect(accept.method).toBe("POST");
  });

  it("caches the system token across calls", async () => {
    let tokenCalls = 0;
    const { fetch } = fakeFetch((call) => {
      if (call.url.endsWith("/system/token")) {
        tokenCalls += 1;
        return jsonResponse(200, { access_token: "sys-tok", expires_in: 300 });
      }
      return jsonResponse(200, { status: "ok" });
    });

    const client = createSecureAuthClient(config, fetch);
    await client.acceptScopeGrantRequest("a", 1_000);
    await client.rejectScopeGrantRequest("b", 2_000);
    expect(tokenCalls).toBe(1);
  });
});
