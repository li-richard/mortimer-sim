/* Reward-math checks. Run: node test/rewards-test.js
 *
 * The heart formula is verified against rates the community already knows
 * (Smoke Devils 1/200 per superior, Araxytes 1/224), and the expected-value
 * logic against hand-computed cases, since "exactly one modifier lands"
 * makes it a mean over types rather than a product of bonuses.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { rewards, rewardsByModifier, heartPerSuperior, applicableMods, SUPERIOR_SPAWN } = require("../rewards.js");

let failures = 0;
function check(name, actual, expected, tol = 1e-9) {
  const ok = typeof expected === "number" ? Math.abs(actual - expected) <= tol : actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "FAIL "} ${name}  ${actual}${ok ? "" : "  expected " + expected}`);
}

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const TASKS = JSON.parse(read("data.js").match(/const TASKS = (\[[\s\S]*\]);/)[1]);
const STATS = JSON.parse(read("stats.js").match(/const STATS = (\[[\s\S]*\]);/)[1]);
const byName = n => TASKS.find(t => t.name === n);
const statOf = n => STATS.find(s => s.name === n);

// ————— imbued heart formula vs known rates —————

console.log("— heart per superior matches published rates —");
check("Smoke Devils (req 93) = 1/200", 1 / heartPerSuperior(93), 200, 1e-9);
check("Araxytes (req 92) = 1/224", 1 / heartPerSuperior(92), 224, 1e-9);
check("Hydras (req 95) = 1/160", 1 / heartPerSuperior(95), 160, 1e-9);
check("Abyssal Demons (req 85) = 1/352", 1 / heartPerSuperior(85), 352, 1e-9);
check("higher requirement is always better",
  heartPerSuperior(95) > heartPerSuperior(50) ? 1 : 0, 1);

// ————— which modifiers can roll —————

console.log("— applicable modifier types —");
{
  const all = { clue: true, xp: true, sup: true };
  check("creature with a clue table has 5", applicableMods(byName("Banshees"), all).length, 5);
  check("creature without one has 4", applicableMods(byName("Crawling Hands"), all).length, 4);
  check("nothing unlocked leaves points+qty",
    applicableMods(byName("Banshees"), { clue: false, xp: false, sup: false }).length, 2);
  check("clue type is dropped when locked",
    applicableMods(byName("Banshees"), { clue: false, xp: true, sup: true }).includes("clue") ? 1 : 0, 0);
}

// ————— expected values are a mean over modifier types —————

console.log("— hand-computed expectations —");
{
  // Crawling Hands: qty 35–50 (avg 42.5), qty mod -15..-30 (avg -22.5),
  // no clue table, all unlocked -> 4 modifier types
  const t = byName("Crawling Hands");
  const r = rewards(t, statOf("Crawling Hands"), { unlocked: { clue: true, xp: true, sup: true } });
  check("modifier count", r.mods, 4);
  check("expected quantity = 42.5 + (-22.5)/4", r.qty, 42.5 + (-22.5) / 4, 1e-9);
  // xp modifier midpoint is (25+100)/2 = 62.5%, applied on 1 of 4 rolls
  check("expected xp multiplier", r.xpMult, 1 + 0.625 / 4, 1e-9);
  // superior midpoint (50+100)/2 = 75%
  check("expected superior multiplier", r.supMult, 1 + 0.75 / 4, 1e-9);
  check("expected points bonus = mid(5,15)/4", r.pointsBonus, 10 / 4, 1e-9);
  const { effectiveXpPerKill: effXp, SUPERIOR_SPAWN: SP } = require("../rewards.js");
  check("xp per task = qty * effective xp/kill * mult (superiors included)",
    r.xpPerTask, r.qty * effXp(statOf("Crawling Hands"), SP) * r.xpMult, 1e-6);
}

// ————— per-hour ignores task length —————

console.log("— per-hour figures —");
{
  const t = byName("Gargoyles"), s = statOf("Gargoyles");
  const a = rewards(t, s, { kph: 230 });
  const b = rewards({ ...t, assignMin: 1, assignMax: 1 }, s, { kph: 230 });
  check("xp/hr is independent of task quantity", a.xpPerHour, b.xpPerHour, 1e-9);
  const { effectiveXpPerKill: effXp2, SUPERIOR_SPAWN: SP2 } = require("../rewards.js");
  check("xp/hr = kph * effective xp/kill * mult", a.xpPerHour, 230 * effXp2(s, SP2) * a.xpMult, 1e-6);
  check("hearts/hr = kph * spawn * heart * mult",
    a.heartsPerHour, 230 * SUPERIOR_SPAWN * heartPerSuperior(t.level) * a.supMult, 1e-12);
  check("no kph means no per-hour figure", rewards(t, s, {}).xpPerHour, null);
  check("hours per heart is the reciprocal", a.hoursPerHeart, 1 / a.heartsPerHour, 1e-9);
}

// ————— superiors feed XP as well as hearts —————

console.log("— superior XP —");
{
  const { effectiveXpPerKill, SUPERIOR_SPAWN, SUPERIOR_SPAWN_ELITE_CA } = require("../rewards.js");
  const s = statOf("Aberrant Spectres");
  check("XP per kill includes the superior's share",
    effectiveXpPerKill(s, SUPERIOR_SPAWN),
    Number(s.slayerXp) + Number(s.superiorXp) / 200, 1e-12);
  check("a creature with no superior data falls back to its own XP",
    effectiveXpPerKill(statOf("Rockslugs"), SUPERIOR_SPAWN),
    Number(statOf("Rockslugs").slayerXp), 1e-12);
  check("no Slayer XP at all stays null", effectiveXpPerKill(statOf("Custodian Stalkers"), SUPERIOR_SPAWN), null);

  // the contribution is large enough to matter — double digits, not noise
  const uplift = effectiveXpPerKill(s, SUPERIOR_SPAWN) / Number(s.slayerXp) - 1;
  check("superiors are worth >10% of XP", uplift > 0.1 ? 1 : 0, 1);
  console.log(`     (Aberrant Spectres: ${s.slayerXp} + ${s.superiorXp}/200 = ${effectiveXpPerKill(s, SUPERIOR_SPAWN).toFixed(1)} xp/kill, +${(uplift * 100).toFixed(1)}%)`);
}

// ————— elite CA raises the superior rate —————

console.log("— elite Combat Achievements —");
{
  const t = byName("Araxytes"), s = statOf("Araxytes");
  const base = rewards(t, s, { kph: 100 });
  const elite = rewards(t, s, { kph: 100, eliteCA: true });
  check("elite is exactly 200/150 better for hearts", elite.heartsPerHour / base.heartsPerHour, 200 / 150, 1e-9);
  // and now for XP too, since superiors spawn more often
  check("elite raises XP/hr as well", elite.xpPerHour > base.xpPerHour ? 1 : 0, 1);
  const expected = (Number(s.slayerXp) + Number(s.superiorXp) / 150) / (Number(s.slayerXp) + Number(s.superiorXp) / 200);
  check("XP gain matches the extra superior XP", elite.xpPerHour / base.xpPerHour, expected, 1e-12);
  console.log(`     (Araxytes XP/hr ${(elite.xpPerHour / base.xpPerHour * 100 - 100).toFixed(1)}% higher with elite CAs)`);

  // the Superior-unique modifier boosts the drop table, not the spawn
  // rate, so it must leave XP alone
  const split = rewardsByModifier(t, s, { kph: 100 });
  check("Superior-unique modifier does not touch XP",
    split.find(m => m.key === "sup").xpPerHour, split.find(m => m.key === "points").xpPerHour, 1e-9);
}

// ————— locked modifiers concentrate the odds —————

console.log("— progression changes expectations —");
{
  const t = byName("Wyrms"), s = statOf("Wyrms");
  const early = rewards(t, s, { unlocked: { clue: false, xp: false, sup: false } });
  const late = rewards(t, s, { unlocked: { clue: true, xp: true, sup: true } });
  check("no superior modifier before it unlocks", early.supMult, 1);
  check("superior modifier dilutes once more types unlock",
    late.supMult < 1 + (t.sup[0] + t.sup[1]) / 2 / 100 ? 1 : 0, 1);
  check("quantity modifier hits more often when few types exist",
    early.qty > late.qty ? 1 : 0, 1);
}

// ————— per-modifier split —————

console.log("— per-modifier breakdown —");
{
  const t = byName("Araxytes"), s = statOf("Araxytes");
  const opts = { kph: 1000, unlocked: { clue: true, xp: true, sup: true } };
  const avg = rewards(t, s, opts);
  const split = rewardsByModifier(t, s, opts);

  check("one entry per applicable modifier", split.length, applicableMods(t, opts.unlocked).length);
  check("keys are the modifier types",
    split.map(r => r.key).join(","), applicableMods(t, opts.unlocked).join(","));

  // the average must sit exactly between the per-modifier values
  const meanXp = split.reduce((s2, r) => s2 + r.xpPerHour, 0) / split.length;
  check("averaged XP/hr is the mean of the split", avg.xpPerHour, meanXp, 1e-6);
  const meanHearts = split.reduce((s2, r) => s2 + r.heartsPerHour, 0) / split.length;
  check("averaged hearts/hr is the mean of the split", avg.heartsPerHour, meanHearts, 1e-12);

  // only the XP modifier changes XP; only Superior changes hearts
  const xpRow = split.find(r => r.key === "xp");
  const ptsRow = split.find(r => r.key === "points");
  check("XP modifier raises XP/hr", xpRow.xpPerHour > ptsRow.xpPerHour ? 1 : 0, 1);
  check("XP modifier leaves hearts alone", xpRow.heartsPerHour, ptsRow.heartsPerHour, 1e-15);
  const supRow = split.find(r => r.key === "sup");
  check("Superior modifier raises hearts", supRow.heartsPerHour > ptsRow.heartsPerHour ? 1 : 0, 1);
  check("Superior modifier leaves XP alone", supRow.xpPerHour, ptsRow.xpPerHour, 1e-9);
  // quantity moves task-scale numbers but not per-hour ones
  const qtyRow = split.find(r => r.key === "qty");
  check("quantity modifier changes task size", qtyRow.qty > ptsRow.qty ? 1 : 0, 1);
  check("quantity modifier leaves XP/hr alone", qtyRow.xpPerHour, ptsRow.xpPerHour, 1e-9);

  // the spread is the point of the feature — it should be visible
  const best = Math.max(...split.map(r => r.heartsPerHour));
  const worst = Math.min(...split.map(r => r.heartsPerHour));
  check("Superior modifier is the best for hearts", supRow.heartsPerHour, best, 1e-15);
  console.log(`     (hearts/hr spread across modifiers: ${(best / worst).toFixed(2)}x)`);
}

// ————— baseline comparison —————

console.log("— baseline (the unmodified task) —");
{
  const { baselineRewards } = require("../rewards.js");
  const t = byName("Warped Creatures"), s = statOf("Warped Creatures");
  const opts = { kph: Number(s.kph), unlocked: { clue: true, xp: true, sup: true } };
  const base = baselineRewards(t, s, opts);
  const split = rewardsByModifier(t, s, opts);
  const avg = rewards(t, s, opts);

  // the four modifiers that don't touch XP must land exactly on the baseline
  const noop = split.filter(m => m.key !== "xp");
  check("modifiers that don't affect XP equal the baseline",
    noop.every(m => Math.abs(m.xpPerHour - base.xpPerHour) < 1e-9) ? 1 : 0, 1);
  noop.forEach(m => check(`  ${m.key} is 1.00x baseline`, m.xpPerHour / base.xpPerHour, 1, 1e-12));

  // the XP modifier's multiplier is its own midpoint, not an artefact of averaging
  const xpRow = split.find(m => m.key === "xp");
  check("XP modifier multiplier is its midpoint",
    xpRow.xpPerHour / base.xpPerHour, 1 + (t.xp[0] + t.xp[1]) / 2 / 100, 1e-12);
  console.log(`     (baseline ${Math.round(base.xpPerHour).toLocaleString()} · XP modifier ${Math.round(xpRow.xpPerHour).toLocaleString()} = ${(xpRow.xpPerHour / base.xpPerHour).toFixed(2)}x)`);

  // the average still sits between baseline and boosted, as expected value
  check("average is above the baseline", avg.xpPerHour > base.xpPerHour ? 1 : 0, 1);
  check("average is below the boosted roll", avg.xpPerHour < xpRow.xpPerHour ? 1 : 0, 1);

  // same story for hearts: only the Superior modifier moves them
  const supRow = split.find(m => m.key === "sup");
  check("Superior modifier multiplier is its midpoint",
    supRow.heartsPerWindow / base.heartsPerWindow, 1 + (t.sup[0] + t.sup[1]) / 2 / 100, 1e-12);
  check("points modifier leaves hearts at baseline",
    split.find(m => m.key === "points").heartsPerWindow, base.heartsPerWindow, 1e-15);
  // and the quantity modifier moves task size but not per-hour figures
  const qtyRow = split.find(m => m.key === "qty");
  check("quantity modifier is 1.00x baseline per hour", qtyRow.xpPerHour / base.xpPerHour, 1, 1e-12);
  check("quantity modifier changes task size vs baseline", qtyRow.qty > base.qty ? 1 : 0, 1);
}

// ————— hearts per 80-hour window —————

console.log("— hearts / 80h —");
{
  const { HEART_WINDOW_HOURS } = require("../rewards.js");
  check("window is Jagex's quoted 80 hours", HEART_WINDOW_HOURS, 80);
  const t = byName("Araxytes"), s = statOf("Araxytes");
  const r = rewards(t, s, { kph: 1000 });
  check("is hearts/hr scaled by the window", r.heartsPerWindow, r.heartsPerHour * 80, 1e-12);
  check("no kill rate means no window figure", rewards(t, s, {}).heartsPerWindow, null);
  check("agrees with hours-per-heart", r.heartsPerWindow, 80 / r.hoursPerHeart, 1e-9);

  // unlike hearts/task, the window figure is not inflated by task length
  const long = rewards({ ...t, assignMin: 900, assignMax: 900 }, s, { kph: 1000 });
  check("task length does not change hearts/80h", long.heartsPerWindow, r.heartsPerWindow, 1e-12);
  check("task length does change hearts/task", long.heartsPerTask > r.heartsPerTask ? 1 : 0, 1);

  // the metric should reproduce the meta Jagex names: Araxytes and Smoke
  // Devils are the heart tasks, which hearts/task got wrong
  const ranked = TASKS
    .map(x => ({ name: x.name, v: rewards(x, statOf(x.name), { kph: statOf(x.name).kph ? Number(statOf(x.name).kph) : null }).heartsPerWindow }))
    .filter(x => x.v !== null)
    .sort((a, b) => b.v - a.v);
  check("top two are Araxytes and Smoke Devils",
    ranked.slice(0, 2).map(x => x.name).sort().join(","), "Araxytes,Smoke Devils");
  console.log(`     (${ranked[0].name} ${ranked[0].v.toFixed(2)} · ${ranked[1].name} ${ranked[1].v.toFixed(2)} hearts per 80h)`);
}

// ————— data integrity —————

console.log("— data —");
{
  const missing = STATS.filter(s => !s.slayerXp).map(s => s.name);
  check("at most one creature lacks Slayer XP", missing.length <= 1, true);
  console.log(`     (no wiki infobox yet: ${missing.join(", ") || "none"})`);
  const sourced = STATS.filter(s => s.kph).length;
  console.log(`     (${sourced} of ${STATS.length} have a sourced kill rate)`);
  check("every task has a stats row", TASKS.every(t => statOf(t.name)) ? 1 : 0, 1);
  check("sourced rates are positive numbers",
    STATS.filter(s => s.kph).every(s => Number(s.kph) > 0) ? 1 : 0, 1);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
