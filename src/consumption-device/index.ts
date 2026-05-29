// Consumption device: starts the backchannel flow and obtains the token, either
// by polling (poll mode) or after SecureAuth calls our notification endpoint
// (ping mode).

import { Router } from "express";
import type { AppConfig } from "../config.js";
import type { SecureAuthClient } from "../ciba-core/index.js";
import { nextInterval, shouldContinue } from "../ciba-core/index.js";
import { decodeJwtClaims, type Store } from "../store.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function consumptionDeviceRouter(
  client: SecureAuthClient,
  store: Store,
  config: AppConfig,
): Router {
  const router = Router();

  router.post("/start", async (req, res) => {
    const loginHint = String(req.body?.loginHint ?? "").trim();
    if (!loginHint) {
      return res.status(400).json({ error: "loginHint is required" });
    }
    const scope = String(req.body?.scope ?? config.scope);
    const bindingMessage = req.body?.bindingMessage
      ? String(req.body.bindingMessage)
      : undefined;

    try {
      const auth = await client.bcAuthorize({ loginHint, scope, bindingMessage });
      const now = Date.now();
      store.upsertCd({
        authReqId: auth.authReqId,
        loginHint,
        scope,
        bindingMessage,
        status: "pending",
        createdAt: now,
        expiresAt: now + auth.expiresIn * 1000,
        interval: auth.interval,
      });

      if (config.deliveryMode === "poll") {
        void runPollLoop(client, store, config, auth.authReqId);
      }
      res.json({ authReqId: auth.authReqId, mode: config.deliveryMode });
    } catch (err) {
      res.status(502).json({ error: String((err as Error).message) });
    }
  });

  // Ping-mode client notification endpoint. SecureAuth calls this once auth
  // completes; we then do a single token fetch.
  router.post("/ping", async (req, res) => {
    const authReqId = String(
      req.body?.auth_req_id ?? req.body?.authReqId ?? "",
    ).trim();
    res.status(200).json({ received: true });
    if (!authReqId || !store.getCd(authReqId)) return;
    await pollOnceAndStore(client, store, authReqId);
  });

  return router;
}

async function pollOnceAndStore(
  client: SecureAuthClient,
  store: Store,
  authReqId: string,
): Promise<boolean> {
  const result = await client.pollToken(authReqId);
  switch (result.kind) {
    case "success": {
      const idToken = result.tokens.id_token;
      store.patchCd(authReqId, {
        status: "success",
        tokens: result.tokens,
        idTokenClaims: idToken ? decodeJwtClaims(idToken) : undefined,
      });
      return true;
    }
    case "denied":
      store.patchCd(authReqId, { status: "denied", error: result.description ?? result.error });
      return true;
    case "expired":
      store.patchCd(authReqId, { status: "expired" });
      return true;
    case "error":
      store.patchCd(authReqId, { status: "error", error: result.description ?? result.error });
      return true;
    case "slow_down": {
      const cur = store.getCd(authReqId);
      if (cur) store.patchCd(authReqId, { interval: nextInterval(cur.interval, result) });
      return false;
    }
    case "pending":
      return false;
  }
}

async function runPollLoop(
  client: SecureAuthClient,
  store: Store,
  config: AppConfig,
  authReqId: string,
): Promise<void> {
  const flow = store.getCd(authReqId);
  if (!flow) return;
  const deadline = Math.min(
    flow.expiresAt,
    flow.createdAt + config.pollMaxSeconds * 1000,
  );

  while (Date.now() < deadline) {
    const current = store.getCd(authReqId);
    if (!current || current.status !== "pending") return;
    await sleep(current.interval * 1000);
    try {
      const done = await pollOnceAndStore(client, store, authReqId);
      if (done) return;
    } catch (err) {
      store.patchCd(authReqId, { status: "error", error: String((err as Error).message) });
      return;
    }
  }
  store.patchCd(authReqId, { status: "expired" });
}
