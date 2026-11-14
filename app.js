// Carnet de décisions — même front pour les 3 hébergeurs.
// window.DEMO = { mode: "api" | "static", login: "password" | "none", greeting?: string }
(() => {
  const cfg = window.DEMO || { mode: "api", login: "none" };
  const $ = (s) => document.querySelector(s);
  const app = $("#app");
  let me = null;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Erreur " + res.status), { status: res.status });
    return data;
  }

  async function loadProposals() {
    if (cfg.mode === "static") {
      // GitHub Pages : données intégrées à la page avant chiffrement (sinon data.json serait public)
      if (window.DEMO_DATA) return window.DEMO_DATA.proposals;
      const res = await fetch("data.json", { cache: "no-store" });
      return (await res.json()).proposals;
    }
    return (await api("api/proposals")).proposals;
  }

  function renderLogin(err) {
    app.innerHTML = `
      <div class="card">
        <h2>Connexion</h2>
        <form id="login">
          <input name="name" placeholder="Ton prénom" required maxlength="40" autocomplete="username">
          <input name="password" type="password" placeholder="Mot de passe partagé" required autocomplete="current-password">
          <button class="primary">Entrer</button>
          <div class="error">${esc(err || "")}</div>
        </form>
      </div>`;
    $("#login").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api("api/login", { name: f.get("name"), password: f.get("password") });
        start();
      } catch (ex) {
        renderLogin(ex.message);
      }
    };
  }

  function renderBoard(proposals) {
    const readOnly = cfg.mode === "static";
    const userbar = me
      ? `<div class="card userbar"><span>${cfg.greeting ? `<strong>${esc(cfg.greeting)}</strong><br>` : ""}Connecté·e en tant que <strong>${esc(me)}</strong></span>
         ${cfg.login === "password" ? '<button id="logout">Se déconnecter</button>' : ""}</div>`
      : "";
    const form = readOnly
      ? `<div class="notice">Ici, personne ne peut ajouter ou voter : GitHub Pages ne sert que des fichiers.
         Les données viennent d'un fichier <code>data.json</code> qu'on modifie à la main dans le repo.</div>`
      : `<div class="card"><h2>Nouvelle proposition</h2>
          <form id="add">
            <input name="title" placeholder="Titre" required maxlength="120">
            <textarea name="description" placeholder="Détails (facultatif)" maxlength="1000"></textarea>
            <button class="primary">Proposer</button>
            <div class="error" id="add-err"></div>
          </form></div>`;
    const list = proposals.length
      ? proposals
          .map((p) => {
            const mine = (p.votes || []).find((v) => v.voter === me);
            const pour = (p.votes || []).filter((v) => v.value > 0).map((v) => v.voter);
            const contre = (p.votes || []).filter((v) => v.value < 0).map((v) => v.voter);
            return `<div class="card">
              <div class="prop-head">
                <span class="prop-title">${esc(p.title)}</span>
                <span class="score">👍 ${pour.length} · 👎 ${contre.length}</span>
              </div>
              ${p.description ? `<p>${esc(p.description)}</p>` : ""}
              <div class="meta">Proposé par ${esc(p.author)} le ${fmtDate(p.created_at)}</div>
              ${pour.length || contre.length ? `<div class="meta">Pour : ${esc(pour.join(", ") || "—")} · Contre : ${esc(contre.join(", ") || "—")}</div>` : ""}
              <div class="actions">
                <button data-vote="1" data-id="${p.id}" class="${mine?.value > 0 ? "voted-up" : ""}" ${readOnly ? "disabled" : ""}>👍 Pour</button>
                <button data-vote="-1" data-id="${p.id}" class="${mine?.value < 0 ? "voted-down" : ""}" ${readOnly ? "disabled" : ""}>👎 Contre</button>
              </div>
            </div>`;
          })
          .join("")
      : `<div class="card empty">Aucune proposition pour l'instant.</div>`;

    app.innerHTML = userbar + form + list;

    $("#logout")?.addEventListener("click", async () => {
      await api("api/logout", {});
      me = null;
      renderLogin();
    });
    $("#add")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api("api/proposals", { title: f.get("title"), description: f.get("description") });
        refresh();
      } catch (ex) {
        $("#add-err").textContent = ex.message;
      }
    });
    app.querySelectorAll("[data-vote]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await api("api/vote", { id: Number(b.dataset.id), value: Number(b.dataset.vote) });
          refresh();
        } catch (ex) {
          alert(ex.message);
        }
      })
    );
  }

  async function refresh() {
    try {
      renderBoard(await loadProposals());
    } catch (ex) {
      if (ex.status === 401) return renderLogin();
      app.innerHTML = `<div class="card error">${esc(ex.message)}</div>`;
    }
  }

  async function start() {
    if (cfg.mode === "api") {
      try {
        me = (await api("api/me")).user;
      } catch (ex) {
        if (ex.status === 401) return renderLogin();
        app.innerHTML = `<div class="card error">${esc(ex.message)}</div>`;
        return;
      }
    }
    refresh();
  }

  start();
})();
