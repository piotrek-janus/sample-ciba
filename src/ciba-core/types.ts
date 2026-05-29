// Shared types for the CIBA core. Kept free of any HTTP-server concerns so this
// module can be unit-tested in isolation.

export type TokenDeliveryMode = "poll" | "ping";

export interface BackchannelAuthParams {
  loginHint: string;
  scope: string;
  bindingMessage?: string;
  requestedExpiry?: number;
}

export interface BackchannelAuthResponse {
  authReqId: string;
  // Minimum number of seconds the client must wait between token polls.
  interval: number;
  // Lifetime of the auth_req_id in seconds.
  expiresIn: number;
}

export interface Tokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  [k: string]: unknown;
}

// The outcome of interpreting a single token-endpoint response during polling.
export type TokenPollResult =
  | { kind: "pending" }
  | { kind: "slow_down" }
  | { kind: "success"; tokens: Tokens }
  | { kind: "denied"; error: string; description?: string }
  | { kind: "expired" }
  | { kind: "error"; error: string; description?: string };

// Raw payload the authentication service receives when SecureAuth invokes the
// startAuthentication operation. The exact field names vary by tenant, so the
// parser is intentionally defensive (see parseStartAuthentication).
export interface ScopeGrantRequest {
  // The login / scope-grant-request id used in the System API decision calls.
  loginId: string;
  // Opaque state SecureAuth includes; echoed back on the accept/reject call.
  loginState?: string;
  bindingMessage?: string;
  loginHint?: string;
  subject?: string;
  clientName?: string;
  expiresAt?: string;
  scopes: string[];
  raw: unknown;
}

export type Decision = "accept" | "reject";
