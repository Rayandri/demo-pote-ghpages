// Un site, trois maisons — le même front pour les trois versions.
// window.DEMO = { mode: "api" | "static", login: "password" | "none", greeting?: string, gate?: sha256 }
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

  // ── Écran de verrouillage (GitHub Pages) ──
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function renderLock() {
    let code = "";
    let busy = false;
    app.innerHTML = `
      <div class="lock">
        <h3>Entre le code</h3>
        <div class="dots" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <div class="keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="key" data-k="${n}">${n}</button>`).join("")}
          <button class="key zero" data-k="0">0</button>
          <button class="key ghost" data-k="del">Effacer</button>
        </div>
        <div class="crack">
          <button class="link" id="crack">Pas le code ? Le casser</button>
          <div class="crack-out" id="crack-out" aria-live="polite"></div>
        </div>
      </div>`;
    const dots = [...app.querySelectorAll(".dots span")];
    const paint = () => dots.forEach((d, i) => d.classList.toggle("on", i < code.length));

    async function press(k) {
      if (busy) return;
      if (k === "del") code = code.slice(0, -1);
      else if (code.length < 4) code += k;
      paint();
      if (code.length === 4) {
        busy = true;
        if ((await sha256(code)) === cfg.gate) return setTimeout(openNotebook, 250);
        const box = $(".dots", app);
        box.classList.remove("shake"); void box.offsetWidth; box.classList.add("shake");
        setTimeout(() => { code = ""; paint(); busy = false; }, 450);
      }
    }
    app.querySelectorAll(".key").forEach((b) => b.addEventListener("click", () => press(b.dataset.k)));
    const onKey = (e) => {
      if (!$(".lock", app)) return document.removeEventListener("keydown", onKey);
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
    };
    document.addEventListener("keydown", onKey);

    $("#crack").addEventListener("click", async (e) => {
      if (busy) return;
      busy = true;
      e.currentTarget.disabled = true;
      const out = $("#crack-out");
      out.textContent = "On essaie les 10 000 codes…";
      // 1. Le vrai calcul.
      const t0 = performance.now();
      let found = null;
      for (let i = 0; i < 10000; i++) {
        const c = String(i).padStart(4, "0");
        if ((await sha256(c)) === cfg.gate) { found = c; break; }
      }
      const ms = performance.now() - t0;
      if (!found) { out.textContent = "Pas trouvé."; return; }
      // 2. On le rejoue à l'écran.
      for (let s = 1; s <= 40; s++) {
        const n = Math.round((Number(found) * s) / 40);
        out.innerHTML = `<b>${String(n).padStart(4, "0")}</b>essai ${(n + 1).toLocaleString("fr-FR")} sur 10 000`;
        await new Promise((r) => setTimeout(r, 22));
      }
      const t = ms < 1000 ? Math.max(1, Math.round(ms)) + " ms" : (ms / 1000).toFixed(1).replace(".", ",") + " s";
      out.innerHTML = `<b>${found}</b>Trouvé en ${t}. Ce cadenas ne protégeait rien.`;
      code = found; paint();
      setTimeout(openNotebook, 1800);
    });
  }

  // ── Connexion (Vercel) ──
  function renderSignin(err) {
    app.innerHTML = `
      <form class="signin" id="signin">
        <input name="name" placeholder="Ton prénom" required maxlength="40" autocomplete="username" aria-label="Ton prénom">
        <input name="password" type="password" placeholder="Mot de passe" required autocomplete="current-password" aria-label="Mot de passe">
        <button class="btn">Entrer</button>
        <div class="hint ${err ? "err" : ""}">${esc(err || "")}</div>
      </form>`;
    const form = $("#signin");
    if (err) form.classList.add("shake");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        me = (await api("api/login", { name: f.get("name"), password: f.get("password") })).user;
        openNotebook();
      } catch (ex) {
        renderSignin(ex.message);
      }
    });
  }

  // ── Le carnet ──
  async function loadNotes() {
    if (cfg.mode === "static") return (await (await fetch("data.json", { cache: "no-store" })).json()).notes;
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
        <div class="hint" id="hint">${readOnly ? "Pas de serveur, donc rien ne peut être enregistré." : "Publie un mot, recharge la page : il est toujours là."}</div>
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

  async function start() {
    if (cfg.gate) return renderLock();
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
