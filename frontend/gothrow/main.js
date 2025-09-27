/*
  Gothrow – main.js
  - Frontend served at /gothrow in production (Netlify)
  - Netlify proxies /gothrow/api/* -> Cloud Run backend
  - Local dev: calls Cloud Run URL directly (edit CLOUD_RUN if needed)
*/

/* ================== CONFIG ================== */
const CONFIG = {
  MODE: "backend", // "csv" | "api" | "backend"

  // Backend (recommended) – we only keep the path AFTER /api
  BACKEND_REG_PATH: "/registrations",

  // CSV mode (Publish to web → CSV)
  SHEET_CSV_URL:
    "https://docs.google.com/spreadsheets/d/1EbNX-ftw8EpLeXawcFTILMiOBgA_VEGzJfFhroM6Oao/export?format=csv&gid=579326287",

  // API mode (Google Sheets API + API key)
  SHEET_ID: "",
  API_KEY: "",
  RANGE: "Form Responses 1!A1:Z",

  // Column detection (case-insensitive)
  TEAM_COL_CANDIDATES: [
    "team name", "team", "teamname", "club", "lag", "lag/namn", "klubb"
  ],
  COUNTRY_COL_CANDIDATES: ["country", "land", "nation"],
  LEVEL_COL_CANDIDATES: ["team level", "level", "division", "nivå"],

  REFRESH_MS: 60_000, // auto-refresh every 60s (0 to disable)
};

/* ===== API base: /gothrow in prod, direct Cloud Run in dev ===== */
const CLOUD_RUN = "https://labamba-backend-459492754349.europe-north1.run.app";

const isProd =
  location.hostname.endsWith("labambafrisbee.se") ||
  location.hostname.endsWith("netlify.app");

const BASE_PATH = isProd ? "/gothrow" : "";      // where the site lives
const API_BASE  = isProd ? `${BASE_PATH}/api`    // Netlify proxy
                         : `${CLOUD_RUN}/api`;   // direct to Cloud Run for local dev

/* ================== Helpers ================== */
const $ = (sel) => document.querySelector(sel);
const setText = (el, txt) => { if (el) el.textContent = txt; };

function normalizeHeader(h) {
  const s = (h || "").toString()
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "") // zero-width/BOM
    .replace(/\u00A0/g, " ")                           // NBSP -> space
    .trim();
  return s.toLowerCase();
}

function detectIndex(headers, candidates, fallbackRegex) {
  const low = headers.map(normalizeHeader);
  const simple = low.map(h =>
    h.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "")
  );
  const candSimple = candidates.map(c =>
    c.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "")
  );

  for (const c of candidates) {
    const i = low.indexOf(c.toLowerCase());
    if (i !== -1) return i;
  }
  for (const cs of candSimple) {
    const i = simple.indexOf(cs);
    if (i !== -1) return i;
  }
  let i = low.findIndex(h => fallbackRegex.test(h));
  if (i !== -1) return i;
  i = simple.findIndex(h => fallbackRegex.test(h));
  return i >= 0 ? i : -1;
}

// Tiny CSV parser
function parseCSV(text) {
  const rows = [];
  let cur = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i+1];
    if (inQuotes) {
      if (ch === '"') { if (next === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { cur.push(field); field = ""; }
      else if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (ch === '\r') { /* ignore */ }
      else field += ch;
    }
  }
  cur.push(field); rows.push(cur);
  while (rows.length && rows[rows.length - 1].every(c => c === "")) rows.pop();
  return rows;
}

/* =========== Teams: fetch & render =========== */
function renderTeamsList(items) {
  const list = $('#teamList');
  const count = $('#teamCount');
  if (!list || !count) return;

  const map = new Map();
  for (const it of items) {
    const key = (it.team || '').toLocaleLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, it);
  }
  const teams = Array.from(map.values())
    .sort((a, b) => a.team.localeCompare(b.team, undefined, { sensitivity: 'base' }));

  list.innerHTML = '';
  setText(
    count,
    teams.length ? `${teams.length} team${teams.length === 1 ? '' : 's'} registered`
                 : 'No teams yet – be the first!'
  );

  for (const t of teams) {
    const li = document.createElement('li');
    const meta = [t.country, t.level].filter(Boolean).join(' • ');
    li.textContent = meta ? `${t.team} — ${meta}` : t.team;
    list.appendChild(li);
  }
}

async function loadFromCSV() {
  const res = await fetch(CONFIG.SHEET_CSV_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const headers = rows[0];

  const teamCol = detectIndex(headers, CONFIG.TEAM_COL_CANDIDATES, /(team|lag|club|klubb|team name)/);
  if (teamCol === -1) throw new Error("Couldn't find a Team column.");

  const countryCol = detectIndex(headers, CONFIG.COUNTRY_COL_CANDIDATES, /(country|land|nation)/);
  const levelCol   = detectIndex(headers, CONFIG.LEVEL_COL_CANDIDATES, /(level|division|nivå|team level)/);

  return rows.slice(1).map(r => ({
    team: (r[teamCol] || '').trim(),
    country: countryCol !== -1 ? (r[countryCol] || '').trim() : '',
    level:   levelCol   !== -1 ? (r[levelCol]   || '').trim() : '',
  }));
}

async function loadFromAPI() {
  const { SHEET_ID, API_KEY, RANGE } = CONFIG;
  if (!SHEET_ID || !API_KEY) throw new Error('Please set SHEET_ID and API_KEY for API mode.');
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SHEET_ID)}/values/${encodeURIComponent(RANGE)}`);
  url.searchParams.set('key', API_KEY);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheets API fetch failed: ${res.status}`);
  const data = await res.json();
  const rows = data.values || [];
  if (!rows.length) return [];
  const headers = rows[0];

  const teamCol    = detectIndex(headers, CONFIG.TEAM_COL_CANDIDATES, /(team|lag|club|klubb)/);
  if (teamCol === -1) throw new Error("Couldn't find a Team column.");
  const countryCol = detectIndex(headers, CONFIG.COUNTRY_COL_CANDIDATES, /(country|land|nation)/);
  const levelCol   = detectIndex(headers, CONFIG.LEVEL_COL_CANDIDATES, /(level|division|nivå)/);

  return rows.slice(1).map(r => ({
    team: (r[teamCol] || '').trim(),
    country: countryCol !== -1 ? (r[countryCol] || '').trim() : '',
    level:   levelCol   !== -1 ? (r[levelCol]   || '').trim() : '',
  }));
}

async function loadFromBackend() {
  const res = await fetch(`${API_BASE}${CONFIG.BACKEND_REG_PATH}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Backend fetch failed: ${res.status}`);
  const data = await res.json();
  const headers = data.headers || [];
  const rows = data.rows || [];
  if (!headers.length) return [];

  const teamCol    = detectIndex(headers, CONFIG.TEAM_COL_CANDIDATES, /(team|lag|club|klubb)/);
  if (teamCol === -1) throw new Error("Couldn't find a Team column.");
  const countryCol = detectIndex(headers, CONFIG.COUNTRY_COL_CANDIDATES, /(country|land|nation)/);
  const levelCol   = detectIndex(headers, CONFIG.LEVEL_COL_CANDIDATES, /(level|division|nivå)/);

  return rows.map(r => ({
    team: (r[teamCol] || '').trim(),
    country: countryCol !== -1 ? (r[countryCol] || '').trim() : '',
    level:   levelCol   !== -1 ? (r[levelCol]   || '').trim() : '',
  }));
}

async function loadTeamsAndRender() {
  setText($('#teamCount'), 'Loading registrations…');
  try {
    const items =
      CONFIG.MODE === 'api'     ? await loadFromAPI()     :
      CONFIG.MODE === 'backend' ? await loadFromBackend() :
                                  await loadFromCSV();
    renderTeamsList(items);
  } catch (err) {
    console.error(err);
    setText($('#teamCount'), 'Could not load registrations');
    const list = $('#teamList');
    if (list) {
      list.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'text-red-600';
      li.textContent = (err && err.message) ? err.message : 'Unknown error';
      list.appendChild(li);
    }
  }
}

/* =========== Photos: list & upload =========== */
async function listPhotos() {
  const grid = document.getElementById('photoGrid');
  const msg  = document.getElementById('photoMsg');
  if (!grid || !msg) return;

  grid.innerHTML = '';
  msg.textContent = 'Loading…';

  try {
    const res = await fetch(`${API_BASE}/photos`, { cache: 'no-store' });
    const txt = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${txt.slice(0,120)}`);

    let data;
    try { data = JSON.parse(txt); }
    catch { throw new Error(`Bad JSON: ${txt.slice(0,120)}`); }

    const photos = data.photos || [];
    photos.forEach(url => {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.className = 'block group';

      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Gothrow photo';
      img.loading = 'lazy';
      img.className = 'rounded shadow transition-transform group-hover:scale-[1.02] cursor-zoom-in';

      a.appendChild(img);
      grid.appendChild(a);
    });

    msg.textContent = photos.length ? '' : 'No photos yet.';
  } catch (e) {
    msg.textContent = `List failed: ${e.message || e}`;
  }
}

function initPhotoUpload() {
  const form  = document.getElementById('photoUpload');
  const fileEl= document.getElementById('photoFile');
  const msg   = document.getElementById('photoMsg');
  if (!form || !fileEl || !msg) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fileEl.files?.length) { msg.textContent = 'Choose an image'; return; }
    const fd = new FormData();
    fd.append('file', fileEl.files[0]); // field name must be 'file'
    msg.textContent = 'Uploading…';

    try {
      const res = await fetch(`${API_BASE}/photos`, { method: 'POST', body: fd });
      const txt = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${txt.slice(0,120)}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.detail || 'Upload failed');

      msg.textContent = 'Uploaded!';
      fileEl.value = '';
      await listPhotos();
    } catch (err) {
      msg.textContent = `Upload failed: ${err.message || err}`;
    }
  });
}

// === Payments CONFIG ===
// Set these values for your event
const PAY_CONFIG = {
  swishNumber: "1234597274",        // your Swish merchant/number
  amountSEK: 3500,                   // ticket/fee amount (SEK)
  message: "Gothrow-2026-TEAMNAME-", // what shows in the payment
  // Stripe (card) – publishable key is safe to embed in FE
  stripePublishableKey: "pk_live_xxx_or_pk_test_xxx",
};

// Swish deeplink builder
function buildSwishUrl({ number, amount, message }) {
  const params = new URLSearchParams({
    version: "1",
    payee: number,
    amount: String(amount),
    message,
  });
  return `swish://payment?${params.toString()}`;
}

// Render Swish QR + button
async function initSwishUI() {
  const { swishNumber, amountSEK, message } = PAY_CONFIG;
  const canvas = document.getElementById("swishQr");
  const btn = document.getElementById("openSwishBtn");
  const payeeEl = document.getElementById("swishPayee");
  const amountEl = document.getElementById("swishAmount");
  const msgEl = document.getElementById("swishMsg");
  if (!canvas || !btn) return;

  // Show labels
  if (payeeEl) payeeEl.textContent = swishNumber;
  if (amountEl) amountEl.textContent = amountSEK;
  if (msgEl) msgEl.textContent = message;

  const link = buildSwishUrl({ number: swishNumber, amount: amountSEK, message });

  // Generate QR that encodes the deeplink
  try {
    await QRCode.toCanvas(canvas, link, { width: 220, margin: 1 });
  } catch (e) {
    console.error("QR gen failed", e);
  }

  // Button tries to open Swish on mobile; on desktop it may do nothing
  btn.addEventListener("click", () => {
    window.location.href = link;
  });
}

// Stripe Checkout: call backend to create a session, then redirect
async function initCardButton() {
  const btn = document.getElementById("cardPayBtn");
  const msg = document.getElementById("cardPayMsg");
  if (!btn) return;

  // Load Stripe.js
  const stripe = window.Stripe
    ? window.Stripe(PAY_CONFIG.stripePublishableKey)
    : null;

  if (!stripe) {
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = () => initCardButton(); // try again once loaded
    document.head.appendChild(s);
    return;
  }

  btn.addEventListener("click", async () => {
    msg.textContent = "Preparing payment…";
    try {
      const res = await fetch(`${API_BASE}/pay/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_sek: PAY_CONFIG.amountSEK,
          description: PAY_CONFIG.message,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "Checkout create failed");

      const { sessionId } = json;
      const { error } = await stripe.redirectToCheckout({ sessionId });
      if (error) throw error;
    } catch (e) {
      msg.textContent = `Payment error: ${e.message || e}`;
    }
  });
}

// When Payments tab is shown, (re)init in case of SPA nav
function whenPaymentsShown(sectionId) {
  if (sectionId === "payments") {
    initSwishUI();
    initCardButton();
  }
}

// Also init once on load (if user lands on /#payments)
window.addEventListener("DOMContentLoaded", () => {
  initSwishUI();
  initCardButton();
});

/* ================== UI Wiring ================== */
window.addEventListener('DOMContentLoaded', () => {
  // Show About by default
  document.querySelectorAll('.main-section').forEach(section => {
    section.style.display = section.id === 'about' ? 'block' : 'none';
  });

  // Tabs
  document.querySelectorAll('.tab-nav a').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.tab-nav a').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const sectionId = tab.getAttribute('data-section');
      document.querySelectorAll('.main-section').forEach(section => {
        section.style.display = section.id === sectionId ? 'block' : 'none';
      });

      if (sectionId === 'teams')  loadTeamsAndRender();
      if (sectionId === 'photos') listPhotos();
    });
  });

  // Initial loads
  loadTeamsAndRender();
  initPhotoUpload();
  listPhotos();

  if (CONFIG.REFRESH_MS > 0) setInterval(loadTeamsAndRender, CONFIG.REFRESH_MS);
});

// Optional helper you already had
function changeBackground(url) {
  document.body.style.backgroundImage = `url('${url}')`;
}
