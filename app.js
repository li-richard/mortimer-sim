/* Mortimer's Ledger — UI layer. All probability math lives in math.js
 * (exact enumeration, no simulation) and is covered by test/math-test.js. */

const LS_KEY = "mortimer-ledger-v1";
const SKIP_COST = 100;
const BLOCK_COST = 120;
const MAX_BLOCKS = 2;

const state = {
  level: 99,
  offers: 3,
  venators: true,
  labels: {},   // name -> "desired" | "bad"  (absent = neutral)
  blocked: [],  // names, max 2
};

// ————— persistence —————

function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && typeof s === "object") Object.assign(state, s);
  } catch (e) { /* fresh start */ }
}

// ————— pool + math —————

function inPool(t) {
  return t.level <= state.level &&
    (t.name !== "Venators" || state.venators) &&
    !state.blocked.includes(t.name);
}

function labelOf(name) { return state.labels[name] || "neutral"; }

function computeOdds() {
  const pool = TASKS.filter(inPool);
  const odds = MortimerMath.computeOdds(
    pool.map(t => ({ name: t.name, weight: t.weight, label: labelOf(t.name) })),
    state.offers);
  return { ...odds, pool };
}

// ————— formatting —————

const pct = x => (x * 100).toFixed(1) + "%";
const pct0 = x => (x * 100).toFixed(0) + "%";

// ————— rendering —————

const $ = id => document.getElementById(id);

function detailLine(t) {
  const qty = t.qty[0] < 0
    ? `qty ${t.qty[0]} to ${t.qty[1]}`
    : `qty +${t.qty[0]}–${t.qty[1]}`;
  const bits = [
    `assign ${t.assignMin}–${t.assignMax}${t.extendable ? " ext" : ""}`,
    qty,
    `pts +${t.pts[0]}–${t.pts[1]}`,
    `xp +${t.xp[0]}–${t.xp[1]}%`,
    `sup +${t.sup[0]}–${t.sup[1]}%`,
  ];
  if (t.clue) bits.push(`clue +${t.clue[0]}–${t.clue[1]}%`);
  return bits.join('<span class="sep">·</span>');
}

function renderRows(odds) {
  const rows = TASKS.map(t => {
    const label = labelOf(t.name);
    const blocked = state.blocked.includes(t.name);
    const tooHigh = t.level > state.level;
    const noQuest = t.name === "Venators" && !state.venators;
    const locked = tooHigh || noQuest;
    const p = odds.appear[t.name];
    const cls = ["row",
      locked ? "locked" : "",
      blocked ? "is-blocked" : label === "desired" ? "is-desired" : label === "bad" ? "is-bad" : "",
    ].join(" ");
    const offered = blocked ? "blocked"
      : locked ? (tooHigh ? `lvl ${t.level}` : "quest")
      : p !== undefined ? pct(p) : "—";
    return `
    <div class="${cls}" data-name="${t.name}">
      <div class="r-name">
        <div class="r-title">
          <b>${t.name}</b>
          <span class="r-lvl">${t.level}</span>
          ${t.weight === 8 ? '<span class="r-w8" title="Reduced weighting: 8 instead of 10">w8</span>' : ""}
        </div>
        <div class="r-detail">${detailLine(t)}</div>
      </div>
      <div class="r-offered ${blocked || locked ? "na" : ""}">${offered}</div>
      <div class="r-verdict">
        <div class="tri" role="group" aria-label="Verdict for ${t.name}">
          <button class="t-desired ${label === "desired" ? "on" : ""}" data-act="desired" aria-pressed="${label === "desired"}">✓ Desired</button>
          <button class="t-neutral ${label === "neutral" ? "on" : ""}" data-act="neutral" aria-pressed="${label === "neutral"}">·</button>
          <button class="t-bad ${label === "bad" ? "on" : ""}" data-act="bad" aria-pressed="${label === "bad"}">✗ Bad</button>
        </div>
        <button class="blk ${blocked ? "on" : ""}" data-act="block" aria-pressed="${blocked}"
          ${!blocked && state.blocked.length >= MAX_BLOCKS ? "disabled" : ""}
          title="Blocks remove the creature from Mortimer's pool — ${BLOCK_COST} pts each, max ${MAX_BLOCKS}">
          ${blocked ? "⛨ Blocked" : "⛨"}
        </button>
      </div>
    </div>`;
  });
  $("rows").innerHTML = rows.join("");
}

function renderResults(o) {
  const { pDesired: pD, pAllBad: pB, pNeutral: pN, pool, k } = o;
  const nDesired = pool.filter(t => labelOf(t.name) === "desired").length;
  const nBad = pool.filter(t => labelOf(t.name) === "bad").length;
  const nNeutral = pool.length - nDesired - nBad;

  $("hero-num").textContent = nDesired ? pct(pD) : "—";
  $("hero-foot").textContent = nDesired
    ? `${nDesired} desired of ${pool.length} in pool · ${k} offered per roll`
    : `label some creatures “✓ Desired” to see your odds · ${pool.length} in pool`;

  // stacked outcome bar (2px gaps come from the flex gap)
  const segs = [
    { cls: "seg-d", p: pD, name: "Has a desired task", col: "var(--desired)" },
    { cls: "seg-n", p: pN, name: "Neutral at best", col: "var(--neutral)" },
    { cls: "seg-b", p: pB, name: "All offers bad", col: "var(--bad)" },
  ];
  $("bar").innerHTML = segs
    .filter(s => s.p > 0.0005)
    .map(s => `<div class="${s.cls}" style="flex-grow:${(s.p * 1000).toFixed(0)}" title="${s.name}: ${pct(s.p)}"></div>`)
    .join("");
  $("legend").innerHTML = segs
    .map(s => `<li><span class="swatch" style="background:${s.col}"></span>${s.name}<span class="val">${pct(s.p)}</span></li>`)
    .join("");

  const st = MortimerMath.strategyStats(o, SKIP_COST);
  $("t-allbad").textContent = nBad ? pct(pB) : "0%";
  $("t-rolls").textContent = pD > 0 ? st.offersPerDesired.toFixed(1) : "—";
  $("t-skipcost").textContent = pD > 0 ? Math.round(st.skipUntilDesiredCost) + " pts" : "—";
  $("t-patient").textContent = (pD + pN) > 0 ? pct0(st.patientDesiredShare) : "—";

  const blockSpend = state.blocked.length * BLOCK_COST;
  const skipsPerTask = st.patientSkipsPerTask;
  $("fine").innerHTML = [
    `<b>${nDesired}</b> desired · <b>${nNeutral}</b> neutral · <b>${nBad}</b> bad · <b>${state.blocked.length}</b>/${MAX_BLOCKS} blocked${blockSpend ? ` (${blockSpend} pts)` : ""}.`,
    nBad ? `Skipping only all-bad offers costs ≈ <b>${Number.isFinite(skipsPerTask) ? Math.round(skipsPerTask * SKIP_COST) : "∞"} pts</b> per completed task (${(skipsPerTask * 100).toFixed(1)} skips per 100 tasks).` : "",
    `Each offer roll is independent; “offers per desired task” is the mean of a geometric distribution, 1∕p.`,
  ].filter(Boolean).join(" ");
}

function renderControls() {
  $("level").value = state.level;
  document.querySelectorAll("#offers-seg button").forEach(b =>
    b.classList.toggle("on", Number(b.dataset.offers) === state.offers));
  const v = $("venators");
  v.classList.toggle("on", state.venators);
  v.setAttribute("aria-pressed", String(state.venators));
  v.textContent = state.venators ? "Blood Moon Rises ✓" : "Blood Moon Rises ✗";
}

function refresh() {
  const odds = computeOdds();
  renderRows(odds);
  renderResults(odds);
  renderControls();
  save();
}

// ————— events —————

$("rows").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const name = e.target.closest(".row").dataset.name;
  const act = btn.dataset.act;
  if (act === "block") {
    if (state.blocked.includes(name)) state.blocked = state.blocked.filter(n => n !== name);
    else if (state.blocked.length < MAX_BLOCKS) state.blocked.push(name);
  } else if (act === "desired" || act === "bad") {
    state.labels[name] = labelOf(name) === act ? undefined : act;
    if (!state.labels[name]) delete state.labels[name];
  } else if (act === "neutral") {
    delete state.labels[name];
  }
  refresh();
});

$("level").addEventListener("change", e => {
  state.level = Math.max(1, Math.min(99, Number(e.target.value) || 99));
  refresh();
});

$("offers-seg").addEventListener("click", e => {
  const b = e.target.closest("button[data-offers]");
  if (!b) return;
  state.offers = Number(b.dataset.offers);
  refresh();
});

$("venators").addEventListener("click", () => {
  state.venators = !state.venators;
  refresh();
});

$("reset").addEventListener("click", () => {
  state.labels = {};
  state.blocked = [];
  refresh();
});

load();
refresh();
