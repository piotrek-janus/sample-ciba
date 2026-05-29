# CIBA Sample Application — Design

**Date:** 2026-05-29
**Status:** Approved (approach A)

## Goal

An end-to-end, runnable sample demonstrating the SecureAuth/Cloudentity
Client-Initiated Backchannel Authentication (CIBA) flow. It includes both a
**consumption device** (the client that initiates auth and obtains tokens) and a
**simulated authentication service** (the service SecureAuth notifies, which
interacts with the user and reports the decision), running against a real
SecureAuth/Cloudentity tenant.

## The CIBA flow (as implemented here)

1. **Consumption device** calls SecureAuth's backchannel endpoint
   (`bc-authorize`) with a `login_hint`; receives `auth_req_id`, `interval`,
   `expires_in`.
2. **SecureAuth notifies the authentication service** — SecureAuth is the
   *caller*; our authentication service *implements* the `startAuthentication`
   operation (per the `ciba-authentication-service` API contract).
3. **Authentication service** prompts the user (approve / deny), showing the
   binding message and requested scopes.
4. **User** approves or denies.
5. **Authentication service** reports the decision to SecureAuth via the System
   API (`logins` tag): `acceptScopeGrantRequest` / `rejectScopeGrantRequest`,
   after optionally fetching details with `getScopeGrantRequest`.
6. **Consumption device** polls the token endpoint
   (`grant_type=urn:openid:params:grant-type:ciba`, `auth_req_id`) until
   success / denied / expiry. In **ping** mode, SecureAuth instead calls the
   client notification endpoint and the device then fetches the token once.

> Note: there is **no** "list pending requests" polling by the device.
> SecureAuth *pushes* the request to the authentication service.

## Key decisions

| Decision | Choice |
|---|---|
| Scope | End-to-end demo: consumption device + simulated authentication service |
| Stack | Node.js / TypeScript (Express) |
| Token delivery mode | Both **poll** and **ping**, selectable via config (poll default) |
| Auth service model | Real push: implement `startAuthentication`; report via System API accept/reject |
| Presentation | Minimal web UI, two panels (Consumption Device \| Authentication Service), live via SSE |
| User identification | `login_hint` (plain identifier) |
| Reachability | `cloudflared` tunnel for local runs; deployed host documented as alternative |
| Topology | Approach A: single app, three internal modules, one tunnel |

## Architecture

A single TypeScript service (one Express server, one `cloudflared` tunnel)
composed of strictly-bounded internal modules:

- **`ciba-core`** — typed SecureAuth client; no HTTP-server concerns, pure
  functions + types, independently testable. Exposes:
  - `bcAuthorize(params) → { auth_req_id, interval, expires_in }`
  - `pollToken(auth_req_id) → TokenResult` (typed: `pending | slow_down |
    success | denied | expired`)
  - `getScopeGrantRequest(id)`, `acceptScopeGrantRequest(id, …)`,
    `rejectScopeGrantRequest(id, …)`
- **`consumption-device`** — routes to start a flow, run the server-side token
  poll loop, expose status/SSE, and (ping mode) the client notification
  endpoint.
- **`authentication-service`** — the `startAuthentication` webhook SecureAuth
  invokes; fetches request details and reports approve/reject via the System
  API.
- **`web`** — static two-panel SPA + SSE for live stage updates.

Secrets (client secret, System API credentials) stay server-side.

## Data flow (happy path)

1. UI (CD panel) → `POST /api/cd/start {login_hint, scope, binding_message}` →
   server calls `bc-authorize` → stores `{auth_req_id, interval, expires_in}`,
   starts polling, emits SSE `cd: pending`.
2. SecureAuth → `POST /webhooks/start-authentication` → server stores the
   login/request id, emits SSE `as: prompt`.
3. UI (AS panel) shows binding message + scopes; user clicks Approve/Reject →
   `POST /api/as/decision` → server calls accept/reject.
4. CD poll loop receives token (or `access_denied`) → emits SSE
   `cd: success|denied`; UI shows tokens / claims.

Ping mode: instead of the fixed poll loop, SecureAuth calls the notification
endpoint; the server then does a single token fetch.

## Configuration

`.env` (+ committed `.env.example`):

- Tenant issuer / base URL; `bc-authorize` + token endpoint paths
- System API base URL + credentials
- `CLIENT_ID` / `CLIENT_SECRET`, default `SCOPE`
- `TOKEN_DELIVERY_MODE=poll|ping`
- `PUBLIC_BASE_URL` (cloudflared URL)
- Poll interval / cap

README documents tenant prerequisites (CIBA enabled, `urn:openid:params:grant-type:ciba`
allowed, authentication service URL registered) and the `cloudflared` command.

## Error handling

- `authorization_pending` → keep polling.
- `slow_down` → increase interval.
- `expired_token` / `access_denied` → stop, surface to UI.
- Tunnel / webhook misconfiguration → clear server log + UI banner.
- Token poll bounded by `expires_in`.
- All SecureAuth error responses mapped to typed results inside `ciba-core`.

## Testing

- Unit tests for `ciba-core` against a mocked SecureAuth (nock/msw): request
  shaping; poll-state transitions (pending / slow_down / success / denied /
  expired); System-API decision calls.
- A small integration test driving the happy path with SecureAuth mocked.
- Manual end-to-end steps in the README for a real tenant.

## Open research items (resolved during planning; not blocking)

- Exact `startAuthentication` request body SecureAuth sends (correlation id,
  binding_message, login_hint, scopes).
- Exact System API paths / auth for `getScopeGrantRequest` / accept / reject.
- Exact `bc-authorize` and token endpoint paths for the tenant.

## References

- CIBA flow: https://docs.secureauth.com/iam/client-initiated-backchannel-authentication-flow-ciba
- Authentication service API: https://docs.secureauth.com/iam/docs/api/ciba-authentication-service#operation/startAuthentication
- System API (logins): https://docs.secureauth.com/iam/docs/api/system#tag/logins
