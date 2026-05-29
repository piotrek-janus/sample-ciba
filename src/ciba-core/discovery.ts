// OIDC discovery — resolves the backchannel and token endpoints from the issuer
// so the sample never hardcodes tenant-specific paths.

import type { FetchLike } from "./client.js";

export interface DiscoveredEndpoints {
  backchannelAuthenticationEndpoint: string;
  tokenEndpoint: string;
}

export async function discover(
  issuerUrl: string,
  fetchImpl: FetchLike,
): Promise<DiscoveredEndpoints> {
  const url = `${issuerUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetchImpl(url, { method: "GET" });
  if (res.status !== 200) {
    throw new Error(
      `OIDC discovery failed (${res.status}) for ${url}: ${await res.text()}`,
    );
  }
  const doc = (await res.json()) as Record<string, unknown>;

  const backchannel = doc.backchannel_authentication_endpoint;
  const token = doc.token_endpoint;
  if (typeof backchannel !== "string" || typeof token !== "string") {
    throw new Error(
      "Discovery document is missing backchannel_authentication_endpoint or token_endpoint. " +
        "Is CIBA enabled for this workspace?",
    );
  }
  return {
    backchannelAuthenticationEndpoint: backchannel,
    tokenEndpoint: token,
  };
}
