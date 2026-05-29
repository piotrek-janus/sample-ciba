const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function loadConfig() {
  const cfg = await fetch("/api/config").then((r) => r.json());
  $("#cd-scope").value = cfg.scope;
  $("#config-bar").innerHTML = `
    delivery mode: <span class="badge">${esc(cfg.deliveryMode)}</span>
    &nbsp;·&nbsp; authentication service URL to register:
    <code>${esc(cfg.authServiceUrl)}</code>
    ${cfg.deliveryMode === "ping" ? `&nbsp;·&nbsp; ping notification URL: <code>${esc(cfg.pingNotificationUrl)}</code>` : ""}`;
}

function renderCd(flows) {
  if (!flows.length) {
    $("#cd-list").innerHTML = '<div class="empty">No flows yet — start one above.</div>';
    return;
  }
  $("#cd-list").innerHTML = flows
    .map((f) => {
      const tokens = f.tokens
        ? `<pre>${esc(JSON.stringify(
            { ...f.tokens, id_token_claims: f.idTokenClaims },
            null,
            2,
          ))}</pre>`
        : "";
      return `<div class="card">
        <div class="row">
          <strong>${esc(f.loginHint)}</strong>
          <span class="status ${f.status}">${f.status}</span>
        </div>
        <div class="meta">auth_req_id: ${esc(f.authReqId)}</div>
        <div class="meta">scope: ${esc(f.scope)}${f.bindingMessage ? ` · binding: “${esc(f.bindingMessage)}”` : ""}</div>
        ${f.error ? `<div class="meta" style="color:var(--err)">${esc(f.error)}</div>` : ""}
        ${tokens}
      </div>`;
    })
    .join("");
}

function renderAs(requests) {
  $("#as-empty").style.display = requests.length ? "none" : "block";
  $("#as-list").innerHTML = requests
    .map((r) => {
      const chips = r.scopes.map((s) => `<span class="chip">${esc(s)}</span>`).join("");
      const actions =
        r.status === "prompt"
          ? `<div class="actions">
               <button data-accept="${esc(r.loginId)}">Approve</button>
               <button class="danger" data-reject="${esc(r.loginId)}">Reject</button>
             </div>`
          : "";
      return `<div class="card">
        <div class="row">
          <strong>${esc(r.bindingMessage || r.loginHint || r.loginId)}</strong>
          <span class="status ${r.status}">${r.status}</span>
        </div>
        ${r.loginHint ? `<div class="meta">user: ${esc(r.loginHint)}</div>` : ""}
        <div class="meta">login id: ${esc(r.loginId)}</div>
        <div class="chips">${chips}</div>
        ${r.error ? `<div class="meta" style="color:var(--err)">${esc(r.error)}</div>` : ""}
        ${actions}
      </div>`;
    })
    .join("");
}

async function decide(loginId, decision) {
  await fetch("/api/as/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginId, decision }),
  });
}

$("#cd-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    const res = await fetch("/api/cd/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) alert("Start failed: " + (await res.text()));
  } finally {
    btn.disabled = false;
  }
});

$("#as-list").addEventListener("click", (e) => {
  const accept = e.target.getAttribute("data-accept");
  const reject = e.target.getAttribute("data-reject");
  if (accept) decide(accept, "accept");
  if (reject) decide(reject, "reject");
});

function connect() {
  const es = new EventSource("/api/events");
  es.onmessage = (ev) => {
    const snap = JSON.parse(ev.data);
    renderCd(snap.cd);
    renderAs(snap.as);
  };
  es.onerror = () => {
    es.close();
    setTimeout(connect, 2000);
  };
}

loadConfig();
connect();
