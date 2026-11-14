// Carnet de décisions — même front pour les 3 hébergeurs.
// window.DEMO = { mode: "api" | "static", login: "password" | "none", greeting?: string }
// CSP Raspberry : aucun style inline. Les seules valeurs dynamiques passent par
// el.style.setProperty("--x", …) (CSSOM, autorisé) et des classes.
(() => {
  const cfg = window.DEMO || { mode: "api", login: "none" };
  const $ = (s) => document.querySelector(s);
  const app = $("#app");
  let me = null;

  // Mémoire du rendu précédent : sert à animer ce qui a changé, et seulement ça.
  const prev = new Map(); // id -> { pour, contre }
  let booted = false;
  let focusAfter = null; // "id:vote" du bouton à re-focaliser après un vote

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

  const ICON = {
    arrow: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4"/></svg>',
    plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11"/></svg>',
    minus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h11"/></svg>',
  };

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

  const source = () =>
    cfg.mode === "static" ? (window.DEMO_DATA ? "données intégrées" : "GET data.json") : "GET api/proposals";

  // « GET data.json » -> verbe en accent, chemin en clair
  const verb = (src) => {
    const [v, ...rest] = src.split(" ");
    return /^[A-Z]+$/.test(v) ? `<b>${esc(v)}</b> ${esc(rest.join(" "))}` : esc(src);
  };

  async function loadProposals() {
    if (cfg.mode === "static") {
      // GitHub Pages : données intégrées à la page avant chiffrement (sinon data.json serait public)
      if (window.DEMO_DATA) return window.DEMO_DATA.proposals;
      const res = await fetch("data.json", { cache: "no-store" });
      return (await res.json()).proposals;
    }
    return (await api("api/proposals")).proposals;
  }

  function showLatency(ms) {
    document.querySelectorAll("[data-latency]").forEach((el) => (el.textContent = `lecture ${ms} ms`));
  }

  function renderLoading(label) {
    app.innerHTML = `
      <div class="loader" role="status">
        <p class="loader-line"><span>${verb(label)}</span><span>en cours</span><span class="caret" aria-hidden="true"></span></p>
        <div class="sk" aria-hidden="true">
          <div class="sk-row"><i></i><i></i></div>
          <div class="sk-row"><i></i><i></i></div>
          <div class="sk-row"><i></i><i></i></div>
        </div>
        <span class="sr-only">Chargement des données…</span>
      </div>`;
  }

  function renderError(message) {
    app.innerHTML = `<div class="failure" role="alert"><p class="kicker">Erreur</p><p class="error">${esc(message)}</p></div>`;
  }

  function renderLogin(err) {
    app.innerHTML = `
      <section class="login" aria-labelledby="login-title">
        <div>
          <p class="kicker">Accès · mot de passe partagé</p>
          <h3 class="display-sm" id="login-title">Qui <em>es-tu</em> ?</h3>
          <p class="login-note">Ton prénom signe tes ajouts et tes votes. Le serveur vérifie le mot de passe, puis pose un cookie signé.</p>
        </div>
        <form id="login" class="login-form${err ? " has-error" : ""}">
          <label class="field"><span class="field-label">Prénom</span>
            <input name="name" placeholder="Ton prénom" required maxlength="40" autocomplete="username"></label>
          <label class="field"><span class="field-label">Mot de passe</span>
            <input name="password" type="password" placeholder="Celui que Rayan t'a donné" required autocomplete="current-password"></label>
          <button class="btn btn-primary">Entrer ${ICON.arrow}</button>
          <div class="error" role="alert">${esc(err || "")}</div>
        </form>
      </section>`;
    const form = $("#login");
    if (err) form.querySelector('[name="name"]').focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = form.querySelector("button");
      btn.setAttribute("aria-busy", "true");
      btn.disabled = true;
      try {
        await api("api/login", { name: f.get("name"), password: f.get("password") });
        start();
      } catch (ex) {
        renderLogin(ex.message);
      }
    };
  }

  // Compteur : si la valeur a changé depuis le dernier rendu, l'ancienne sort et la nouvelle entre.
  function count(now, before) {
    if (before === undefined || before === now) return `<span class="count"><span class="count-v">${now}</span></span>`;
    const dir = now > before ? "up" : "down";
    return `<span class="count ${dir}"><span class="count-old" aria-hidden="true">${before}</span><span class="count-v">${now}</span></span>`;
  }

  function renderBoard(proposals, ms) {
    const readOnly = cfg.mode === "static";

    const session = me
      ? `<div class="session">
          <div>
            ${cfg.greeting ? `<p class="greeting">${esc(cfg.greeting)}</p>` : ""}
            <p class="session-meta">Connecté·e en tant que <strong>${esc(me)}</strong></p>
          </div>
          ${cfg.login === "password" ? '<button id="logout" class="btn btn-ghost">Se déconnecter</button>' : ""}
        </div>`
      : "";

    const write = readOnly
      ? `<div class="notice">
          <p class="kicker">Lecture seule</p>
          <p>Ici, personne ne peut ajouter ni voter : GitHub Pages ne sert que des fichiers.</p>
          <p>Les données viennent de <code>data.json</code>, modifié à la main dans le repo.</p>
        </div>`
      : `<section class="panel" aria-labelledby="add-title">
          <div class="panel-head">
            <h3 class="panel-title" id="add-title">Écrire dans la base</h3>
            <p class="endpoint"><b>POST</b> api/proposals</p>
          </div>
          <form id="add" class="add-form">
            <label class="field"><span class="field-label">Titre</span>
              <input name="title" placeholder="Ex. : on garde la Raspberry ?" required maxlength="120"></label>
            <label class="field"><span class="field-label">Détails <i>· facultatif</i></span>
              <textarea name="description" placeholder="Une phrase suffit." maxlength="1000"></textarea></label>
            <div class="add-foot">
              <button class="btn btn-primary">Proposer ${ICON.arrow}</button>
              <div class="error" id="add-err" role="alert"></div>
            </div>
          </form>
        </section>`;

    const rows = proposals.map((p) => {
      const votes = p.votes || [];
      const mine = votes.find((v) => v.voter === me);
      const pour = votes.filter((v) => v.value > 0).map((v) => v.voter);
      const contre = votes.filter((v) => v.value < 0).map((v) => v.voter);
      return { p, mine, pour, contre, before: prev.get(String(p.id)) };
    });

    const list = rows.length
      ? `<ol class="entries">${rows
          .map(({ p, mine, pour, contre, before }, i) => {
            const isNew = !booted || !before;
            const total = pour.length + contre.length;
            return `<li class="entry${isNew ? " is-new" : ""}${booted && !before ? " is-fresh" : ""}" data-entry="${esc(p.id)}" data-i="${i}">
              <span class="entry-no">Nº ${esc(String(p.id).padStart(3, "0"))}</span>
              <div class="entry-body">
                <h4 class="entry-title">${esc(p.title)}</h4>
                ${p.description ? `<p class="entry-desc">${esc(p.description)}</p>` : ""}
                <p class="entry-meta">${esc(p.author)}<span aria-hidden="true">/</span><time datetime="${esc(p.created_at)}">${esc(fmtDate(p.created_at))}</time></p>
              </div>
              <div class="tally" aria-label="${pour.length} pour, ${contre.length} contre">
                <div class="tally-item is-pro" aria-hidden="true">${count(pour.length, before?.pour)}<span class="tally-label">pour</span></div>
                <div class="tally-item" aria-hidden="true">${count(contre.length, before?.contre)}<span class="tally-label">contre</span></div>
              </div>
              <div class="meter" aria-hidden="true" data-pro="${total ? pour.length / total : 0}" data-con="${total ? contre.length / total : 0}"
                data-pro0="${before && before.total ? before.pour / before.total : 0}" data-con0="${before && before.total ? before.contre / before.total : 0}">
                <span class="meter-pro"></span><span class="meter-con"></span>
              </div>
              <div class="entry-foot">
                <p class="voters">${total ? `<b>Pour</b> ${esc(pour.join(", ") || "—")} &nbsp; <b>Contre</b> ${esc(contre.join(", ") || "—")}` : "Pas encore de vote."}</p>
                <div class="actions">
                  <button data-vote="1" data-id="${esc(p.id)}" class="vote vote-pro${mine?.value > 0 ? " is-on" : ""}" aria-pressed="${mine?.value > 0}" ${readOnly ? "disabled" : ""}>${ICON.plus}<span>Pour</span></button>
                  <button data-vote="-1" data-id="${esc(p.id)}" class="vote vote-con${mine?.value < 0 ? " is-on" : ""}" aria-pressed="${mine?.value < 0}" ${readOnly ? "disabled" : ""}>${ICON.minus}<span>Contre</span></button>
                  ${mine ? '<p class="vote-hint">Reclique sur ton vote pour l\'annuler.</p>' : ""}
                </div>
              </div>
            </li>`;
          })
          .join("")}</ol>`
      : `<div class="empty"><p class="display-sm">Page <em>blanche</em>.</p><p>Aucune proposition pour l'instant.</p></div>`;

    const read = `<section class="panel" aria-labelledby="read-title">
        <div class="panel-head">
          <h3 class="panel-title" id="read-title">Lire la base</h3>
          <p class="readout"><span>${verb(source())}</span><span>${rows.length} ligne${rows.length > 1 ? "s" : ""}</span><span>${ms} ms</span></p>
        </div>
        ${list}
      </section>`;

    app.innerHTML = `<div class="app-grid${booted ? " is-steady" : ""}">${session}${write}${read}</div>`;

    // Cascade d'entrée + jauges : on part de l'ancienne proportion, puis on glisse vers la nouvelle.
    const meters = [...app.querySelectorAll(".meter")];
    app.querySelectorAll(".entry.is-new").forEach((el) => el.style.setProperty("--i", el.dataset.i));
    meters.forEach((m) => {
      m.style.setProperty("--pro", m.dataset.pro0);
      m.style.setProperty("--con", m.dataset.con0);
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        meters.forEach((m) => {
          m.style.setProperty("--pro", m.dataset.pro);
          m.style.setProperty("--con", m.dataset.con);
        })
      )
    );

    prev.clear();
    rows.forEach(({ p, pour, contre }) =>
      prev.set(String(p.id), { pour: pour.length, contre: contre.length, total: pour.length + contre.length })
    );
    booted = true;

    if (focusAfter) {
      const b = app.querySelector(`[data-id="${CSS.escape(focusAfter.id)}"][data-vote="${focusAfter.vote}"]`);
      if (b) {
        b.focus({ preventScroll: true });
        b.classList.add("just-voted");
      }
      focusAfter = null;
    }

    $("#logout")?.addEventListener("click", async () => {
      await api("api/logout", {});
      me = null;
      prev.clear();
      booted = false;
      renderLogin();
    });
    $("#add")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = e.target.querySelector("button");
      btn.setAttribute("aria-busy", "true");
      btn.disabled = true;
      try {
        await api("api/proposals", { title: f.get("title"), description: f.get("description") });
        refresh();
      } catch (ex) {
        btn.removeAttribute("aria-busy");
        btn.disabled = false;
        $("#add-err").textContent = ex.message;
      }
    });
    app.querySelectorAll("[data-vote]").forEach((b) =>
      b.addEventListener("click", async () => {
        const entry = b.closest(".entry");
        const pair = entry.querySelectorAll("[data-vote]");
        entry.classList.add("is-busy");
        b.setAttribute("aria-busy", "true");
        pair.forEach((x) => (x.disabled = true));
        try {
          await api("api/vote", { id: Number(b.dataset.id), value: Number(b.dataset.vote) });
          focusAfter = { id: b.dataset.id, vote: b.dataset.vote };
          refresh();
        } catch (ex) {
          entry.classList.remove("is-busy");
          b.removeAttribute("aria-busy");
          pair.forEach((x) => (x.disabled = false));
          if (ex.status === 401) return renderLogin();
          let err = entry.querySelector(".entry-err");
          if (!err) {
            err = document.createElement("p");
            err.className = "entry-err error";
            err.setAttribute("role", "alert");
            entry.appendChild(err);
          }
          err.textContent = ex.message;
        }
      })
    );
  }

  async function refresh() {
    try {
      const t0 = performance.now();
      const proposals = await loadProposals();
      const ms = Math.max(1, Math.round(performance.now() - t0));
      showLatency(ms);
      renderBoard(proposals, ms);
    } catch (ex) {
      if (ex.status === 401) return renderLogin();
      renderError(ex.message);
    }
  }

  async function start() {
    if (cfg.mode === "api") {
      renderLoading("GET api/me");
      try {
        me = (await api("api/me")).user;
      } catch (ex) {
        if (ex.status === 401) return renderLogin();
        renderError(ex.message);
        return;
      }
    }
    renderLoading(source());
    refresh();
  }

  start();
})();
