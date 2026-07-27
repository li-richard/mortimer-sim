/* Rewards page. Reads the board saved by the tier page (same localStorage
 * key) so tiers and progression carry over, and stores your kill-rate
 * edits alongside it. */

const LS_KEY = "mortimer-ledger-v1";
const STAT_BY_NAME = Object.fromEntries(STATS.map(s => [s.name, s]));
const $ = id => document.getElementById(id);

const METRICS = [
  { val: "xpPerHour", label: "XP / hr", step: 1000 },
  { val: "xpPerTask", label: "XP / task", step: 1000 },
  { val: "heartsPerHour", label: "hearts / hr", step: 0.001 },
  { val: "qty", label: "task size", step: 10 },
  { val: "pointsBonus", label: "points bonus", step: 1 },
];

const state = {
  level: 99, tasksDone: 100, venators: true, blocked: [],
  tiers: [], placement: {},
  kph: {},                       // creature -> kills/hour override
  rwMetric: "xpPerHour", rwThreshold: 0, rwElite: false, rwHideMissing: false,
  rwSort: "xpPerHour", rwDesc: true,
};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && typeof s === "object") Object.assign(state, s);
  } catch (e) { /* defaults */ }
  if (!state.kph || typeof state.kph !== "object") state.kph = {};
}

function save() {
  // merge into whatever the board page stored, so we don't clobber it
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { /* ignore */ }
  Object.assign(saved, {
    kph: state.kph, rwMetric: state.rwMetric, rwThreshold: state.rwThreshold,
    rwElite: state.rwElite, rwHideMissing: state.rwHideMissing,
    rwSort: state.rwSort, rwDesc: state.rwDesc,
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

function rowsFor() {
  const unlocked = unlockedMods();
  return TASKS.map(t => {
    const stat = STAT_BY_NAME[t.name] || {};
    const kph = state.kph[t.name] !== undefined ? state.kph[t.name]
      : (stat.kph ? Number(stat.kph) : null);
    const r = MortimerRewards.rewards(t, stat, { unlocked, eliteCA: state.rwElite, kph });
    const tier = tierOf(t.name);
    return {
      task: t, stat, kph, tier,
      edited: state.kph[t.name] !== undefined,
      sourced: !!stat.kph,
      name: t.name,
      tierIdx: tier ? tier.index : 99,
      ...r,
    };
  });
}

function render() {
  const rows = rowsFor();
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

  const metric = METRICS.find(m => m.val === state.rwMetric) || METRICS[0];
  const threshold = Number(state.rwThreshold) || 0;
  const nTiers = (state.tiers || []).length;
  let shown = 0, passing = 0;

  $("rw-body").innerHTML = rows.map(r => {
    const v = r[metric.val];
    const missing = v === null || !isFinite(v);
    if (state.rwHideMissing && missing) return "";
    const passes = !missing && threshold > 0 && v >= threshold;
    if (threshold > 0 && !passes) {
      // still shown, just dimmed — filtering to nothing is worse than ranking
    }
    shown++;
    if (passes) passing++;
    const tierLabel = r.tier
      ? `<span class="rw-tier" style="color:${tierColor(r.tier.index, nTiers)}">${esc(r.tier.name)}</span>`
      : `<span class="rw-tier rw-untiered">—</span>`;
    return `
    <tr class="${threshold > 0 ? (passes ? "rw-pass" : "rw-fail") : ""}">
      <th><img class="rw-img" src="assets/creatures/${slug(r.name)}.png" alt="" loading="lazy" onerror="this.remove()">
        ${esc(r.name)}<small>${r.task.level}</small></th>
      <td>${tierLabel}</td>
      <td class="num">${fmt(r.qty)}</td>
      <td class="num">${fmt(r.xpPerTask)}</td>
      <td class="num">
        <input class="rw-kph ${r.edited ? "edited" : r.sourced ? "sourced" : ""}" type="number" min="0" step="5"
          value="${r.kph ?? ""}" data-kph="${esc(r.name)}"
          title="${r.edited ? "your value" : r.sourced ? esc(r.stat.kphSource) : "no wiki source — type your own"}">
      </td>
      <td class="num">${fmt(r.xpPerHour)}</td>
      <td class="num">1/${fmt(1 / r.heartPerSuperior)}</td>
      <td class="num">${fmt(r.tasksPerHeart)}</td>
      <td class="num">${fmt(r.hoursPerHeart, 1)}</td>
      <td class="num">+${fmt(r.pointsBonus, 1)}</td>
    </tr>`;
  }).join("");

  document.querySelectorAll("#rw-table th[data-sort]").forEach(th => {
    th.classList.toggle("sorted", th.dataset.sort === key);
    th.dataset.dir = th.dataset.sort === key ? (state.rwDesc ? "desc" : "asc") : "";
  });

  const sourced = STATS.filter(s => s.kph).length;
  const edited = Object.keys(state.kph).length;
  $("rw-note").innerHTML = [
    threshold > 0
      ? `<b>${passing}</b> of ${shown} tasks clear ${fmt(threshold)} ${esc(metric.label)}.`
      : `Set a threshold to mark which tasks are worth doing.`,
    `Kill rates: <b>${sourced}</b> sourced from the wiki (money making guides, or Approx. XP/h ÷ XP per kill), <b>${edited}</b> edited by you, <b>${Math.max(0, TASKS.length - sourced - edited)}</b> unknown — per-hour columns stay blank until one is set.`,
    state.tiers.length ? `Tiers come from your board.` : `No board saved yet — set one up on the Tier Board page.`,
  ].join(" ");

  // controls
  $("rw-metric").innerHTML = `<select id="rw-metric-sel" class="rm-sel">${METRICS
    .map(m => `<option value="${m.val}" ${m.val === state.rwMetric ? "selected" : ""}>${m.label}</option>`).join("")}</select>`;
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

$("rw-body").addEventListener("change", e => {
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

document.addEventListener("change", e => {
  if (e.target.id === "rw-metric-sel") {
    state.rwMetric = e.target.value;
    state.rwSort = e.target.value;
    state.rwDesc = true;
    render();
  } else if (e.target.id === "rw-threshold") {
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
