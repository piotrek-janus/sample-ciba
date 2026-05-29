// Simulated CIBA authentication service.
//
// SecureAuth (External mode) calls THIS service's REST API as part of the CIBA
// flow. The exact operations/paths were captured empirically from a live tenant
// (see README "authentication service REST API"). The two routers are split so
// the SecureAuth-facing endpoints can require Basic auth while the browser UI
// endpoints stay open.

import { Router } from "express";
import type { SecureAuthClient } from "../ciba-core/index.js";
import { parseStartAuthentication } from "../ciba-core/index.js";
import type { Store } from "../store.js";

export interface AuthServiceCredentials {
  basicUser?: string;
  basicPassword?: string;
}

// Middleware enforcing HTTP Basic auth on inbound SecureAuth calls. If no
// credentials are configured it is a no-op (accept all) so a misconfiguration
// never silently breaks the demo.
function basicAuthGuard(creds: AuthServiceCredentials) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (!creds.basicUser) return next();
    const header = req.headers.authorization ?? "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const [user, pass] = Buffer.from(encoded, "base64").toString("utf8").split(":");
      if (user === creds.basicUser && pass === creds.basicPassword) return next();
    }
    res.status(401).json({ error: "invalid_basic_auth" });
  };
}

// Endpoints SecureAuth calls. Mounted at root.
export function authServiceInboundRouter(
  client: SecureAuthClient,
  store: Store,
  creds: AuthServiceCredentials,
): Router {
  const router = Router();
  // Applied per-route (not router-wide): this router is mounted at "/", so a
  // router-level guard would also challenge the browser UI's GET / requests.
  const guard = basicAuthGuard(creds);

  // Called synchronously during bc-authorize to confirm the user_identifier
  // resolves to a real user. SecureAuth aborts the flow if this is not 2xx.
  router.post("/user/verify", guard, (req, res) => {
    const userIdentifier = String(req.body?.user_identifier ?? "");
    // This sample treats any non-empty identifier as valid. A real service would
    // look the user up in its directory here.
    if (!userIdentifier) {
      return res.status(404).json({ valid: false });
    }
    res.status(200).json({ valid: true });
  });

  // startAuthentication: SecureAuth notifies us that the user must approve.
  // Path + body captured empirically from a live tenant.
  router.post("/authentication/start", guard, (req, res) => {
    try {
      const parsed = parseStartAuthentication(req.body);
      store.upsertAs({
        loginId: parsed.loginId,
        loginState: parsed.loginState,
        bindingMessage: parsed.bindingMessage,
        loginHint: parsed.loginHint,
        subject: parsed.subject ?? parsed.loginHint,
        clientName: parsed.clientName,
        scopes: parsed.scopes,
        status: "prompt",
        receivedAt: Date.now(),
        raw: parsed.raw,
      });
      // SecureAuth retries until it gets a 2xx ack; the actual approve/reject is
      // reported later, out of band, via the System API.
      res.status(200).json({ acknowledged: true });
    } catch (err) {
      res.status(400).json({ error: String((err as Error).message) });
    }
  });

  return router;
}

// Endpoints the browser UI calls. Mounted at /api/as. No Basic auth.
export function authServiceUiRouter(client: SecureAuthClient, store: Store): Router {
  const router = Router();

  router.get("/:loginId/details", async (req, res) => {
    try {
      const details = await client.getScopeGrantRequest(req.params.loginId, Date.now());
      res.json({ details });
    } catch (err) {
      res.status(502).json({ error: String((err as Error).message) });
    }
  });

  router.post("/decision", async (req, res) => {
    const loginId = String(req.body?.loginId ?? "").trim();
    const decision = String(req.body?.decision ?? "");
    const current = store.getAs(loginId);
    if (!loginId || !current) {
      return res.status(404).json({ error: "unknown loginId" });
    }
    if (decision !== "accept" && decision !== "reject") {
      return res.status(400).json({ error: 'decision must be "accept" or "reject"' });
    }

    try {
      if (decision === "accept") {
        await client.acceptScopeGrantRequest(loginId, Date.now(), {
          login_state: current.loginState,
          granted_scopes: current.scopes,
          subject: current.subject,
        });
        store.patchAs(loginId, { status: "accepted" });
      } else {
        await client.rejectScopeGrantRequest(loginId, Date.now(), {
          login_state: current.loginState,
          error: "access_denied",
          error_description: "Rejected by user in the authentication service",
        });
        store.patchAs(loginId, { status: "rejected" });
      }
      res.json({ status: "ok", decision });
    } catch (err) {
      const message = String((err as Error).message);
      store.patchAs(loginId, { status: "error", error: message });
      res.status(502).json({ error: message });
    }
  });

  return router;
}
