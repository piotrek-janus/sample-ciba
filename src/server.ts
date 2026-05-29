import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.js";
import { createSecureAuthClient } from "./ciba-core/index.js";
import { Store } from "./store.js";
import { consumptionDeviceRouter } from "./consumption-device/index.js";
import {
  authServiceInboundRouter,
  authServiceUiRouter,
} from "./authentication-service/index.js";

const config = loadConfig();
const client = createSecureAuthClient(config.secureAuth, globalThis.fetch);
const store = new Store(config.deliveryMode);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Verbose request logger — logs every inbound request so we can observe exactly
// what SecureAuth sends to the authentication service. Toggle with LOG_REQUESTS.
if (process.env.LOG_REQUESTS !== "false") {
  app.use((req, _res, next) => {
    const auth = req.headers.authorization;
    console.log(
      `[req] ${req.method} ${req.originalUrl} ` +
        `auth=${auth ? auth.split(" ")[0] + " <present>" : "none"} ` +
        `ct=${req.headers["content-type"] ?? "-"}`,
    );
    if (req.body && Object.keys(req.body).length) {
      console.log(`[req] body: ${JSON.stringify(req.body)}`);
    }
    next();
  });
}

// UI bootstrap config.
app.get("/api/config", (_req, res) => {
  res.json({
    deliveryMode: config.deliveryMode,
    scope: config.scope,
    publicBaseUrl: config.publicBaseUrl,
    // In External mode SecureAuth appends the operation paths (/user/verify,
    // /authentication/start) itself, so register the base URL.
    authServiceUrl: config.publicBaseUrl,
    pingNotificationUrl: `${config.publicBaseUrl}/api/cd/ping`,
  });
});

// Server-sent events: push a full snapshot on every state change.
app.get("/api/events", (req, res) => {
  res.set({
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.flushHeaders();
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send(store.snapshot());
  const unsubscribe = store.subscribe(send);
  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

app.use("/api/cd", consumptionDeviceRouter(client, store, config));
app.use("/api/as", authServiceUiRouter(client, store));
// SecureAuth-facing CIBA authentication service REST API (Basic auth guarded).
app.use("/", authServiceInboundRouter(client, store, config.authService));

const here = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(here, "web")));

app.listen(config.port, () => {
  console.log(`sample-ciba listening on http://localhost:${config.port}`);
  console.log(`  delivery mode:        ${config.deliveryMode}`);
  console.log(`  public base URL:      ${config.publicBaseUrl}`);
  console.log(`  auth service base URL: ${config.publicBaseUrl}  (register this in SecureAuth)`);
  if (config.deliveryMode === "ping") {
    console.log(`  ping notification:    ${config.publicBaseUrl}/api/cd/ping`);
  }
});
