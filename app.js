/* Mortimer's Ledger — UI layer. All probability math lives in math.js
 * (exact enumeration, no simulation) and is covered by test/math-test.js. */

const LS_KEY = "mortimer-ledger-v1";
const SKIP_COST = 100;
const BLOCK_COST = 120;
const MAX_BLOCKS = 2;

const CLS_ORDER = ["desired", "neutral", "bad"];
const CLS_ICON = { desired: "✓", neutral: "·", bad: "✗" };

function defaultTiers() {
  return [
    { id: "t1", name: "Desired", cls: "desired" },
    { id: "t2", name: "Neutral", cls: "neutral" },
    { id: "t3", name: "Bad", cls: "bad" },
  ];
}

const state = {
  level: 99,
  offers: 3,
  venators: true,
  blocked: [],  // names, max 2
  // which optional modifier types are unlocked (points & quantity are always on)
  modUnlocked: { clue: true, xp: true, sup: true },
  // ordered tier list, index 0 = best
  tiers: defaultTiers(),
  tierSeq: 3,
  // creature name -> tier id; every creature is always placed (default: neutral)
  placement: {},
  // tier id -> ordered creature names (manual ordering within a tier)
  tierOrder: {},
  // per-creature modifier rules: name -> { points|qty|clue|xp|sup: "up"|"down"|"to:<tierId>" }
  taskRules: {},
};

// UI-only state, not persisted
let selectedName = null;
let dragName = null;

// ————— persistence + migration —————

function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { /* fresh start */ }
  if (s && typeof s === "object") {
    const labels = s.labels; // pre-tier-board saves labeled creatures directly
    delete s.labels;
    delete s.modRules;
    Object.assign(state, s);
    if (!Array.isArray(state.tiers) || !state.tiers.length) state.tiers = defaultTiers();
    if (!state.placement || typeof state.placement !== "object") state.placement = {};
    if (!state.taskRules || typeof state.taskRules !== "object") state.taskRules = {};
    if (labels && typeof labels === "object") {
      for (const [name, lab] of Object.entries(labels)) {
        const tier = state.tiers.find(t => t.cls === lab);
        if (tier) state.placement[name] = tier.id;
      }
    }
    // migrate the pre-tier rule vocabulary to tier operations
    for (const [name, rules] of Object.entries(state.taskRules)) {
      for (const [k, v] of Object.entries(rules)) {
        if (v === "tier") rules[k] = "up";
        else if (v === "neutral" || v === "desired") {
          const tier = state.tiers.find(t => t.cls === v);
          rules[k] = tier ? "to:" + tier.id : "none";
        }
        if (rules[k] === "none") delete rules[k];
      }
      if (!Object.keys(rules).length) delete state.taskRules[name];
    }
  }
  ensurePlacements();
}

/* Every creature always sits in a tier; the default home is the first
 * neutral-class tier (or the middle tier if none is neutral). */
function defaultTierId() {
  const t = state.tiers.find(x => x.cls === "neutral") ||
    state.tiers[Math.floor((state.tiers.length - 1) / 2)];
  return t.id;
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

function classOf(name) {
  const i = tierIndexOf(name);
  return i === null ? "neutral" : state.tiers[i].cls;
}

/* The modifier types that can land on this creature, with its own
 * rolled ranges (for the drawer UI). */
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
    .filter(d => !d.unlock || state.modUnlocked[d.unlock])
    .map(d => MortimerMath.resolveTier(baseIdx, normRule(r[d.key]), state.tiers.length));
}

function slotClasses(t) {
  return slotTierIdxs(t).map(idx => idx === null ? "neutral" : state.tiers[idx].cls);
}

function computeOdds() {
  const pool = TASKS.filter(inPool);
  const m = state.tiers.length;
  const entries = pool.map(t => {
    const idxs = slotTierIdxs(t);
    const tierProbs = new Array(m).fill(0);
    for (const i of idxs) if (i !== null) tierProbs[i] += 1 / idxs.length;
    return {
      name: t.name, weight: t.weight, tierProbs,
      ...MortimerMath.slotProbs(idxs.map(i => i === null ? "neutral" : state.tiers[i].cls)),
    };
  });
  const odds = MortimerMath.computeOdds(entries, state.offers);
  return { ...odds, pool, slot: Object.fromEntries(entries.map(e => [e.name, e])) };
}

// ————— formatting —————

const pct = x => (x * 100).toFixed(1) + "%";
const pct0 = x => (x * 100).toFixed(0) + "%";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
  return `<div class="crea ${blocked ? "c-blocked" : ""} ${tooHigh || noQuest ? "c-locked" : ""}
      ${selectedName === t.name ? "sel" : ""} ${state.taskRules[t.name] ? "c-rules" : ""}"
    draggable="true" data-name="${t.name}"
    title="${t.name} · lvl ${t.level}${t.weight === 8 ? " · weight 8" : ""}${note} — click to configure, drag to re-tier">
    ${t.name}<small>${t.level}</small><span class="c-off">${off}</span></div>`;
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
  const slot = odds.slot[t.name];
  const cls = classOf(t.name);
  let chips = "";
  if (slot) {
    const baseD = cls === "desired" ? 1 : 0;
    const baseB = cls === "bad" ? 1 : 0;
    const parts = [];
    if (slot.dProb !== baseD)
      parts.push(`<span class="chip chip-d" title="Chance it counts desired once its modifier rolls">✓${Math.round(slot.dProb * 100)}%</span>`);
    if (slot.bProb !== baseB)
      parts.push(`<span class="chip chip-b" title="Chance it counts bad once its modifier rolls">✗${Math.round(slot.bProb * 100)}%</span>`);
    chips = parts.join("");
  }
  const tr = state.taskRules[t.name] || {};
  const curTier = state.placement[t.name];
  const tierOpts = state.tiers.map(x =>
    `<option value="${x.id}" ${x.id === curTier ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  const ruleOpts = cur => [
    `<option value="none" ${!cur || cur === "none" ? "selected" : ""}>no effect</option>`,
    `<option value="up" ${cur === "up" ? "selected" : ""}>▲ up one tier</option>`,
    `<option value="down" ${cur === "down" ? "selected" : ""}>▼ down one tier</option>`,
    ...state.tiers.map(x => `<option value="to:${x.id}" ${cur === "to:" + x.id ? "selected" : ""}>→ ${esc(x.name)}</option>`),
  ].join("");
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
    <div class="pop-sub">assign ${t.assignMin}–${t.assignMax}${t.extendable ? " · extendable" : ""} · weighting ${t.weight}</div>
    <div class="pop-rows">
      <div class="rm-row rm-tier">
        <span class="rm-name">Tier</span>
        <select class="rm-sel" data-tiersel aria-label="Tier for ${t.name}">${tierOpts}</select>
      </div>
      ${creatureModDefs(t).map(d => {
        const unlocked = !d.unlock || state.modUnlocked[d.unlock];
        return `<div class="rm-row ${unlocked ? "" : "rm-off"}" data-modkey="${d.key}">
          <span class="rm-name">${d.name} <small>${d.range}</small>${unlocked ? "" : ' <small class="rm-lock">locked</small>'}</span>
          <select class="rm-sel" data-rulesel aria-label="${d.name} rule for ${t.name}" ${unlocked ? "" : "disabled"}>${ruleOpts(tr[d.key])}</select>
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
  const t = selectedName ? TASKS.find(x => x.name === selectedName) : null;
  if (!t) { pop.hidden = true; pop.innerHTML = ""; return; }
  pop.innerHTML = popoverHtml(t, odds);
  pop.hidden = false;
  positionPopover();
}

const TASK_BY_NAME = Object.fromEntries(TASKS.map(t => [t.name, t]));

function renderTiers(odds) {
  $("tiers").innerHTML = state.tiers.map((tier, i) => {
    const members = (state.tierOrder[tier.id] || []).map(n => TASK_BY_NAME[n]).filter(Boolean);
    return `
    <div class="tier cls-${tier.cls}" data-tier="${tier.id}">
      <div class="tier-side">
        <button class="tier-cls" data-tact="cls" title="Counts as ${tier.cls} in the odds — click to cycle">${CLS_ICON[tier.cls]}</button>
        <div class="tier-side-main">
          <input class="tier-name" value="${esc(tier.name)}" aria-label="Tier name" maxlength="24">
          <span class="tier-odds" title="Chance the next offer contains at least one task that ends up in this tier (after modifiers)">${odds.tierHit ? pct(odds.tierHit[i]) : "—"} of offers</span>
        </div>
        <div class="tier-tools">
          <button data-tact="up" title="Move tier up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button data-tact="down" title="Move tier down" ${i === state.tiers.length - 1 ? "disabled" : ""}>↓</button>
          <button data-tact="del" title="Delete tier (its creatures move to the default tier)" ${state.tiers.length <= 1 ? "disabled" : ""}>✕</button>
        </div>
      </div>
      <div class="tier-drop" data-drop="${tier.id}">${members.map(t => chipHtml(t, odds)).join("")}</div>
    </div>`;
  }).join("");
}

function renderResults(o) {
  const { pDesired: pD, pAllBad: pB, pNeutral: pN, pool, k } = o;
  const nDesired = pool.filter(t => classOf(t.name) === "desired").length;
  const nBad = pool.filter(t => classOf(t.name) === "bad").length;
  const nNeutral = pool.length - nDesired - nBad;
  const rulesActive = Object.keys(state.taskRules).length > 0;

  $("hero-num").textContent = (nDesired || pD > 0) ? pct(pD) : "—";
  $("hero-foot").textContent = (nDesired || pD > 0)
    ? `${nDesired} desired of ${pool.length} in pool · ${k} offered per roll${rulesActive ? " · Mortifier rules applied" : ""}`
    : `drag creatures into a ✓ tier to see your odds · ${pool.length} in pool`;

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
  $("t-allbad").textContent = pB > 0 ? pct(pB) : "0%";
  $("t-rolls").textContent = pD > 0 ? st.offersPerDesired.toFixed(1) : "—";
  $("t-skipcost").textContent = pD > 0 ? Math.round(st.skipUntilDesiredCost) + " pts" : "—";
  $("t-patient").textContent = (pD + pN) > 0 ? pct0(st.patientDesiredShare) : "—";

  const blockSpend = state.blocked.length * BLOCK_COST;
  const skipsPerTask = st.patientSkipsPerTask;
  $("fine").innerHTML = [
    `<b>${nDesired}</b> desired · <b>${nNeutral}</b> neutral · <b>${nBad}</b> bad · <b>${state.blocked.length}</b>/${MAX_BLOCKS} blocked${blockSpend ? ` (${blockSpend} pts)` : ""}.`,
    pB > 0 ? `Skipping only all-bad offers costs ≈ <b>${Number.isFinite(skipsPerTask) ? Math.round(skipsPerTask * SKIP_COST) : "∞"} pts</b> per completed task (${(skipsPerTask * 100).toFixed(1)} skips per 100 tasks).` : "",
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
  ensurePlacements();
  const odds = computeOdds();
  renderTiers(odds);
  renderPopover(odds);
  renderResults(odds);
  renderControls();
  save();
}

// ————— tier board events —————

const tiersEl = $("tiers");

tiersEl.addEventListener("dragstart", e => {
  const chip = e.target.closest(".crea");
  if (!chip) return;
  dragName = chip.dataset.name;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragName);
  chip.classList.add("dragging");
});

tiersEl.addEventListener("dragend", () => {
  dragName = null;
  document.querySelectorAll(".drag-over, .dragging").forEach(x => x.classList.remove("drag-over", "dragging"));
});

tiersEl.addEventListener("dragover", e => {
  const zone = e.target.closest(".tier-drop");
  if (!zone) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  zone.classList.add("drag-over");
});

tiersEl.addEventListener("dragleave", e => {
  const zone = e.target.closest(".tier-drop");
  if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove("drag-over");
});

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

tiersEl.addEventListener("drop", e => {
  const zone = e.target.closest(".tier-drop");
  if (!zone) return;
  e.preventDefault();
  const name = dragName || e.dataTransfer.getData("text/plain");
  dragName = null;
  if (!name || !zone.dataset.drop) return;
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
  if (act === "cls") {
    const t = state.tiers[idx];
    t.cls = CLS_ORDER[(CLS_ORDER.indexOf(t.cls) + 1) % CLS_ORDER.length];
  } else if (act === "up" && idx > 0) {
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

// ————— floating creature card —————

const popEl = $("popover");

popEl.addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn || !selectedName) return;
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

popEl.addEventListener("change", e => {
  if (!selectedName) return;
  const name = selectedName;
  if (e.target.hasAttribute("data-tiersel")) {
    state.placement[name] = e.target.value;
    refresh();
    return;
  }
  if (e.target.hasAttribute("data-rulesel")) {
    const key = e.target.closest(".rm-row").dataset.modkey;
    const tr = state.taskRules[name] || (state.taskRules[name] = {});
    if (e.target.value === "none") delete tr[key];
    else tr[key] = e.target.value;
    if (!Object.keys(tr).length) delete state.taskRules[name];
    refresh();
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

$("add-tier").addEventListener("click", () => {
  state.tierSeq = Math.max(state.tierSeq || 0, state.tiers.length) + 1;
  state.tiers.push({ id: "t" + state.tierSeq, name: "Tier " + (state.tiers.length + 1), cls: "neutral" });
  refresh();
});

// ————— control events —————

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

$("unlock-seg").addEventListener("click", e => {
  const b = e.target.closest("button[data-unlock]");
  if (!b) return;
  state.modUnlocked[b.dataset.unlock] = !state.modUnlocked[b.dataset.unlock];
  refresh();
});

$("reset").addEventListener("click", () => {
  state.blocked = [];
  state.taskRules = {};
  state.placement = {};
  state.tierOrder = {};
  state.tiers = defaultTiers();
  state.tierSeq = 3;
  selectedName = null;
  refresh();
});

load();
refresh();
