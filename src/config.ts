import "dotenv/config";
import type {
  ClientAuthMethod,
  SecureAuthConfig,
  TokenDeliveryMode,
} from "./ciba-core/index.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function authMethod(name: string): ClientAuthMethod {
  const v = optional(name, "client_secret_basic");
  if (v !== "client_secret_basic" && v !== "client_secret_post") {
    throw new Error(
      `${name} must be "client_secret_basic" or "client_secret_post", got "${v}"`,
    );
  }
  return v;
}

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  scope: string;
  deliveryMode: TokenDeliveryMode;
  pollMaxSeconds: number;
  secureAuth: SecureAuthConfig;
  authService: { basicUser?: string; basicPassword?: string };
}

export function loadConfig(): AppConfig {
  const deliveryMode = optional("TOKEN_DELIVERY_MODE", "poll");
  if (deliveryMode !== "poll" && deliveryMode !== "ping") {
    throw new Error(`TOKEN_DELIVERY_MODE must be "poll" or "ping", got "${deliveryMode}"`);
  }

  return {
    port: Number(optional("PORT", "3000")),
    publicBaseUrl: optional("PUBLIC_BASE_URL", "http://localhost:3000").replace(/\/$/, ""),
    scope: optional("SCOPE", "openid profile"),
    deliveryMode,
    pollMaxSeconds: Number(optional("POLL_MAX_SECONDS", "120")),
    authService: {
      basicUser: process.env.AUTH_SERVICE_BASIC_USER || undefined,
      basicPassword: process.env.AUTH_SERVICE_BASIC_PASSWORD || undefined,
    },
    secureAuth: {
      issuerUrl: required("ISSUER_URL"),
      clientId: required("CLIENT_ID"),
      clientSecret: required("CLIENT_SECRET"),
      clientAuthMethod: authMethod("CLIENT_AUTH_METHOD"),
      systemApi: {
        baseUrl: required("SYSTEM_API_BASE_URL"),
        getPath: optional("SYSTEM_API_GET_PATH", "/scope-grant-requests/{login}"),
        acceptPath: optional("SYSTEM_API_ACCEPT_PATH", "/scope-grant-requests/{login}/accept"),
        rejectPath: optional("SYSTEM_API_REJECT_PATH", "/scope-grant-requests/{login}/reject"),
        tokenUrl: required("SYSTEM_API_TOKEN_URL"),
        clientId: required("SYSTEM_API_CLIENT_ID"),
        clientSecret: required("SYSTEM_API_CLIENT_SECRET"),
        clientAuthMethod: authMethod("SYSTEM_API_CLIENT_AUTH_METHOD"),
        scope: optional("SYSTEM_API_SCOPE", ""),
      },
    },
  };
}
