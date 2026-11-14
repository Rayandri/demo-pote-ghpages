// Un site, trois maisons — le même front pour les trois versions.
// window.DEMO = { mode: "api" | "static", login: "password" | "none", greeting?: string, gate?: sha256, encrypted?: true, hint?: string }
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

  // ── Couche 1 : code à 4 chiffres (GitHub Pages) ──
  // Vérifié par la page elle-même : on peut le casser… ou modifier la page.
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function renderLock() {
    let code = "";
    let busy = false;
    app.innerHTML = `
      <div class="lock">
        <p class="layer">Couche 1 · Code à 4 chiffres</p>
        <div class="dots" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <div class="keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="key" data-k="${n}">${n}</button>`).join("")}
          <button class="key zero" data-k="0">0</button>
          <button class="key ghost" data-k="del">Effacer</button>
        </div>
        <div class="lock-actions">
          <button class="link" id="crack">Le casser</button>
          <button class="link" id="cheat">Tricher : modifier la page</button>
        </div>
        <div class="crack-out" id="crack-out" aria-live="polite"></div>
      </div>`;
    const dots = [...app.querySelectorAll(".dots span")];
    const paint = () => dots.forEach((d, i) => d.classList.toggle("on", i < code.length));
    const out = $("#crack-out");
    const pass = (msg) => { busy = true; if (msg) out.innerHTML = msg; setTimeout(() => renderVault(true), msg ? 1900 : 300); };

    async function press(k) {
      if (busy) return;
      if (k === "del") code = code.slice(0, -1);
      else if (code.length < 4) code += k;
      paint();
      if (code.length === 4) {
        busy = true;
        if ((await sha256(code)) === cfg.gate) return pass();
        const box = $(".dots", app);
        box.classList.remove("shake"); void box.offsetWidth; box.classList.add("shake");
        setTimeout(() => { code = ""; paint(); busy = false; }, 450);
      }
    }
    app.querySelectorAll(".key").forEach((b) => b.addEventListener("click", () => press(b.dataset.k)));
    const onKey = (e) => {
      if (!$(".lock", app)) return document.removeEventListener("keydown", onKey);
      if (e.target.closest && e.target.closest("input, textarea")) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
    };
    document.addEventListener("keydown", onKey);

    $("#crack").addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      out.textContent = "On essaie les 10 000 codes…";
      const t0 = performance.now();
      let found = null;
      for (let i = 0; i < 10000; i++) {
        const c = String(i).padStart(4, "0");
        if ((await sha256(c)) === cfg.gate) { found = c; break; }
      }
      const ms = performance.now() - t0;
      for (let s = 1; s <= 30; s++) {
        const n = Math.round((Number(found) * s) / 30);
        out.innerHTML = `<b>${String(n).padStart(4, "0")}</b>essai ${(n + 1).toLocaleString("fr-FR")} sur 10 000`;
        await new Promise((r) => setTimeout(r, 22));
      }
      code = found; paint();
      const t = ms < 1000 ? Math.max(1, Math.round(ms)) + " ms" : (ms / 1000).toFixed(1).replace(".", ",") + " s";
      pass(`<b>${found}</b>Trouvé en ${t} par ce navigateur. Une carte graphique : instantané.`);
    });

    $("#cheat").addEventListener("click", () => {
      if (busy) return;
      pass(`<b>if (true)</b>On a remplacé la vérification dans la page. Porte ouverte, sans le code.`);
    });
  }

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

  async function renderVault(fromGate) {
    vault = await (await fetch("data.enc.json", { cache: "no-store" })).json();
    const peek = document.getElementById("cipher");
    if (peek) peek.textContent = vault.data.slice(0, 64) + "…";
    app.innerHTML = `
      <form class="signin ${fromGate ? "unlock" : ""}" id="vault">
        <p class="layer">Couche 2 · Mot de passe de 20 caractères</p>
        ${fromGate ? `<p class="layer-note">Porte franchie. Mais les mots sont chiffrés : ici, tricher ne sert à rien.</p>` : ""}
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
      browserRate = rate; calc.render?.();
      const years = 62 ** 20 / 2 / rate / 31557600;
      out.innerHTML = `<b>${tries} essais. Raté.</b>Il en faudrait ${sci(62 ** 20 / 2)} en moyenne.<br>À ce rythme : ${sci(years)} ans. Joue avec le calculateur plus bas.`;
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

  // ── Calculateur : combien de temps pour casser ? ──
  let browserRate = 10; // essais/s, mis à jour quand on tente de casser pour de vrai
  function calc() {
    const box = document.getElementById("calc");
    if (!box) return;
    const RATES = { browser: () => browserRate, rtx: () => 45000, gb300: () => 45000 * 2 * 72 };
    const NAMES = { browser: "ce navigateur", rtx: "une RTX 4090", gb300: "un rack GB300" };
    const PW = { "4d": [10, 4, "10⁴"], "8l": [26, 8, "26⁸"], "12c": [62, 12, "62¹²"], "20c": [62, 20, "62²⁰"] };
    const Y = 31557600, UNIVERSE = 1.38e10;
    const fmtN = (x) => x < 1e6 ? Math.round(x).toLocaleString("fr-FR") : sci(x);
    function human(sec) {
      if (sec < 1) return "Instantané";
      if (sec < 60) return `${Math.round(sec)} secondes`;
      if (sec < 3600) return `${Math.round(sec / 60)} minutes`;
      if (sec < 86400) return `${Math.round(sec / 3600)} heures`;
      if (sec < Y) return `${Math.round(sec / 86400)} jours`;
      if (sec / Y < 1e6) return `${Math.round(sec / Y).toLocaleString("fr-FR")} ans`;
      return `${sci(sec / Y)} ans`;
    }
    function say(sec) {
      const y = sec / Y;
      if (sec < 1) return "Moins qu'un clignement d'yeux.";
      if (sec < 600) return "Le temps de finir son café.";
      if (sec < 86400) return "Il lance ça le soir, c'est fini au réveil.";
      if (y < 1) return "Long, mais largement faisable.";
      if (y < 100) return "Une vie entière. Mais un jour, il l'aura.";
      if (y < UNIVERSE) return "Les pyramides ont 4 500 ans. Il serait encore là.";
      return `${sci(y / UNIVERSE)} fois l'âge de l'univers. Impossible.`;
    }
    const state = { who: "rtx", pw: "8l" };
    function render() {
      const [base, len, label] = PW[state.pw];
      const n = base ** len, rate = RATES[state.who]();
      const sec = n / 2 / rate;
      $("#calc-time").textContent = human(sec);
      $("#calc-say").textContent = say(sec);
      $("#calc-math").textContent = `${label} = ${fmtN(n)} combinaisons ÷ 2 en moyenne ÷ ${fmtN(rate)} essais/s (${NAMES[state.who]})`;
    }
    box.querySelectorAll(".seg").forEach((seg) => seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      state[seg.dataset.k] = b.dataset.v;
      render();
    }));
    calc.render = render;
    render();
  }
  calc();

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
    if (cfg.gate) return renderLock();
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
