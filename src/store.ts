// In-memory state for the demo plus a tiny pub/sub so the web UI can stream live
// updates over SSE. The sample keeps every flow/request from the current process
// run so both panels can show history; nothing is persisted.

import { EventEmitter } from "node:events";

export type CdStatus =
  | "pending"
  | "success"
  | "denied"
  | "expired"
  | "error";

export interface CdFlow {
  authReqId: string;
  loginHint: string;
  scope: string;
  bindingMessage?: string;
  status: CdStatus;
  createdAt: number;
  expiresAt: number;
  interval: number;
  tokens?: Record<string, unknown>;
  idTokenClaims?: Record<string, unknown>;
  error?: string;
}

export type AsStatus = "prompt" | "accepted" | "rejected" | "error";

export interface AsRequest {
  loginId: string;
  loginState?: string;
  bindingMessage?: string;
  loginHint?: string;
  subject?: string;
  clientName?: string;
  scopes: string[];
  status: AsStatus;
  receivedAt: number;
  error?: string;
  raw: unknown;
}

export interface Snapshot {
  deliveryMode: string;
  cd: CdFlow[];
  as: AsRequest[];
}

export class Store {
  private cd = new Map<string, CdFlow>();
  private as = new Map<string, AsRequest>();
  private emitter = new EventEmitter();

  constructor(private deliveryMode: string) {
    this.emitter.setMaxListeners(0);
  }

  snapshot(): Snapshot {
    return {
      deliveryMode: this.deliveryMode,
      cd: [...this.cd.values()].sort((a, b) => b.createdAt - a.createdAt),
      as: [...this.as.values()].sort((a, b) => b.receivedAt - a.receivedAt),
    };
  }

  subscribe(listener: (s: Snapshot) => void): () => void {
    this.emitter.on("change", listener);
    return () => this.emitter.off("change", listener);
  }

  private changed() {
    this.emitter.emit("change", this.snapshot());
  }

  upsertCd(flow: CdFlow) {
    this.cd.set(flow.authReqId, flow);
    this.changed();
  }

  patchCd(authReqId: string, patch: Partial<CdFlow>) {
    const cur = this.cd.get(authReqId);
    if (!cur) return;
    this.cd.set(authReqId, { ...cur, ...patch });
    this.changed();
  }

  getCd(authReqId: string): CdFlow | undefined {
    return this.cd.get(authReqId);
  }

  upsertAs(req: AsRequest) {
    this.as.set(req.loginId, req);
    this.changed();
  }

  patchAs(loginId: string, patch: Partial<AsRequest>) {
    const cur = this.as.get(loginId);
    if (!cur) return;
    this.as.set(loginId, { ...cur, ...patch });
    this.changed();
  }

  getAs(loginId: string): AsRequest | undefined {
    return this.as.get(loginId);
  }
}

/** Decode a JWT payload without verifying the signature (display only). */
export function decodeJwtClaims(jwt: string): Record<string, unknown> | undefined {
  const parts = jwt.split(".");
  if (parts.length < 2) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}
