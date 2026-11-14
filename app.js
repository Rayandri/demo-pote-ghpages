// Un site, trois maisons — le même front pour les trois versions.
// window.DEMO = { mode: "api" | "static", login: "password" | "none", greeting?: string, encrypted?: true, hint?: string }
// CSP Raspberry : aucun style inline ; seules les propriétés CSSOM (el.style.x) sont utilisées.
(() => {
  const cfg = window.DEMO || { mode: "api", login: "none" };
  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");
  let me = null;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shortName = (s) => String(s || "?").split("@")[0];
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const UNITS = [["year", 31557600], ["month", 2629800], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  function ago(iso) {
    const s = (new Date(iso) - Date.now()) / 1000;
    if (Math.abs(s) < 45) return "à l'instant";
    for (const [unit, sec] of UNITS) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit);
    return rtf.format(Math.round(s / 60), "minute");
  }

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

  // ── Apparitions au scroll ──
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 })
    : null;
  document.querySelectorAll(".reveal").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));

  // ── Coffre chiffré (GitHub Pages) ──
  // Les mots sont chiffrés avec le mot de passe (PBKDF2 → AES-GCM). Sans lui : du charabia.
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let vault = null;
  let notesPlain = null;
  async function tryPassword(pw) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(vault.salt), iterations: vault.iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(vault.iv) }, key, b64(vault.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  const sup = (n) => String(n).replace(/[0-9-]/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"["0123456789".indexOf(d)] ?? "⁻");
  const sci = (x) => { const e = Math.floor(Math.log10(x)); return `${(x / 10 ** e).toFixed(1).replace(".", ",")} × 10${sup(e)}`; };

  async function renderVault() {
    vault = await (await fetch("data.enc.json", { cache: "no-store" })).json();
    const peek = document.getElementById("cipher");
    if (peek) peek.textContent = vault.data.slice(0, 64) + "…";
    app.innerHTML = `
      <form class="signin" id="vault">
        <input name="password" type="password" placeholder="Mot de passe (20 caractères)" required autocomplete="off" aria-label="Mot de passe">
        <button class="btn">Ouvrir</button>
        <div class="hint" id="vault-hint"></div>
        <button type="button" class="link" id="crack">Essayer de le casser</button>
        <div class="crack-out" id="crack-out" aria-live="polite"></div>
      </form>`;
    const form = $("#vault"), hint = $("#vault-hint");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $(".btn", form);
      btn.disabled = true;
      hint.classList.remove("err");
      hint.textContent = "Déchiffrement…";
      try {
        notesPlain = (await tryPassword(new FormData(form).get("password"))).notes;
        openNotebook();
      } catch {
        hint.classList.add("err");
        hint.textContent = "Mauvais mot de passe.";
        form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");
        btn.disabled = false;
      }
    });
    $("#crack").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      const out = $("#crack-out");
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      const t0 = performance.now();
      let tries = 0;
      while (performance.now() - t0 < 4000) {
        let guess = "";
        for (let i = 0; i < 20; i++) guess += chars[(Math.random() * 62) | 0];
        out.innerHTML = `<b class="guess">${guess}</b>${tries} essais`;
        try { await tryPassword(guess); } catch { /* raté, évidemment */ }
        tries++;
      }
      const rate = tries / ((performance.now() - t0) / 1000);
      const years = 62 ** 20 / 2 / rate / 31557600;
      out.innerHTML = `<b>${tries} essais. Raté.</b>Il en faudrait ${sci(62 ** 20)}.<br>À ce rythme : ${sci(years)} années.<br>L'univers a 1,4 × 10¹⁰ ans.`;
    });
  }

  // ── Connexion (Vercel) ──
  let fails = 0;
  function renderSignin(err) {
    const showHint = fails >= 3 && cfg.hint;
    app.innerHTML = `
      <form class="signin" id="signin">
        <input name="name" placeholder="Ton prénom" required maxlength="40" autocomplete="username" aria-label="Ton prénom">
        <input name="password" type="password" placeholder="${esc(cfg.question || "Mot de passe")}" required autocomplete="current-password" aria-label="Mot de passe">
        <button class="btn">Entrer</button>
        <div class="hint ${err ? "err" : ""}">${esc(err || "")}</div>
        ${showHint ? `<div class="tip">Indice : ${esc(cfg.hint)}</div>` : ""}
      </form>`;
    const form = $("#signin");
    if (err) form.classList.add("shake");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        me = (await api("api/login", { name: f.get("name"), password: f.get("password") })).user;
        fails = 0;
        openNotebook();
      } catch (ex) {
        if (ex.status === 401) fails++;
        renderSignin(ex.message);
        const name = $("input[name=name]", app);
        name.value = f.get("name");
        $("input[name=password]", app).focus();
      }
    });
  }

  // ── Le carnet ──
  async function loadNotes() {
    if (cfg.mode === "static") return notesPlain || [];
    return (await api("api/notes")).notes;
  }

  const noteHTML = (n) => `
    <li class="note ${me && n.author === me ? "mine" : ""}">
      <p>${esc(n.text)}</p>
      <footer><span class="avatar">${esc(shortName(n.author).slice(0, 1))}</span>
      <span>${esc(shortName(n.author))} · ${esc(ago(n.created_at))}</span></footer>
    </li>`;

  async function openNotebook() {
    const readOnly = cfg.mode === "static";
    app.innerHTML = `
      <div class="notebook unlock">
        ${me && cfg.greeting ? `<div class="hello"><strong>${esc(cfg.greeting)}</strong><span>${esc(me)}</span>
          ${cfg.login === "password" ? `<div><button class="link logout" id="logout">Se déconnecter</button></div>` : ""}</div>` : ""}
        <form class="composer ${readOnly ? "locked" : ""}" id="composer">
          <textarea name="text" rows="1" maxlength="280" placeholder="${readOnly ? "Impossible d'écrire ici" : "Écris un mot…"}" ${readOnly ? "disabled" : ""} aria-label="Ton mot"></textarea>
          <button class="btn" ${readOnly ? "disabled" : ""}>Publier</button>
        </form>
        <div class="hint" id="hint">${readOnly ? "Déchiffré dans ton navigateur. Mais pas de serveur : impossible d'écrire." : "Publie un mot, recharge la page : il est toujours là."}</div>
        <ul class="notes" id="notes"><li class="skeleton"></li><li class="skeleton"></li></ul>
      </div>`;

    $("#logout")?.addEventListener("click", async () => { await api("api/logout", {}); me = null; renderSignin(); });

    const list = $("#notes");
    try {
      const notes = await loadNotes();
      list.innerHTML = notes.length ? notes.map(noteHTML).join("") : `<li class="empty">Rien pour l'instant. Écris le premier mot.</li>`;
    } catch (ex) {
      if (ex.status === 401) return cfg.login === "password" ? renderSignin() : denied();
      list.innerHTML = `<li class="empty">${esc(ex.message)}</li>`;
    }
    if (readOnly) return;

    const form = $("#composer"), ta = $("textarea", form), hint = $("#hint");
    const grow = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
    ta.addEventListener("input", grow);
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return ta.focus();
      const btn = $("button", form);
      btn.disabled = true;
      try {
        const { note } = await api("api/notes", { text });
        $(".empty", list)?.remove();
        list.insertAdjacentHTML("afterbegin", noteHTML(note));
        ta.value = ""; grow();
        hint.classList.remove("err");
        hint.textContent = "Publié. Recharge la page pour vérifier.";
      } catch (ex) {
        if (ex.status === 401) return cfg.login === "password" ? renderSignin() : denied();
        hint.classList.add("err");
        hint.textContent = ex.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  function denied() {
    app.innerHTML = `<p class="empty">Accès refusé.</p>`;
  }

  // ── Infos en direct de la Raspberry ──
  async function piStats() {
    try {
      const pi = await api("api/pi");
      const d = Math.floor(pi.uptime_s / 86400), h = Math.floor((pi.uptime_s % 86400) / 3600);
      const up = d ? `${d} jour${d > 1 ? "s" : ""} et ${h} h` : `${h} h ${Math.floor((pi.uptime_s % 3600) / 60)} min`;
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.textContent = v; };
      set("pi-model", pi.model);
      set("pi-mem", pi.mem_gb);
      set("pi-up", up);
      set("pi-temp", pi.temp_c != null ? `${String(pi.temp_c).replace(".", ",")} °C` : null);
    } catch { /* pas grave : on garde le texte par défaut */ }
  }

  async function start() {
    if (cfg.piStats) { piStats(); setInterval(piStats, 30000); }
    if (cfg.encrypted) return renderVault();
    if (cfg.mode === "api") {
      try {
        me = (await api("api/me")).user;
      } catch (ex) {
        if (ex.status === 401) return cfg.login === "password" ? renderSignin() : denied();
        app.innerHTML = `<p class="empty">${esc(ex.message)}</p>`;
        return;
      }
    }
    openNotebook();
  }

  start();
})();
