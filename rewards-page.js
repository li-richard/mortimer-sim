/* Rewards page. Reads the board saved by the tier page (same localStorage
 * key) so tiers and progression carry over, and stores your kill-rate
 * edits alongside it. */

const LS_KEY = "mortimer-ledger-v1";
const STAT_BY_NAME = Object.fromEntries(STATS.map(s => [s.name, s]));
const $ = id => document.getElementById(id);

/* Each metric is moved by exactly one modifier type, so a task has two
 * figures a player actually meets: the baseline, and the same task when
 * that modifier lands. Mortimer shows you the modifier before you choose,
 * so those two — not their average — are what a decision rests on. */
const METRICS = [
  { val: "xpPerHour", label: "XP / hr", step: 1000, mod: "xp", digits: 0 },
  { val: "heartsPerWindow", label: "hearts / 80h", step: 0.1, mod: "sup", digits: 2 },
  { val: "qty", label: "task size", step: 10, mod: "qty", digits: 0 },
  { val: "pointsBonus", label: "points bonus", step: 1, mod: "points", digits: 1 },
];
const COLUMNS = new Set(["name", "tier", "qty", "kph", "baseVal", "boostVal", "pointsBonus"]);
const MOD_NAMES = { xp: "Slayer XP", sup: "Superior uniques", qty: "task size", points: "Slayer points" };

const state = {
  level: 99, tasksDone: 100, venators: true, blocked: [],
  tiers: [], placement: {},
  kph: {},                       // creature -> kills/hour override
  rwMetric: "xpPerHour", rwThreshold: 0, rwElite: false, rwHideMissing: false,
  rwSort: "xpPerHour", rwDesc: true,
};

const expanded = new Set();   // creatures whose modifier rows are open

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && typeof s === "object") Object.assign(state, s);
  } catch (e) { /* defaults */ }
  if (!state.kph || typeof state.kph !== "object") state.kph = {};
  if (!state.taskRules || typeof state.taskRules !== "object") state.taskRules = {};
  // arriving here with no board yet: same three tiers the board page makes
  if (!Array.isArray(state.tiers) || !state.tiers.length) {
    state.tiers = [{ id: "t1", name: "Desired" }, { id: "t2", name: "Neutral" }, { id: "t3", name: "Bad" }];
    state.tierSeq = 3;
  }
  if (!state.placement || typeof state.placement !== "object") state.placement = {};
  if (!state.tierOrder || typeof state.tierOrder !== "object") state.tierOrder = {};
  const middle = state.tiers[Math.floor((state.tiers.length - 1) / 2)].id;
  for (const t of TASKS) {
    if (!state.tiers.some(x => x.id === state.placement[t.name])) state.placement[t.name] = middle;
  }
}

/* Move a creature's base tier, keeping tierOrder consistent so the board
 * page sees exactly what a drag would have produced. */
function setTier(name, tierId) {
  if (!state.tiers.some(t => t.id === tierId)) return;
  for (const list of Object.values(state.tierOrder)) {
    const i = list.indexOf(name);
    if (i !== -1) list.splice(i, 1);
  }
  state.placement[name] = tierId;
  (state.tierOrder[tierId] = state.tierOrder[tierId] || []).push(name);
}

/* Where a modifier sends the task: "" (no effect), up, down, or to:<id> */
function setRule(name, modKey, value) {
  const rules = state.taskRules[name] || (state.taskRules[name] = {});
  if (!value || value === "none") delete rules[modKey];
  else rules[modKey] = value;
  if (!Object.keys(rules).length) delete state.taskRules[name];
}

/* Resolve a rule to the tier it lands in, for the label beside it. */
function landsIn(name, modKey) {
  const rule = (state.taskRules[name] || {})[modKey];
  const base = state.tiers.findIndex(t => t.id === state.placement[name]);
  if (!rule || base === -1) return base === -1 ? null : state.tiers[base];
  if (rule === "up") return state.tiers[Math.max(0, base - 1)];
  if (rule === "down") return state.tiers[Math.min(state.tiers.length - 1, base + 1)];
  if (rule.startsWith("to:")) return state.tiers.find(t => t.id === rule.slice(3)) || null;
  return state.tiers[base];
}

function save() {
  // merge into whatever the board page stored, so we don't clobber it
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { /* ignore */ }
  Object.assign(saved, {
    kph: state.kph, rwMetric: state.rwMetric, rwThreshold: state.rwThreshold,
    rwElite: state.rwElite, rwHideMissing: state.rwHideMissing,
    rwSort: state.rwSort, rwDesc: state.rwDesc,
    // board edits made here belong to the board
    tiers: state.tiers, tierSeq: state.tierSeq, placement: state.placement,
    tierOrder: state.tierOrder, taskRules: state.taskRules,
  });
  localStorage.setItem(LS_KEY, JSON.stringify(saved));
}

// progression mirrors the board page (27 Jul thresholds)
const unlockedMods = () => ({
  clue: state.tasksDone >= 15,
  sup: state.tasksDone >= 25,
  xp: state.tasksDone >= 40,
});

const tierOf = name => {
  const i = (state.tiers || []).findIndex(t => t.id === state.placement[name]);
  return i === -1 ? null : { index: i, ...state.tiers[i] };
};

function tierColor(i, n) {
  const stops = [[12, 163, 12], [139, 128, 113], [208, 59, 59]];
  if (!n || n <= 1) return `rgb(${stops[0].join(",")})`;
  const t = i / (n - 1);
  const [a, b, u] = t < 0.5 ? [stops[0], stops[1], t * 2] : [stops[1], stops[2], (t - 0.5) * 2];
  return `rgb(${a.map((x, j) => Math.round(x + (b[j] - x) * u)).join(",")})`;
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fmt = (v, digits = 0) => v === null || v === undefined || !isFinite(v)
  ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

function rowsFor(metric) {
  const unlocked = unlockedMods();
  return TASKS.map(t => {
    const stat = STAT_BY_NAME[t.name] || {};
    const kph = state.kph[t.name] !== undefined ? state.kph[t.name]
      : (stat.kph ? Number(stat.kph) : null);
    const opts = { unlocked, eliteCA: state.rwElite, kph };
    const r = MortimerRewards.rewards(t, stat, opts);
    const base = MortimerRewards.baselineRewards(t, stat, opts);
    const split = MortimerRewards.rewardsByModifier(t, stat, opts);
    const boostedRow = split.find(m => m.key === metric.mod);
    const tier = tierOf(t.name);
    return {
      task: t, stat, kph, tier, split,
      edited: state.kph[t.name] !== undefined,
      sourced: !!stat.kph,
      name: t.name,
      tierIdx: tier ? tier.index : 99,
      // the two figures you actually meet, for the selected metric
      baseVal: base[metric.val],
      boostVal: boostedRow ? boostedRow[metric.val] : null,
      boostRange: boostedRow ? boostedRow.range : null,
      boostIsPercent: boostedRow ? boostedRow.isPercent : false,
      landsOneIn: split.length,
      modUnlocked: split.some(m => m.key === metric.mod),
      ...r,
    };
  });
}

/* One row per modifier: what the task is worth if THAT modifier lands,
 * next to the rule saying where it should send the task. The averaged
 * figures on the parent row hide this spread. */
function modifierRows(r, metric, nTiers) {
  const split = MortimerRewards.rewardsByModifier(r.task, r.stat, {
    unlocked: unlockedMods(), eliteCA: state.rwElite, kph: r.kph,
  });
  const rules = state.taskRules[r.name] || {};
  // compare against the unmodified task, so a multiplier says what that
  // modifier is worth — not how it stacks up against the average, which
  // made every do-nothing modifier look like a penalty
  const base = MortimerRewards.baselineRewards(r.task, r.stat, {
    eliteCA: state.rwElite, kph: r.kph,
  });
  const baseVal = base[metric.val];
  const digits = metric.val === "heartsPerWindow" ? 2 : 0;

  return `<tr class="rw-sub"><td colspan="7"><div class="rw-mods">
    <div class="rw-mod rw-mod-head">
      <span class="rw-mod-name">if this modifier lands…</span>
      <span class="rw-mod-val">${esc(metric.label)} <em>vs unmodified</em></span>
      <span>sends the task</span>
      <span>lands in</span>
    </div>
    ${split.map(m => {
    const v = m[metric.val];
    const ratio = baseVal && isFinite(baseVal) && isFinite(v) && baseVal !== 0 ? v / baseVal : null;
    const notable = ratio !== null && (ratio > 1.005 || ratio < 0.995);
    const rule = rules[m.key] || "none";
    const dest = landsIn(r.name, m.key);
    const destIdx = dest ? state.tiers.findIndex(t => t.id === dest.id) : -1;
    const rangeTxt = m.range
      ? (m.isPercent ? `+${m.range[0]}–${m.range[1]}%`
         : m.range[0] < 0 ? `${m.range[0]} to ${m.range[1]}` : `+${m.range[0]}–${m.range[1]}`)
      : "";
    return `
      <div class="rw-mod">
        <span class="rw-mod-name">${esc(m.label)}<small>${rangeTxt}</small></span>
        <span class="rw-mod-val ${notable ? (ratio > 1 ? "up" : "down") : "flat"}">
          ${fmt(v, digits)}${ratio === null ? "" : notable
            ? `<em>${ratio.toFixed(2)}×</em>`
            : `<em class="rw-noop">no change</em>`}
        </span>
        <select class="rw-rule" data-rule-for="${esc(r.name)}" data-mod="${m.key}">
          <option value="none" ${rule === "none" ? "selected" : ""}>no effect</option>
          <option value="up" ${rule === "up" ? "selected" : ""}>▲ up one tier</option>
          <option value="down" ${rule === "down" ? "selected" : ""}>▼ down one tier</option>
          ${state.tiers.map(x => `<option value="to:${x.id}" ${rule === "to:" + x.id ? "selected" : ""}>→ ${esc(x.name)}</option>`).join("")}
        </select>
        <span class="rw-mod-dest" style="color:${destIdx >= 0 ? tierColor(destIdx, nTiers) : "var(--ink-3)"}">${dest ? esc(dest.name) : "—"}</span>
      </div>`;
  }).join("")}</div>
  <p class="rw-mods-note">Values assume that modifier landed. The row above averages them, since exactly one rolls per task.</p>
  </td></tr>`;
}

function render() {
  // a saved sort or metric may point at a column that no longer exists
  if (!COLUMNS.has(state.rwSort)) state.rwSort = "baseVal";
  if (!METRICS.some(m => m.val === state.rwMetric)) state.rwMetric = "xpPerHour";
  const metricNow = METRICS.find(m => m.val === state.rwMetric) || METRICS[0];
  const rows = rowsFor(metricNow);
  const key = state.rwSort;
  const dir = state.rwDesc ? -1 : 1;
  rows.sort((a, b) => {
    const av = key === "name" ? a.name : key === "tier" ? a.tierIdx : a[key];
    const bv = key === "name" ? b.name : key === "tier" ? b.tierIdx : b[key];
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    const an = av === null || !isFinite(av) ? -Infinity : av;
    const bn = bv === null || !isFinite(bv) ? -Infinity : bv;
    return (an - bn) * dir;
  });

  const metric = metricNow;
  const threshold = Number(state.rwThreshold) || 0;
  const nTiers = (state.tiers || []).length;
  let shown = 0, always = 0, withMod = 0;

  $("rw-body").innerHTML = rows.map(r => {
    const missing = r.baseVal === null || !isFinite(r.baseVal);
    if (state.rwHideMissing && missing) return "";
    // three answers to "is this worth doing": always, only when its
    // modifier lands, or not at all
    const baseClears = !missing && threshold > 0 && r.baseVal >= threshold;
    const boostClears = !missing && threshold > 0 && r.boostVal !== null && r.boostVal >= threshold;
    const verdict = threshold <= 0 || missing ? ""
      : baseClears ? "rw-always" : boostClears ? "rw-withmod" : "rw-fail";
    shown++;
    if (baseClears) always++;
    else if (boostClears) withMod++;
    const open = expanded.has(r.name);
    const tierLabel = `<select class="rw-tier-sel" data-tier-for="${esc(r.name)}"
        style="color:${r.tier ? tierColor(r.tier.index, nTiers) : "var(--ink-3)"}"
        title="Base tier — where this creature sits before its modifier rolls">
        ${state.tiers.map(x => `<option value="${x.id}" ${r.tier && x.id === r.tier.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
      </select>`;
    const ruleCount = Object.keys(state.taskRules[r.name] || {}).length;
    const rangeTxt = r.boostRange
      ? (r.boostIsPercent ? `+${r.boostRange[0]}–${r.boostRange[1]}%`
         : r.boostRange[0] < 0 ? `${r.boostRange[0]} to ${r.boostRange[1]}` : `+${r.boostRange[0]}–${r.boostRange[1]}`)
      : "";
    // one column: the plain task, with the modifier's version in brackets
    const boosted = !r.modUnlocked ? ""
      : ` <span class="rw-paren ${!baseClears && boostClears ? "rw-cell-pass" : ""}">(${fmt(r.boostVal, metric.digits)})</span>`;
    const cellTitle = r.modUnlocked
      ? `plain ${fmt(r.baseVal, metric.digits)} · with the ${MOD_NAMES[metric.mod]} modifier ${fmt(r.boostVal, metric.digits)} (${rangeTxt}, lands 1 in ${r.landsOneIn})`
      : `the ${MOD_NAMES[metric.mod]} modifier is not unlocked yet`;
    return `
    <tr class="rw-row ${open ? "open" : ""} ${verdict}" data-row="${esc(r.name)}">
      <th><span class="rw-caret">${open ? "▾" : "▸"}</span
        ><img class="rw-img" src="assets/creatures/${slug(r.name)}.png" alt="" loading="lazy" onerror="this.remove()">
        ${esc(r.name)}<small>${r.task.level}</small>${ruleCount ? `<span class="rw-rulecount" title="${ruleCount} modifier rule${ruleCount > 1 ? "s" : ""} set">${ruleCount}⇅</span>` : ""}</th>
      <td>${tierLabel}</td>
      <td class="num">${fmt(r.qty)}</td>
      <td class="num">
        <input class="rw-kph ${r.edited ? "edited" : r.sourced ? "sourced" : ""}" type="number" min="0" step="5"
          value="${r.kph ?? ""}" data-kph="${esc(r.name)}"
          title="${r.edited ? "your value" : r.sourced ? esc(r.stat.kphSource) : "no wiki source — type your own"}">
      </td>
      <td class="num" title="${esc(cellTitle)}"><span class="${baseClears ? "rw-cell-pass" : ""}">${fmt(r.baseVal, metric.digits)}</span>${boosted}</td>
      <td class="num">+${fmt(r.pointsBonus, 1)}</td>
    </tr>` + (open ? modifierRows(r, metric, nTiers) : "");
  }).join("");

  // the metric column names itself, and says what the bracket means
  $("rw-h-metric").innerHTML = `${esc(metric.label)} <small>(with ${esc(MOD_NAMES[metric.mod])})</small>`;

  document.querySelectorAll("#rw-table th[data-sort]").forEach(th => {
    th.classList.toggle("sorted", th.dataset.sort === key);
    th.dataset.dir = th.dataset.sort === key ? (state.rwDesc ? "desc" : "asc") : "";
  });

  const sourced = STATS.filter(s => s.kph).length;
  const edited = Object.keys(state.kph).length;
  $("rw-note").innerHTML = [
    threshold > 0
      ? `At ${fmt(threshold, metric.digits)} ${esc(metric.label)}: <b class="rw-k-always">${always}</b> worth doing on any offer, `
        + `<b class="rw-k-withmod">${withMod}</b> only when the ${esc(MOD_NAMES[metric.mod])} modifier lands, `
        + `<b>${shown - always - withMod}</b> not worth it.`
      : `Set a threshold to see which tasks clear it on any offer, and which only clear it when their modifier lands.`,
    `Kill rates: <b>${sourced}</b> sourced from the wiki (money making guides, or Approx. XP/h ÷ XP per kill), <b>${edited}</b> edited by you, <b>${Math.max(0, TASKS.length - sourced - edited)}</b> unknown — per-hour columns stay blank until one is set.`,
    state.tiers.length ? `Tiers come from your board.` : `No board saved yet — set one up on the Tier Board page.`,
  ].join(" ");

  // controls — the metric picker uses the app's listbox, not a native
  // select, so its open menu is themed too
  $("rw-metric").innerHTML = `
    <div class="sel" id="rw-metric-sel">
      <button type="button" class="sel-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Metric to judge tasks by">
        <span class="sel-val">${esc(metric.label)}</span><span class="sel-caret">▾</span>
      </button>
      <ul class="sel-menu" role="listbox" aria-label="Metric" hidden>
        ${METRICS.map(m => `<li role="option" tabindex="-1" data-metric="${m.val}"
          aria-selected="${m.val === state.rwMetric}" class="${m.val === state.rwMetric ? "on" : ""}">
          <span class="sel-tick">${m.val === state.rwMetric ? "✓" : ""}</span>${esc(m.label)}</li>`).join("")}
      </ul>
    </div>`;
  $("rw-threshold").value = state.rwThreshold;
  $("rw-threshold").step = metric.step;
  const el = $("rw-elite");
  el.classList.toggle("on", state.rwElite);
  el.setAttribute("aria-pressed", String(state.rwElite));
  el.textContent = state.rwElite ? "1/150 · elite CA" : "1/200 · no elite CA";
  const hb = $("rw-hide");
  hb.classList.toggle("on", state.rwHideMissing);
  hb.setAttribute("aria-pressed", String(state.rwHideMissing));
  hb.textContent = state.rwHideMissing ? "hidden" : "shown";

  save();
}

// ————— events —————

$("rw-body").addEventListener("click", e => {
  // clicking the row toggles its modifier rows; controls keep their own behaviour
  if (e.target.closest("select, input, option")) return;
  const row = e.target.closest("tr[data-row]");
  if (!row) return;
  const name = row.dataset.row;
  if (expanded.has(name)) expanded.delete(name);
  else expanded.add(name);
  render();
});

$("rw-body").addEventListener("change", e => {
  const tierSel = e.target.closest("select[data-tier-for]");
  if (tierSel) {
    setTier(tierSel.dataset.tierFor, tierSel.value);
    render();
    return;
  }
  const ruleSel = e.target.closest("select[data-rule-for]");
  if (ruleSel) {
    setRule(ruleSel.dataset.ruleFor, ruleSel.dataset.mod, ruleSel.value);
    render();
    return;
  }
  const inp = e.target.closest("input[data-kph]");
  if (!inp) return;
  const name = inp.dataset.kph;
  const v = inp.value.trim();
  if (v === "") delete state.kph[name];
  else state.kph[name] = Math.max(0, Number(v) || 0);
  render();
});

document.querySelector("#rw-table thead").addEventListener("click", e => {
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  const k = th.dataset.sort;
  if (state.rwSort === k) state.rwDesc = !state.rwDesc;
  else { state.rwSort = k; state.rwDesc = k !== "name"; }
  render();
});

/* Switching metric changes the units, so a threshold carried over from
 * the old one is meaningless — 60,000 XP/hr becomes 60,000 hearts. */
function setMetric(val) {
  if (val === state.rwMetric) return;
  state.rwMetric = val;
  state.rwSort = val;
  state.rwDesc = true;
  state.rwThreshold = 0;
  render();
}

const metricEl = () => document.getElementById("rw-metric-sel");

$("rw-metric").addEventListener("click", e => {
  const opt = e.target.closest("li[data-metric]");
  if (opt) { setMetric(opt.dataset.metric); return; }
  const btn = e.target.closest(".sel-btn");
  if (!btn) return;
  const sel = metricEl();
  const menu = sel.querySelector(".sel-menu");
  const open = !menu.hidden;
  menu.hidden = open;
  sel.classList.toggle("open", !open);
  btn.setAttribute("aria-expanded", String(!open));
  if (!open) (menu.querySelector("li.on") || menu.querySelector("li"))?.focus();
});

$("rw-metric").addEventListener("keydown", e => {
  const sel = metricEl();
  const menu = sel.querySelector(".sel-menu");
  const items = [...menu.querySelectorAll("li")];
  if (e.target.closest(".sel-btn") && ["Enter", " ", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    menu.hidden = false;
    sel.classList.add("open");
    (menu.querySelector("li.on") || items[0])?.focus();
    return;
  }
  if (menu.hidden) return;
  const i = items.indexOf(e.target);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (i !== -1) setMetric(items[i].dataset.metric);
  } else if (e.key === "Escape") {
    menu.hidden = true;
    sel.classList.remove("open");
    sel.querySelector(".sel-btn").focus();
  }
});

document.addEventListener("click", e => {
  const sel = metricEl();
  if (!sel || e.target.closest("#rw-metric")) return;
  const menu = sel.querySelector(".sel-menu");
  if (menu && !menu.hidden) { menu.hidden = true; sel.classList.remove("open"); }
});

document.addEventListener("change", e => {
  if (e.target.id === "rw-threshold") {
    state.rwThreshold = Math.max(0, Number(e.target.value) || 0);
    render();
  }
});

$("rw-elite").addEventListener("click", () => { state.rwElite = !state.rwElite; render(); });
$("rw-hide").addEventListener("click", () => { state.rwHideMissing = !state.rwHideMissing; render(); });
$("rw-reset-kph").addEventListener("click", () => {
  if (!Object.keys(state.kph).length || confirm("Discard your kill-rate edits and go back to the wiki-sourced values?")) {
    state.kph = {};
    render();
  }
});

load();
render();
