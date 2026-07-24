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
  // which optional modifier types are unlocked (points & quantity are always on)
  modUnlocked: { clue: true, xp: true, sup: true },
  // per-creature promotion rules: name -> { points|qty|clue|xp|sup: "tier"|"neutral"|"desired" }
  // (absent key = no effect)
  taskRules: {},
};

// rows expanded to show the per-task modifier editor (UI-only, not persisted)
const expanded = new Set();

const RULE_OPTS = [
  { v: "none", t: "—", title: "No effect on your verdict" },
  { v: "tier", t: "+1 tier", title: "Bad becomes neutral; neutral becomes desired" },
  { v: "neutral", t: "→ neutral", title: "A bad task becomes neutral" },
  { v: "desired", t: "→ desired", title: "Any task with this modifier becomes desired" },
];

// ————— persistence —————

function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && typeof s === "object") Object.assign(state, s);
  } catch (e) { /* fresh start */ }
  delete state.modRules; // pre-per-task-rules saves had a global rule set
  if (!state.taskRules || typeof state.taskRules !== "object") state.taskRules = {};
}

// ————— pool + math —————

function inPool(t) {
  return t.level <= state.level &&
    (t.name !== "Venators" || state.venators) &&
    !state.blocked.includes(t.name);
}

function labelOf(name) { return state.labels[name] || "neutral"; }

/* The modifier types that can land on this creature, with its own
 * rolled ranges (for the editor UI). */
function creatureModDefs(t) {
  const defs = [
    { key: "points", name: "Slayer points", range: `+${t.pts[0]}–${t.pts[1]} pts` },
    t.qty[0] < 0
      ? { key: "qty", name: "Fewer kills", range: `${t.qty[0]} to ${t.qty[1]}` }
      : { key: "qty", name: "More kills", range: `+${t.qty[0]}–${t.qty[1]}` },
  ];
  if (t.clue) defs.push({ key: "clue", name: "Clue scrolls", range: `+${t.clue[0]}–${t.clue[1]}%`, unlock: "clue" });
  defs.push({ key: "xp", name: "Slayer XP", range: `+${t.xp[0]}–${t.xp[1]}%`, unlock: "xp" });
  defs.push({ key: "sup", name: "Superior uniques", range: `+${t.sup[0]}–${t.sup[1]}%`, unlock: "sup" });
  return defs;
}

/* This creature's promotion rules: one entry per applicable unlocked
 * modifier type, each equally likely to roll. */
function creatureRules(t) {
  const r = state.taskRules[t.name] || {};
  return creatureModDefs(t)
    .filter(d => !d.unlock || state.modUnlocked[d.unlock])
    .map(d => r[d.key] || "none");
}

function computeOdds() {
  const pool = TASKS.filter(inPool);
  const entries = pool.map(t => {
    const { dProb, bProb } = MortimerMath.slotProbs(labelOf(t.name), creatureRules(t));
    return { name: t.name, weight: t.weight, dProb, bProb };
  });
  const odds = MortimerMath.computeOdds(entries, state.offers);
  return { ...odds, pool, slot: Object.fromEntries(entries.map(e => [e.name, e])) };
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

function editorHtml(t) {
  const tr = state.taskRules[t.name] || {};
  return `<div class="mods-editor" data-name="${t.name}">
    ${creatureModDefs(t).map(d => {
      const unlocked = !d.unlock || state.modUnlocked[d.unlock];
      const cur = tr[d.key] || "none";
      return `<div class="rm-row ${unlocked ? "" : "rm-off"}" data-modkey="${d.key}">
        <span class="rm-name">${d.name} <small>${d.range}</small>${unlocked ? "" : ' <small class="rm-lock">locked</small>'}</span>
        <div class="seg rm-seg" role="group" aria-label="${d.name} rule for ${t.name}">
          ${RULE_OPTS.map(o => `<button data-rule="${o.v}" title="${o.title}"
            class="${cur === o.v ? "on" : ""}" ${unlocked ? "" : "disabled"}>${o.t}</button>`).join("")}
        </div>
      </div>`;
    }).join("")}
  </div>`;
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
    // chips: chance the rolled modifier changes this creature's verdict
    let chips = "";
    const slot = odds.slot[t.name];
    if (slot && !blocked && !locked) {
      const baseD = label === "desired" ? 1 : 0;
      const baseB = label === "bad" ? 1 : 0;
      const parts = [];
      if (slot.dProb > 0 && baseD === 0)
        parts.push(`<span class="chip chip-d" title="Chance its modifier promotes it to desired">✓${Math.round(slot.dProb * 100)}%</span>`);
      if (baseB === 1 && slot.bProb < 1)
        parts.push(`<span class="chip chip-b" title="Chance it stays bad after its modifier">✗${Math.round(slot.bProb * 100)}%</span>`);
      if (parts.length) chips = `<div class="r-chips">${parts.join("")}</div>`;
    }
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
      <div class="r-offered ${blocked || locked ? "na" : ""}">${offered}${chips}</div>
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
        <button class="gear ${expanded.has(t.name) ? "open" : ""} ${state.taskRules[t.name] ? "set" : ""}"
          data-act="mods" aria-expanded="${expanded.has(t.name)}"
          title="Which of this task's modifiers promote it">⚙</button>
      </div>
    </div>` + (expanded.has(t.name) ? editorHtml(t) : "");
  });
  $("rows").innerHTML = rows.join("");
}

function renderResults(o) {
  const { pDesired: pD, pAllBad: pB, pNeutral: pN, pool, k } = o;
  const nDesired = pool.filter(t => labelOf(t.name) === "desired").length;
  const nBad = pool.filter(t => labelOf(t.name) === "bad").length;
  const nNeutral = pool.length - nDesired - nBad;

  const rulesActive = Object.keys(state.taskRules).length > 0;
  $("hero-num").textContent = (nDesired || pD > 0) ? pct(pD) : "—";
  $("hero-foot").textContent = (nDesired || pD > 0)
    ? `${nDesired} desired of ${pool.length} in pool · ${k} offered per roll${rulesActive ? " · Mortifier rules applied" : ""}`
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
  document.querySelectorAll("#unlock-seg button").forEach(b => {
    const on = state.modUnlocked[b.dataset.unlock];
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
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
  const holder = e.target.closest("[data-name]");
  if (!holder) return;
  const name = holder.dataset.name;
  if (btn.dataset.rule && holder.classList.contains("mods-editor")) {
    const key = btn.closest(".rm-row").dataset.modkey;
    const tr = state.taskRules[name] || (state.taskRules[name] = {});
    if (btn.dataset.rule === "none") delete tr[key];
    else tr[key] = btn.dataset.rule;
    if (!Object.keys(tr).length) delete state.taskRules[name];
    refresh();
    return;
  }
  const act = btn.dataset.act;
  if (act === "mods") {
    if (expanded.has(name)) expanded.delete(name);
    else expanded.add(name);
    refresh();
  } else if (act === "block") {
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

$("unlock-seg").addEventListener("click", e => {
  const b = e.target.closest("button[data-unlock]");
  if (!b) return;
  state.modUnlocked[b.dataset.unlock] = !state.modUnlocked[b.dataset.unlock];
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
  state.taskRules = {};
  expanded.clear();
  refresh();
});

load();
refresh();
