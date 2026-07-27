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
const { rewards, heartPerSuperior, applicableMods, SUPERIOR_SPAWN } = require("../rewards.js");

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
  check("xp per task = qty * xp/kill * mult",
    r.xpPerTask, r.qty * Number(statOf("Crawling Hands").slayerXp) * r.xpMult, 1e-6);
}

// ————— per-hour ignores task length —————

console.log("— per-hour figures —");
{
  const t = byName("Gargoyles"), s = statOf("Gargoyles");
  const a = rewards(t, s, { kph: 230 });
  const b = rewards({ ...t, assignMin: 1, assignMax: 1 }, s, { kph: 230 });
  check("xp/hr is independent of task quantity", a.xpPerHour, b.xpPerHour, 1e-9);
  check("xp/hr = kph * xp/kill * mult", a.xpPerHour, 230 * Number(s.slayerXp) * a.xpMult, 1e-6);
  check("hearts/hr = kph * spawn * heart * mult",
    a.heartsPerHour, 230 * SUPERIOR_SPAWN * heartPerSuperior(t.level) * a.supMult, 1e-12);
  check("no kph means no per-hour figure", rewards(t, s, {}).xpPerHour, null);
  check("hours per heart is the reciprocal", a.hoursPerHeart, 1 / a.heartsPerHour, 1e-9);
}

// ————— elite CA raises the superior rate —————

console.log("— elite Combat Achievements —");
{
  const t = byName("Araxytes"), s = statOf("Araxytes");
  const base = rewards(t, s, { kph: 100 });
  const elite = rewards(t, s, { kph: 100, eliteCA: true });
  check("elite is exactly 200/150 better", elite.heartsPerHour / base.heartsPerHour, 200 / 150, 1e-9);
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
