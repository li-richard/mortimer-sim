/* Mortimer's Ledger — UI layer. All probability math lives in math.js
 * (exact enumeration, no simulation) and is covered by test/math-test.js.
 *
 * Tiers are purely ordinal: index 0 is the best tier, and every number
 * in the results card is relative to the tier you focus. */

const LS_KEY = "mortimer-ledger-v1";
const SKIP_COST = 100;
const BLOCK_COST = 120;
const MAX_BLOCKS = 2;

function defaultTiers() {
  return [
    { id: "t1", name: "Desired" },
    { id: "t2", name: "Neutral" },
    { id: "t3", name: "Bad" },
  ];
}

/* Mortimer's progression is automatic, not opt-in: modifier types and the
 * third task choice unlock at fixed task counts (blog, 24 Jul 2026). */
const UNLOCKS = [
  { key: "clue", at: 25, name: "Clue" },
  { key: "xp", at: 50, name: "XP" },
  { key: "sup", at: 75, name: "Superior" },
];
const THIRD_CHOICE_AT = 100;

/* The progression breakpoints, in order. */
const PROG = [
  { at: 0, gain: "Points + Quantity", note: "Mortimer starts you with these two modifiers" },
  { at: 25, gain: "Clue scrolls", note: "Clue Scroll modifier unlocks at 25 tasks" },
  { at: 50, gain: "Slayer XP", note: "Slayer XP modifier unlocks at 50 tasks" },
  { at: 75, gain: "Superior uniques", note: "Superior drop-rate modifier unlocks at 75 tasks" },
  { at: 100, gain: "Third choice", note: "A third task choice unlocks at 100 tasks" },
];

const state = {
  level: 99,
  tasksDone: 100,
  venators: true,
  blocked: [],  // names, max 2
  // ordered tier list, index 0 = best
  tiers: defaultTiers(),
  tierSeq: 3,
  // creature name -> tier id; every creature is always placed (default: middle tier)
  placement: {},
  // tier id -> ordered creature names (manual ordering within a tier)
  tierOrder: {},
  // per-creature modifier rules: name -> { points|qty|clue|xp|sup: "up"|"down"|"to:<tierId>" }
  taskRules: {},
  // the tier the hero number measures
  focusTier: "t1",
};

// UI-only state, not persisted
let selectedName = null;
let dragName = null;
let dragTier = null;

// ————— persistence + migration —————

function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { /* fresh start */ }
  if (s && typeof s === "object") {
    const labels = s.labels; // pre-tier-board saves labeled creatures directly
    delete s.labels;
    delete s.modRules;
    // pre-progression saves toggled unlocks by hand; infer a task count
    if (s.tasksDone === undefined) {
      const u = s.modUnlocked || {};
      s.tasksDone = s.offers === 3 ? 100 : u.sup ? 75 : u.xp ? 50 : u.clue ? 25 : 0;
    }
    delete s.modUnlocked;
    delete s.offers;
    Object.assign(state, s);
    if (!Array.isArray(state.tiers) || !state.tiers.length) state.tiers = defaultTiers();
    // classes on tiers are gone — order alone carries meaning now
    state.tiers = state.tiers.map(t => ({ id: t.id, name: t.name }));
    if (!state.placement || typeof state.placement !== "object") state.placement = {};
    if (!state.taskRules || typeof state.taskRules !== "object") state.taskRules = {};
    if (labels && typeof labels === "object") {
      for (const [name, lab] of Object.entries(labels)) {
        if (lab === "desired") state.placement[name] = state.tiers[0].id;
        else if (lab === "bad") state.placement[name] = state.tiers[state.tiers.length - 1].id;
      }
    }
    // migrate the pre-tier rule vocabulary to tier operations
    for (const [name, rules] of Object.entries(state.taskRules)) {
      for (const [k, v] of Object.entries(rules)) {
        if (v === "tier") rules[k] = "up";
        else if (v === "neutral") rules[k] = "to:" + defaultTierId();
        else if (v === "desired") rules[k] = "to:" + state.tiers[0].id;
        if (rules[k] === "none") delete rules[k];
      }
      if (!Object.keys(rules).length) delete state.taskRules[name];
    }
  }
  ensurePlacements();
}

/* Every creature always sits in a tier; the default home is the middle one. */
function defaultTierId() {
  return state.tiers[Math.floor((state.tiers.length - 1) / 2)].id;
}

function ensurePlacements() {
  const def = defaultTierId();
  for (const t of TASKS) {
    const id = state.placement[t.name];
    if (!id || !state.tiers.some(x => x.id === id)) state.placement[t.name] = def;
  }
  syncOrder();
}

/* Keep tierOrder consistent with placement: preserve manual order,
 * drop stale names, append new members in data order. */
function syncOrder() {
  if (!state.tierOrder || typeof state.tierOrder !== "object") state.tierOrder = {};
  const members = {};
  for (const t of TASKS) (members[state.placement[t.name]] = members[state.placement[t.name]] || new Set()).add(t.name);
  const next = {};
  for (const tier of state.tiers) {
    const mine = members[tier.id] || new Set();
    const kept = (state.tierOrder[tier.id] || []).filter(n => mine.has(n));
    const seen = new Set(kept);
    for (const t of TASKS) if (mine.has(t.name) && !seen.has(t.name)) kept.push(t.name);
    next[tier.id] = kept;
  }
  state.tierOrder = next;
}

// ————— progression (derived from tasks completed) —————

const modUnlocked = key => {
  const u = UNLOCKS.find(x => x.key === key);
  return !u || state.tasksDone >= u.at;
};
const offerCount = () => (state.tasksDone >= THIRD_CHOICE_AT ? 3 : 2);

// ————— pool + tiers —————

function inPool(t) {
  return t.level <= state.level &&
    (t.name !== "Venators" || state.venators) &&
    !state.blocked.includes(t.name);
}

function tierIndexOf(name) {
  const i = state.tiers.findIndex(t => t.id === state.placement[name]);
  return i === -1 ? null : i;
}

/* Rank color: green (best) through stone to red (worst). */
function tierColor(i, n) {
  const stops = [[12, 163, 12], [139, 128, 113], [208, 59, 59]];
  if (n <= 1) return `rgb(${stops[0].join(",")})`;
  const t = i / (n - 1);
  const [a, b, u] = t < 0.5 ? [stops[0], stops[1], t * 2] : [stops[1], stops[2], (t - 0.5) * 2];
  const mix = a.map((x, j) => Math.round(x + (b[j] - x) * u));
  return `rgb(${mix.join(",")})`;
}

/* The modifier types that can land on this creature, with its own
 * rolled ranges (for the popover UI). */
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

/* "up" | "down" stay symbolic; "to:<tierId>" resolves to a tier index. */
function normRule(v) {
  if (!v || v === "none") return "none";
  if (v === "up" || v === "down") return v;
  if (v.startsWith("to:")) {
    const idx = state.tiers.findIndex(t => t.id === v.slice(3));
    return idx === -1 ? "none" : idx;
  }
  return "none";
}

/* Tier index this creature ends up at under each of its applicable
 * unlocked modifiers (each equally likely to roll). */
function slotTierIdxs(t) {
  const baseIdx = tierIndexOf(t.name);
  const r = state.taskRules[t.name] || {};
  return creatureModDefs(t)
    .filter(d => modUnlocked(d.unlock))
    .map(d => MortimerMath.resolveTier(baseIdx, normRule(r[d.key]), state.tiers.length));
}

function computeOdds() {
  const pool = TASKS.filter(inPool);
  const m = state.tiers.length;
  const entries = pool.map(t => {
    const idxs = slotTierIdxs(t);
    const tierProbs = new Array(m).fill(0);
    for (const i of idxs) if (i !== null) tierProbs[i] += 1 / idxs.length;
    return { name: t.name, weight: t.weight, tierProbs };
  });
  const odds = MortimerMath.computeOdds(entries, offerCount());
  return { ...odds, pool, slot: Object.fromEntries(entries.map(e => [e.name, e])) };
}

// ————— formatting —————

const pct = x => (x * 100).toFixed(1) + "%";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ————— rendering —————

const $ = id => document.getElementById(id);
const TASK_BY_NAME = Object.fromEntries(TASKS.map(t => [t.name, t]));

/* Rules that actually apply (their modifier type is unlocked), as
 * { def, rule, targetIdx } plus the up/down chances they produce. */
function activeRules(t) {
  const tr = state.taskRules[t.name] || {};
  const baseIdx = tierIndexOf(t.name);
  const defs = creatureModDefs(t).filter(d => modUnlocked(d.unlock));
  const rules = defs
    .map(d => ({ def: d, raw: tr[d.key] }))
    .filter(r => r.raw && r.raw !== "none")
    .map(r => ({ ...r, idx: MortimerMath.resolveTier(baseIdx, normRule(r.raw), state.tiers.length) }))
    .filter(r => r.idx !== baseIdx);
  const n = defs.length || 1;
  return {
    rules,
    up: rules.filter(r => r.idx < baseIdx).length / n,
    down: rules.filter(r => r.idx > baseIdx).length / n,
  };
}

function ruleLabel(raw) {
  if (raw === "up") return "▲ up one tier";
  if (raw === "down") return "▼ down one tier";
  const tier = state.tiers.find(x => "to:" + x.id === raw);
  return tier ? "→ " + tier.name : raw;
}

function chipHtml(t, odds) {
  const blocked = state.blocked.includes(t.name);
  const tooHigh = t.level > state.level;
  const noQuest = t.name === "Venators" && !state.venators;
  const p = odds.appear[t.name];
  const off = blocked ? "⛨"
    : tooHigh ? `lvl ${t.level}`
    : noQuest ? "quest"
    : p !== undefined ? pct(p) : "—";
  const note = blocked ? " · blocked" : tooHigh ? ` · needs ${t.level} Slayer` : noQuest ? " · needs Blood Moon Rises" : "";
  const { rules, up, down } = activeRules(t);
  const marks = [
    up > 0 ? `<span class="c-mv c-up">▲${Math.round(up * 100)}</span>` : "",
    down > 0 ? `<span class="c-mv c-down">▼${Math.round(down * 100)}</span>` : "",
  ].join("");
  const ruleNote = rules.length
    ? "\n" + rules.map(r => `${r.def.name}: ${ruleLabel(r.raw)}`).join("\n")
    : "";
  return `<div class="crea ${blocked ? "c-blocked" : ""} ${tooHigh || noQuest ? "c-locked" : ""}
      ${selectedName === t.name ? "c-sel" : ""} ${rules.length ? "c-rules" : ""}"
    draggable="true" data-name="${t.name}"
    title="${t.name} · lvl ${t.level}${t.weight === 8 ? " · weight 8" : ""}${note}${ruleNote}
— click to configure, drag to re-tier">
    ${t.name}<small>${t.level}</small><span class="c-off">${off}</span>${marks}</div>`;
}

/* Custom listbox — a native <select> can't have its popup list styled
 * (the OS draws it), so the card uses this instead.
 * opts: [{ val, label }]; `kind` is "tier" or "rule". */
function selectHtml(kind, value, opts, label, disabled) {
  const cur = opts.find(o => o.val === value) || opts[0];
  return `<div class="sel ${disabled ? "sel-off" : ""}" data-sel="${kind}">
    <button type="button" class="sel-btn" aria-haspopup="listbox" aria-expanded="false"
      aria-label="${esc(label)}" ${disabled ? "disabled" : ""}>
      <span class="sel-val">${esc(cur.label)}</span><span class="sel-caret">▾</span>
    </button>
    <ul class="sel-menu" role="listbox" aria-label="${esc(label)}" hidden>
      ${opts.map(o => `<li role="option" tabindex="-1" data-val="${esc(o.val)}"
        aria-selected="${o.val === value}" class="${o.val === value ? "on" : ""}">
        <span class="sel-tick">${o.val === value ? "✓" : ""}</span>${esc(o.label)}</li>`).join("")}
    </ul>
  </div>`;
}

function popoverHtml(t, odds) {
  const blocked = state.blocked.includes(t.name);
  const tooHigh = t.level > state.level;
  const noQuest = t.name === "Venators" && !state.venators;
  const p = odds.appear[t.name];
  const off = blocked ? "blocked"
    : tooHigh ? `needs ${t.level} Slayer`
    : noQuest ? "needs Blood Moon Rises"
    : p !== undefined ? pct(p) + " offered" : "";
  // chance its rolled modifier moves it to a better / worse tier
  const { up, down } = activeRules(t);
  const chips = [
    up > 0 ? `<span class="chip chip-d" title="Chance its modifier lands it in a better tier">▲${Math.round(up * 100)}%</span>` : "",
    down > 0 ? `<span class="chip chip-b" title="Chance its modifier lands it in a worse tier">▼${Math.round(down * 100)}%</span>` : "",
  ].join("");
  const tr = state.taskRules[t.name] || {};
  const curTier = state.tiers[tierIndexOf(t.name)];
  const ruleOpts = [
    { val: "none", label: "no effect" },
    { val: "up", label: "▲ up one tier" },
    { val: "down", label: "▼ down one tier" },
    ...state.tiers.map(x => ({ val: "to:" + x.id, label: "→ " + x.name })),
  ];
  return `<div class="pop-caret"></div>
    <div class="ce-head">
      <b>${t.name}</b>
      <span class="r-lvl">lvl ${t.level}</span>
      ${t.weight === 8 ? '<span class="r-w8" title="Reduced weighting: 8 instead of 10">w8</span>' : ""}
      <span class="pop-off">${off}</span>
      ${chips}
      <button class="blk ${blocked ? "on" : ""}" data-act="block" aria-pressed="${blocked}"
        ${!blocked && state.blocked.length >= MAX_BLOCKS ? "disabled" : ""}
        title="Blocks remove the creature from Mortimer's pool — ${BLOCK_COST} pts each, max ${MAX_BLOCKS}">
        ${blocked ? "⛨ Blocked" : "⛨ Block"}
      </button>
      <button class="ce-close" data-act="close" title="Close">✕</button>
    </div>
    <div class="pop-sub">
      <span class="pop-tier" title="Drag the chip to another tier to change this">in ${esc(curTier ? curTier.name : "—")}</span>
      · assign ${t.assignMin}–${t.assignMax}${t.extendable ? " · extendable" : ""} · weighting ${t.weight}
    </div>
    <div class="pop-rows">
      ${creatureModDefs(t).map(d => {
        const unlocked = modUnlocked(d.unlock);
        return `<div class="rm-row ${unlocked ? "" : "rm-off"}" data-modkey="${d.key}">
          <span class="rm-name">${d.name} <small>${d.range}</small>${unlocked ? "" : ' <small class="rm-lock">locked</small>'}</span>
          ${selectHtml("rule", tr[d.key] || "none", ruleOpts, `${d.name} rule for ${t.name}`, !unlocked)}
        </div>`;
      }).join("")}
    </div>`;
}

function positionPopover() {
  const pop = $("popover");
  if (pop.hidden || !selectedName) return;
  const chip = document.querySelector(`.crea[data-name="${CSS.escape(selectedName)}"]`);
  if (!chip) { pop.hidden = true; return; }
  const r = chip.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const margin = 9;
  let left = r.left + window.scrollX;
  left = Math.min(left, window.scrollX + document.documentElement.clientWidth - pw - 12);
  left = Math.max(left, window.scrollX + 12);
  const below = (window.innerHeight - r.bottom > ph + margin + 6) || (r.top < ph + margin + 6);
  const top = below ? r.bottom + window.scrollY + margin : r.top + window.scrollY - ph - margin;
  pop.style.left = left + "px";
  pop.style.top = top + "px";
  pop.classList.toggle("pop-above", !below);
  const caret = pop.querySelector(".pop-caret");
  if (caret) {
    const cx = r.left + window.scrollX + r.width / 2 - left;
    caret.style.left = Math.max(16, Math.min(pw - 16, cx)) + "px";
  }
}

function renderPopover(odds) {
  const pop = $("popover");
  const t = selectedName ? TASK_BY_NAME[selectedName] : null;
  if (!t) { pop.hidden = true; pop.innerHTML = ""; return; }
  pop.innerHTML = popoverHtml(t, odds);
  pop.hidden = false;
  positionPopover();
}

function renderTiers(odds) {
  const n = state.tiers.length;
  $("tiers").innerHTML = state.tiers.map((tier, i) => {
    const members = (state.tierOrder[tier.id] || []).map(x => TASK_BY_NAME[x]).filter(Boolean);
    return `
    <div class="tier" data-tier="${tier.id}">
      <div class="tier-side" style="box-shadow: inset 3px 0 0 ${tierColor(i, n)}">
        <span class="tier-grip" draggable="true" title="Drag to reorder this tier">⠿</span>
        <div class="tier-side-main">
          <input class="tier-name" value="${esc(tier.name)}" aria-label="Tier name" maxlength="24">
          <span class="tier-odds" title="Chance the next offer contains at least one task that ends up in this tier (after modifiers)">${odds.tierHit ? pct(odds.tierHit[i]) : "—"} of offers</span>
        </div>
        <div class="tier-tools">
          <button data-tact="up" title="Move tier up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button data-tact="down" title="Move tier down" ${i === n - 1 ? "disabled" : ""}>↓</button>
          <button data-tact="del" title="Delete tier (its creatures move to the middle tier)" ${n <= 1 ? "disabled" : ""}>✕</button>
        </div>
      </div>
      <div class="tier-drop" data-drop="${tier.id}">${members.map(t => chipHtml(t, odds)).join("")}</div>
    </div>`;
  }).join("");
}

function renderResults(o) {
  const { pool, k } = o;
  const m = state.tiers.length;
  const rulesActive = Object.keys(state.taskRules).length > 0;

  // hero focus: one of the actual tiers
  if (!state.tiers.some(t => t.id === state.focusTier)) state.focusTier = state.tiers[0].id;
  const focusSel = $("focus-tier");
  focusSel.innerHTML =
    state.tiers.map(t => `<option value="${t.id}">a “${esc(t.name)}” task</option>`).join("");
  focusSel.value = state.focusTier;
  const fIdx = state.tiers.findIndex(t => t.id === state.focusTier);
  focusSel.style.color = tierColor(fIdx, m);
  const pFocus = o.tierHit ? o.tierHit[fIdx] : 0;
  const pOrBetter = o.tierGE ? 1 - o.tierGE[fIdx + 1] : 0;
  const pNothing = o.tierGE ? o.tierGE[fIdx + 1] : 0;

  $("hero-num").textContent = pool.length ? pct(pFocus) : "—";
  $("hero-foot").textContent = pool.length
    ? `this tier or better: ${pct(pOrBetter)} · ${k} offered per roll${rulesActive ? " · rules applied" : ""}`
    : "no creatures in the pool";

  // stacked bar: distribution of the best tier on offer (2px gaps from flex gap)
  const segs = state.tiers.map((t, j) => ({
    name: t.name,
    p: o.bestTier ? o.bestTier[j] : 0,
    col: tierColor(j, m),
  }));
  $("bar").innerHTML = segs
    .filter(s => s.p > 0.0005)
    .map(s => `<div style="flex-grow:${(s.p * 1000).toFixed(0)};background:${s.col}" title="Best task on offer is “${esc(s.name)}”: ${pct(s.p)}"></div>`)
    .join("");
  $("legend").innerHTML = segs
    .map(s => `<li><span class="swatch" style="background:${s.col}"></span>${esc(s.name)}<span class="val">${pct(s.p)}</span></li>`)
    .join("");

  $("t-nothing").textContent = pool.length ? pct(pNothing) : "—";
  $("t-rolls").textContent = pFocus > 0 ? (1 / pFocus).toFixed(1) : "—";
  $("t-skipcost").textContent = pFocus > 0 ? Math.round(SKIP_COST * (1 - pFocus) / pFocus) + " pts" : "—";
  $("t-best").textContent = o.bestTier ? pct(o.bestTier[fIdx]) : "—";

  const blockSpend = state.blocked.length * BLOCK_COST;
  const focusName = state.tiers[fIdx].name;
  // pOrBetter of 0 means the tier is unreachable — skipping never ends,
  // so there is no finite cost to quote
  const skipsPerKept = pOrBetter > 0 ? pNothing / pOrBetter : Infinity;
  $("fine").innerHTML = [
    `<b>${pool.length}</b> creatures in the pool · <b>${state.blocked.length}</b>/${MAX_BLOCKS} blocked${blockSpend ? ` (${blockSpend} pts)` : ""}.`,
    pOrBetter === 0
      ? `Nothing can reach “${esc(focusName)}” — no creature sits there and no modifier rule moves one in, so holding out for it never pays off.`
      : pNothing > 0
        ? `Skipping every offer with nothing “${esc(focusName)}”-or-better costs ≈ <b>${Math.round(skipsPerKept * SKIP_COST).toLocaleString()} pts</b> per kept offer (${skipsPerKept.toFixed(1)} skips per kept offer).`
        : `Every offer already contains “${esc(focusName)}” or better — no skipping needed.`,
    `Each offer roll is independent; “offers until one appears” is the mean of a geometric distribution, 1∕p.`,
  ].filter(Boolean).join(" ");
}

function renderControls() {
  $("level").value = state.level;
  const v = $("venators");
  v.classList.toggle("on", state.venators);
  v.setAttribute("aria-pressed", String(state.venators));
  v.textContent = state.venators ? "Blood Moon Rises ✓" : "Blood Moon Rises ✗";
  // progression stepper: everything up to the chosen breakpoint is unlocked
  const cur = PROG.filter(s => state.tasksDone >= s.at).pop() || PROG[0];
  $("steps").innerHTML = PROG.map(s => {
    const on = state.tasksDone >= s.at;
    return `<button data-at="${s.at}" class="step ${on ? "on" : ""} ${s === cur ? "cur" : ""}"
      aria-pressed="${s === cur}" title="${esc(s.note)}">
      <span class="st-n">${s.at}${s.at === THIRD_CHOICE_AT ? "+" : ""}</span>
      <span class="st-u">${esc(s.gain)}</span>
    </button>`;
  }).join("");
}

function refresh() {
  ensurePlacements();
  const odds = computeOdds();
  renderTiers(odds);
  renderPopover(odds);
  renderResults(odds);
  renderControls();
  save();
}

// ————— drag & drop: chips —————

const tiersEl = $("tiers");

/* Insertion position for a drop at (x, y) among the zone's chips,
 * reading order (wrapped flex rows): before the first chip whose row
 * is below the point, or whose center is right of it in the same row. */
function insertionIndex(zone, x, y, excludeName) {
  const chips = [...zone.querySelectorAll(".crea")].filter(c => c.dataset.name !== excludeName);
  for (let i = 0; i < chips.length; i++) {
    const r = chips[i].getBoundingClientRect();
    if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return i;
  }
  return chips.length;
}

/* The insertion-boundary marker shown while dragging a chip. */
function showDropMarker(zone, x, y, excludeName) {
  let m = document.getElementById("drop-marker");
  if (!m) {
    m = document.createElement("div");
    m.id = "drop-marker";
  }
  const idx = insertionIndex(zone, x, y, excludeName);
  const chips = [...zone.querySelectorAll(".crea")].filter(c => c.dataset.name !== excludeName);
  const zr = zone.getBoundingClientRect();
  let left, top, height;
  if (!chips.length) {
    left = 6; top = 7; height = 26;
  } else if (idx < chips.length) {
    const r = chips[idx].getBoundingClientRect();
    left = r.left - zr.left - 4; top = r.top - zr.top; height = r.height;
  } else {
    const r = chips[chips.length - 1].getBoundingClientRect();
    left = r.right - zr.left + 2; top = r.top - zr.top; height = r.height;
  }
  m.style.left = left + "px";
  m.style.top = top + "px";
  m.style.height = height + "px";
  if (m.parentElement !== zone) zone.appendChild(m);
}

function hideDropMarker() {
  document.getElementById("drop-marker")?.remove();
}

// ————— drag & drop: tier rows —————

function tierInsertionIndex(y) {
  const rows = [...tiersEl.querySelectorAll(".tier")];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) return i;
  }
  return rows.length;
}

function showTierMarker(y) {
  let m = document.getElementById("tier-marker");
  if (!m) {
    m = document.createElement("div");
    m.id = "tier-marker";
  }
  const rows = [...tiersEl.querySelectorAll(".tier")];
  if (!rows.length) return;
  const idx = tierInsertionIndex(y);
  const cr = tiersEl.getBoundingClientRect();
  const top = idx < rows.length
    ? rows[idx].getBoundingClientRect().top - cr.top - 1
    : rows[rows.length - 1].getBoundingClientRect().bottom - cr.top - 1;
  m.style.top = top + "px";
  if (m.parentElement !== tiersEl) tiersEl.appendChild(m);
}

function hideTierMarker() {
  document.getElementById("tier-marker")?.remove();
}

// ————— drag events —————

tiersEl.addEventListener("dragstart", e => {
  const grip = e.target.closest(".tier-grip");
  if (grip) {
    dragTier = grip.closest(".tier").dataset.tier;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "tier:" + dragTier);
    grip.closest(".tier").classList.add("dragging");
    return;
  }
  const chip = e.target.closest(".crea");
  if (!chip) return;
  dragName = chip.dataset.name;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragName);
  chip.classList.add("dragging");
});

tiersEl.addEventListener("dragend", () => {
  dragName = null;
  dragTier = null;
  hideDropMarker();
  hideTierMarker();
  document.querySelectorAll(".drag-over, .dragging").forEach(x => x.classList.remove("drag-over", "dragging"));
});

tiersEl.addEventListener("dragover", e => {
  if (dragTier) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    showTierMarker(e.clientY);
    return;
  }
  if (!dragName) return;
  const zone = e.target.closest(".tier-drop");
  if (!zone) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  zone.classList.add("drag-over");
  showDropMarker(zone, e.clientX, e.clientY, dragName);
});

tiersEl.addEventListener("dragleave", e => {
  const zone = e.target.closest(".tier-drop");
  if (zone && !zone.contains(e.relatedTarget)) {
    zone.classList.remove("drag-over");
    if (document.getElementById("drop-marker")?.parentElement === zone) hideDropMarker();
  }
});

tiersEl.addEventListener("drop", e => {
  if (dragTier) {
    e.preventDefault();
    hideTierMarker();
    const from = state.tiers.findIndex(t => t.id === dragTier);
    let to = tierInsertionIndex(e.clientY);
    dragTier = null;
    if (from !== -1) {
      if (to > from) to--;
      if (to !== from) {
        const [t] = state.tiers.splice(from, 1);
        state.tiers.splice(to, 0, t);
      }
    }
    refresh();
    return;
  }
  const zone = e.target.closest(".tier-drop");
  if (!zone) return;
  e.preventDefault();
  hideDropMarker();
  const name = dragName || e.dataTransfer.getData("text/plain");
  dragName = null;
  if (!name || !zone.dataset.drop || !TASK_BY_NAME[name]) return;
  const tid = zone.dataset.drop;
  const idx = insertionIndex(zone, e.clientX, e.clientY, name);
  state.placement[name] = tid;
  for (const arr of Object.values(state.tierOrder)) {
    const i = arr.indexOf(name);
    if (i !== -1) arr.splice(i, 1);
  }
  (state.tierOrder[tid] = state.tierOrder[tid] || []).splice(idx, 0, name);
  refresh();
});

// ————— tier board events —————

// chip selection
tiersEl.addEventListener("click", e => {
  const chip = e.target.closest(".crea");
  if (chip) {
    selectedName = selectedName === chip.dataset.name ? null : chip.dataset.name;
    refresh();
    return;
  }
  // tier management
  const btn = e.target.closest("button");
  if (!btn) return;
  const row = e.target.closest(".tier");
  const idx = state.tiers.findIndex(t => t.id === row?.dataset.tier);
  if (idx === -1) return;
  const act = btn.dataset.tact;
  if (act === "up" && idx > 0) {
    [state.tiers[idx - 1], state.tiers[idx]] = [state.tiers[idx], state.tiers[idx - 1]];
  } else if (act === "down" && idx < state.tiers.length - 1) {
    [state.tiers[idx + 1], state.tiers[idx]] = [state.tiers[idx], state.tiers[idx + 1]];
  } else if (act === "del" && state.tiers.length > 1) {
    const deadId = state.tiers[idx].id;
    state.tiers.splice(idx, 1);
    const def = defaultTierId();
    for (const [n, tid] of Object.entries(state.placement)) if (tid === deadId) state.placement[n] = def;
    for (const [n, rules] of Object.entries(state.taskRules)) {
      for (const [k, v] of Object.entries(rules)) if (v === "to:" + deadId) delete rules[k];
      if (!Object.keys(rules).length) delete state.taskRules[n];
    }
  } else return;
  refresh();
});

tiersEl.addEventListener("change", e => {
  const inp = e.target.closest(".tier-name");
  if (!inp || inp.tagName !== "INPUT") return;
  const t = state.tiers.find(x => x.id === e.target.closest(".tier")?.dataset.tier);
  if (!t) return;
  t.name = inp.value.trim() || t.name;
  refresh();
});

$("add-tier").addEventListener("click", () => {
  state.tierSeq = Math.max(state.tierSeq || 0, state.tiers.length) + 1;
  state.tiers.push({ id: "t" + state.tierSeq, name: "Tier " + (state.tiers.length + 1) });
  refresh();
});

// ————— floating creature card —————

const popEl = $("popover");

/* ——— custom listbox behaviour ——— */

function closeMenus(except) {
  popEl.querySelectorAll(".sel").forEach(sel => {
    if (sel === except) return;
    sel.querySelector(".sel-menu").hidden = true;
    sel.querySelector(".sel-btn").setAttribute("aria-expanded", "false");
    sel.classList.remove("open");
  });
}

function openMenu(sel) {
  closeMenus(sel);
  const menu = sel.querySelector(".sel-menu");
  menu.hidden = false;
  sel.classList.add("open");
  sel.querySelector(".sel-btn").setAttribute("aria-expanded", "true");
  // flip upward when there isn't room below
  const r = sel.getBoundingClientRect();
  menu.classList.toggle("menu-up", window.innerHeight - r.bottom < menu.offsetHeight + 12);
  (menu.querySelector("li.on") || menu.querySelector("li"))?.focus();
}

/* Apply a chosen modifier rule from a listbox row. */
function applySelValue(sel, val) {
  const name = selectedName;
  if (!name) return;
  const key = sel.closest(".rm-row").dataset.modkey;
  const tr = state.taskRules[name] || (state.taskRules[name] = {});
  if (val === "none") delete tr[key];
  else tr[key] = val;
  if (!Object.keys(tr).length) delete state.taskRules[name];
  refresh();
}

popEl.addEventListener("click", e => {
  // the card handles its own clicks; without this the click-away listener
  // sees a node this handler already detached via refresh() and closes it
  e.stopPropagation();
  if (!selectedName) return;
  const opt = e.target.closest("li[role=option]");
  if (opt) { applySelValue(opt.closest(".sel"), opt.dataset.val); return; }
  const selBtn = e.target.closest(".sel-btn");
  if (selBtn) {
    const sel = selBtn.closest(".sel");
    if (sel.classList.contains("open")) closeMenus();
    else openMenu(sel);
    return;
  }
  closeMenus();
  const btn = e.target.closest("button");
  if (!btn) return;
  const name = selectedName;
  if (btn.dataset.act === "block") {
    if (state.blocked.includes(name)) state.blocked = state.blocked.filter(n => n !== name);
    else if (state.blocked.length < MAX_BLOCKS) state.blocked.push(name);
    refresh();
  } else if (btn.dataset.act === "close") {
    selectedName = null;
    refresh();
  }
});

popEl.addEventListener("keydown", e => {
  const sel = e.target.closest(".sel");
  if (!sel) return;
  const menu = sel.querySelector(".sel-menu");
  const opts = [...menu.querySelectorAll("li")];
  const onBtn = !!e.target.closest(".sel-btn");
  if (onBtn && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
    e.preventDefault();
    openMenu(sel);
    return;
  }
  if (menu.hidden) return;
  const i = opts.indexOf(e.target);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = e.key === "ArrowDown"
      ? Math.min(opts.length - 1, i + 1)
      : Math.max(0, i - 1);
    opts[next]?.focus();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (i !== -1) applySelValue(sel, opts[i].dataset.val);
  } else if (e.key === "Escape" || e.key === "Tab") {
    if (e.key === "Escape") e.stopPropagation();
    closeMenus();
    sel.querySelector(".sel-btn").focus();
  }
});

// click-away, Escape, and reposition on resize
document.addEventListener("click", e => {
  if (popEl.hidden) return;
  if (e.target.closest("#popover") || e.target.closest(".crea") || e.target.closest(".tier-side")) return;
  selectedName = null;
  refresh();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && selectedName) {
    selectedName = null;
    refresh();
  }
});

window.addEventListener("resize", positionPopover);

// ————— control events —————

$("level").addEventListener("change", e => {
  state.level = Math.max(1, Math.min(99, Number(e.target.value) || 99));
  refresh();
});

$("steps").addEventListener("click", e => {
  const b = e.target.closest("button[data-at]");
  if (!b) return;
  state.tasksDone = Number(b.dataset.at);
  refresh();
});

$("venators").addEventListener("click", () => {
  state.venators = !state.venators;
  refresh();
});

$("focus-tier").addEventListener("change", e => {
  state.focusTier = e.target.value;
  refresh();
});

$("reset").addEventListener("click", () => {
  state.tasksDone = 100;
  state.blocked = [];
  state.taskRules = {};
  state.placement = {};
  state.tierOrder = {};
  state.tiers = defaultTiers();
  state.tierSeq = 3;
  state.focusTier = "t1";
  selectedName = null;
  refresh();
});

load();
refresh();
