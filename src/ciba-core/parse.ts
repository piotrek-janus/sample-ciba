// Defensive parser for the startAuthentication notification SecureAuth POSTs to
// the authentication service. Field names vary by tenant/version, so we accept
// several common spellings and always keep the raw payload for display/debugging.

import type { ScopeGrantRequest } from "./types.js";

function firstString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function toScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((s) => (typeof s === "string" ? s : (s as { name?: string })?.name))
      .filter((s): s is string => typeof s === "string");
  }
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
}

export function parseStartAuthentication(body: unknown): ScopeGrantRequest {
  const obj =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const loginId = firstString(obj, ["login_id", "loginId", "id", "login"]);
  if (!loginId) {
    throw new Error(
      "startAuthentication payload did not contain a recognizable login id " +
        "(tried login_id, loginId, id, login).",
    );
  }

  const clientInfo =
    obj.client_info && typeof obj.client_info === "object"
      ? (obj.client_info as Record<string, unknown>)
      : {};

  return {
    loginId,
    loginState: firstString(obj, ["login_state", "loginState"]),
    bindingMessage: firstString(obj, ["binding_message", "bindingMessage"]),
    loginHint: firstString(obj, [
      "user_identifier",
      "login_hint",
      "loginHint",
      "hint",
    ]),
    subject: firstString(obj, ["subject", "sub", "user_id", "userId"]),
    clientName: firstString(clientInfo, ["client_name", "clientName"]),
    expiresAt: firstString(obj, ["expires_at", "expiresAt"]),
    scopes: toScopes(obj.requested_scopes ?? obj.scopes ?? obj.scope),
    raw: body,
  };
}
