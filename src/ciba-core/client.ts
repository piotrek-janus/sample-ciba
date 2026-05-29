// Typed SecureAuth/Cloudentity client used by both the consumption device and
// the authentication service. The fetch implementation is injected so the client
// can be unit-tested without real network access.

import { discover, type DiscoveredEndpoints } from "./discovery.js";
import { interpretTokenResponse } from "./poll.js";
import type {
  BackchannelAuthParams,
  BackchannelAuthResponse,
  TokenPollResult,
} from "./types.js";

export const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

export interface MinimalResponse {
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<MinimalResponse>;

export type ClientAuthMethod = "client_secret_basic" | "client_secret_post";

export interface SystemApiConfig {
  baseUrl: string;
  getPath: string;
  acceptPath: string;
  rejectPath: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  clientAuthMethod: ClientAuthMethod;
  scope: string;
}

export interface SecureAuthConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  clientAuthMethod: ClientAuthMethod;
  systemApi: SystemApiConfig;
}

function basicAuth(id: string, secret: string): string {
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

// Apply client authentication to a form request, either as an Authorization
// header (client_secret_basic) or extra body params (client_secret_post).
function withClientAuth(
  method: ClientAuthMethod,
  id: string,
  secret: string,
  params: Record<string, string>,
): { params: Record<string, string>; authHeader?: string } {
  if (method === "client_secret_post") {
    return { params: { ...params, client_id: id, client_secret: secret } };
  }
  return { params, authHeader: basicAuth(id, secret) };
}

export function createSecureAuthClient(
  config: SecureAuthConfig,
  fetchImpl: FetchLike,
) {
  let endpoints: DiscoveredEndpoints | undefined;
  let systemToken: { value: string; expiresAt: number } | undefined;

  async function getEndpoints(): Promise<DiscoveredEndpoints> {
    if (!endpoints) endpoints = await discover(config.issuerUrl, fetchImpl);
    return endpoints;
  }

  async function form(
    url: string,
    params: Record<string, string>,
    authHeader?: string,
  ): Promise<MinimalResponse> {
    return fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body: new URLSearchParams(params).toString(),
    });
  }

  /** Step 1: consumption device initiates backchannel authentication. */
  async function bcAuthorize(
    params: BackchannelAuthParams,
  ): Promise<BackchannelAuthResponse> {
    const { backchannelAuthenticationEndpoint } = await getEndpoints();
    const body: Record<string, string> = {
      scope: params.scope,
      login_hint: params.loginHint,
    };
    if (params.bindingMessage) body.binding_message = params.bindingMessage;
    if (params.requestedExpiry) body.requested_expiry = String(params.requestedExpiry);

    const auth = withClientAuth(
      config.clientAuthMethod,
      config.clientId,
      config.clientSecret,
      body,
    );
    const res = await form(
      backchannelAuthenticationEndpoint,
      auth.params,
      auth.authHeader,
    );
    const json = (await res.json()) as Record<string, unknown>;
    if (res.status !== 200) {
      throw new Error(
        `bc-authorize failed (${res.status}): ${JSON.stringify(json)}`,
      );
    }
    return {
      authReqId: String(json.auth_req_id),
      interval: typeof json.interval === "number" ? json.interval : 5,
      expiresIn: typeof json.expires_in === "number" ? json.expires_in : 120,
    };
  }

  /** Step 6: a single token-endpoint poll for the given auth_req_id. */
  async function pollToken(authReqId: string): Promise<TokenPollResult> {
    const { tokenEndpoint } = await getEndpoints();
    const auth = withClientAuth(
      config.clientAuthMethod,
      config.clientId,
      config.clientSecret,
      { grant_type: CIBA_GRANT_TYPE, auth_req_id: authReqId },
    );
    const res = await form(tokenEndpoint, auth.params, auth.authHeader);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = await res.text();
    }
    return interpretTokenResponse(res.status, json);
  }

  // ── System API (authentication-service decision callbacks) ──────────────────

  async function getSystemToken(nowMs: number): Promise<string> {
    if (systemToken && systemToken.expiresAt > nowMs + 10_000) {
      return systemToken.value;
    }
    const auth = withClientAuth(
      config.systemApi.clientAuthMethod,
      config.systemApi.clientId,
      config.systemApi.clientSecret,
      { grant_type: "client_credentials", scope: config.systemApi.scope },
    );
    const res = await form(config.systemApi.tokenUrl, auth.params, auth.authHeader);
    const json = (await res.json()) as Record<string, unknown>;
    if (res.status !== 200 || typeof json.access_token !== "string") {
      throw new Error(
        `System API token request failed (${res.status}): ${JSON.stringify(json)}`,
      );
    }
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 300;
    systemToken = {
      value: json.access_token,
      expiresAt: nowMs + expiresIn * 1000,
    };
    return systemToken.value;
  }

  function systemUrl(template: string, loginId: string): string {
    return (
      config.systemApi.baseUrl.replace(/\/$/, "") +
      template.replace("{login}", encodeURIComponent(loginId))
    );
  }

  async function systemRequest(
    method: string,
    url: string,
    nowMs: number,
    body?: unknown,
  ): Promise<unknown> {
    const token = await getSystemToken(nowMs);
    const res = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = await res.text();
    }
    if (res.status >= 400) {
      throw new Error(
        `System API ${method} ${url} failed (${res.status}): ${JSON.stringify(json)}`,
      );
    }
    return json;
  }

  return {
    getEndpoints,
    bcAuthorize,
    pollToken,

    getScopeGrantRequest(loginId: string, nowMs: number) {
      return systemRequest(
        "GET",
        systemUrl(config.systemApi.getPath, loginId),
        nowMs,
      );
    },

    acceptScopeGrantRequest(loginId: string, nowMs: number, payload?: unknown) {
      return systemRequest(
        "POST",
        systemUrl(config.systemApi.acceptPath, loginId),
        nowMs,
        payload ?? {},
      );
    },

    rejectScopeGrantRequest(loginId: string, nowMs: number, payload?: unknown) {
      return systemRequest(
        "POST",
        systemUrl(config.systemApi.rejectPath, loginId),
        nowMs,
        payload ?? {},
      );
    },
  };
}

export type SecureAuthClient = ReturnType<typeof createSecureAuthClient>;
