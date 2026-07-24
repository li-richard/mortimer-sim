/* Independent verification of math.js. Run: node test/math-test.js
 *
 * Strategy: never re-derive a number the same way math.js does. Each check
 * uses a different route to the same quantity:
 *   1. Complementary counting  — P(event) via P(complement) over a
 *      restricted enumeration, instead of classifying full sequences.
 *   2. Exact BigInt rationals  — no floating point at all.
 *   3. Closed forms            — equal weights reduce to uniform k-subsets
 *      (hypergeometric), computed from binomial coefficients.
 *   4. Hand-computed cases     — small pools written out term by term.
 *   5. Monte Carlo             — a seeded LCG simulation of the actual
 *      game procedure (draw creatures, roll modifiers, promote).
 *   6. Invariants              — sum of appear[] must equal k; outcome
 *      probabilities partition 1; binary slot probs reduce to the
 *      label-only model.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { computeOdds, strategyStats, resolveTier, slotProbs } = require("../math.js");

let failures = 0;
function check(name, actual, expected, tol = 1e-12) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "FAIL "} ${name}  ${actual}${ok ? "" : "  expected " + expected}`);
}

const binaryPool = (specs) => specs.map(([name, weight, label]) => ({
  name, weight,
  dProb: label === "desired" ? 1 : 0,
  bProb: label === "bad" ? 1 : 0,
}));

// ————— exact rational arithmetic (BigInt) —————

const gcd = (a, b) => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
const frac = (n, d) => { const g = gcd(n, d) || 1n; return [n / g, d / g]; };
const fAdd = ([a, b], [c, d]) => frac(a * d + c * b, b * d);
const fMul = ([a, b], [c, d]) => frac(a * c, b * d);
const fNum = ([a, b]) => Number(a) / Number(b);

/* P(all k successive draws land inside subset S), drawing from the full
 * pool of total weight W. Enumerates ordered tuples within S only —
 * a different (and smaller) enumeration than math.js performs. */
function pAllWithin(S, W, k) {
  if (k === 0) return [1n, 1n];
  let total = [0n, 1n];
  (function rec(prefixP, remW, used, depth) {
    if (depth === k) { total = fAdd(total, prefixP); return; }
    for (let i = 0; i < S.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      rec(fMul(prefixP, frac(BigInt(S[i]), remW)), remW - BigInt(S[i]), used, depth + 1);
      used[i] = false;
    }
  })([1n, 1n], BigInt(W), new Array(S.length).fill(false), 0);
  return total;
}

const binom = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return r;
};

// ————— load the real task data (data.js is generated from the CSV) —————

const dataSrc = fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8");
const TASKS = JSON.parse(dataSrc.match(/const TASKS = (\[[\s\S]*\]);/)[1]);

// ————— resolveTier / slotProbs unit checks —————

console.log("— tier resolution —");
check("up from tier 2 of 4 → 1", resolveTier(2, "up", 4), 1);
check("up caps at the top", resolveTier(0, "up", 4), 0);
check("down from tier 1 of 4 → 2", resolveTier(1, "down", 4), 2);
check("down caps at the bottom", resolveTier(3, "down", 4), 3);
check("absolute jump", resolveTier(3, 0, 4), 0);
check("absolute jump clamps", resolveTier(0, 9, 4), 3);
check("none stays put", resolveTier(2, "none", 4), 2);
check("unranked + relative move stays unranked", resolveTier(null, "up", 4) === null ? 1 : 0, 1);
check("unranked + absolute jump lands", resolveTier(null, 2, 4), 2);
{
  const s = slotProbs(["bad", "neutral", "bad", "desired"]);
  check("slotProbs: dProb = 1/4", s.dProb, 0.25);
  check("slotProbs: bProb = 2/4", s.bProb, 0.5);
  const s2 = slotProbs(["desired", "desired"]);
  check("slotProbs all desired: dProb = 1", s2.dProb, 1);
  const s3 = slotProbs([]);
  check("empty classes: dProb = 0", s3.dProb, 0);
}

// ————— binary labels: full pool vs exact complementary counting —————

console.log("— full 29-creature pool, k=3, binary labels, vs exact complementary counting —");
{
  const desired = new Set(["Gargoyles", "Abyssal Demons"]);
  const bad = new Set(["Crawling Hands", "Cave Crawlers", "Rockslugs"]);
  const pool = binaryPool(TASKS.map(t => [
    t.name, t.weight,
    desired.has(t.name) ? "desired" : bad.has(t.name) ? "bad" : "neutral",
  ]));
  const W = pool.reduce((s, t) => s + t.weight, 0);
  const k = 3;
  const o = computeOdds(pool, k);

  const nonDesired = pool.filter(t => t.dProb === 0).map(t => t.weight);
  const badW = pool.filter(t => t.bProb === 1).map(t => t.weight);
  check("pDesired = 1 − P(no desired drawn)", o.pDesired, 1 - fNum(pAllWithin(nonDesired, W, k)));
  check("pAllBad  = P(all draws in bad set)", o.pAllBad, fNum(pAllWithin(badW, W, k)));
  check("outcomes partition 1", o.pDesired + o.pAllBad + o.pNeutral, 1);

  for (const name of ["Gargoyles", "Bloodveld", "Hydras"]) {
    const others = pool.filter(t => t.name !== name).map(t => t.weight);
    check(`appear[${name}] = 1 − P(never drawn)`, o.appear[name], 1 - fNum(pAllWithin(others, W, k)));
  }
  const appearSum = Object.values(o.appear).reduce((a, b) => a + b, 0);
  check("Σ appear = k (expected creatures shown)", appearSum, k, 1e-9);

  // values previously computed with Python fractions.Fraction, 6 dp
  check("pDesired matches Python Fraction run", o.pDesired, 0.189494, 5e-7);
  check("pAllBad matches Python Fraction run", o.pAllBad, 0.000319, 5e-7);
  check("appear[Gargoyles] matches Python Fraction run", o.appear["Gargoyles"], 0.108522, 5e-7);
}

// ————— equal weights ⇒ uniform k-subset (hypergeometric closed form) —————

console.log("— equal weights reduce to C(n−d,k)/C(n,k) —");
for (const [n, d, b, k] of [[29, 3, 4, 3], [10, 2, 3, 2], [6, 1, 5, 3], [5, 2, 0, 2]]) {
  const pool = binaryPool(Array.from({ length: n }, (_, i) => [
    "c" + i, 7,
    i < d ? "desired" : i < d + b ? "bad" : "neutral",
  ]));
  const o = computeOdds(pool, k);
  check(`n=${n} d=${d} k=${k}: pDesired`, o.pDesired, 1 - binom(n - d, k) / binom(n, k), 1e-9);
  check(`n=${n} d=${d} b=${b} k=${k}: pAllBad`, o.pAllBad, binom(b, k) / binom(n, k), 1e-9);
  check(`n=${n} k=${k}: appear = k/n`, o.appear["c0"], k / n, 1e-9);
}

// ————— unequal weights, k=2, written out term by term —————

console.log("— hand-computed 4-creature pool, k=2, binary labels —");
{
  // A(8, desired), B(10, bad), C(10, neutral), D(12, bad); W = 40
  const pool = binaryPool([["A", 8, "desired"], ["B", 10, "bad"], ["C", 10, "neutral"], ["D", 12, "bad"]]);
  const o = computeOdds(pool, 2);
  const pA = 8 / 40 + (10 / 40) * (8 / 30) + (10 / 40) * (8 / 30) + (12 / 40) * (8 / 28);
  const pBD = (10 / 40) * (12 / 30) + (12 / 40) * (10 / 28);
  check("pDesired = P(A offered)", o.pDesired, pA);
  check("appear[A] = pDesired here", o.appear["A"], pA);
  check("pAllBad = P({B,D})", o.pAllBad, pBD);
}

// ————— fractional slot probs, k=2, hand-computed over all sets —————

console.log("— hand-computed 3-creature pool, k=2, fractional slot probs —");
{
  // X(10, d=.5 b=.25), Y(20, d=0 b=1), Z(10, d=.2 b=0); W = 40
  const pool = [
    { name: "X", weight: 10, dProb: 0.5, bProb: 0.25 },
    { name: "Y", weight: 20, dProb: 0, bProb: 1 },
    { name: "Z", weight: 10, dProb: 0.2, bProb: 0 },
  ];
  // P(set): XY, XZ, YZ via successive draws
  const pXY = (10 / 40) * (20 / 30) + (20 / 40) * (10 / 20);
  const pXZ = (10 / 40) * (10 / 30) + (10 / 40) * (10 / 30);
  const pYZ = (20 / 40) * (10 / 20) + (10 / 40) * (20 / 30);
  const pD = pXY * (1 - 0.5 * 1) + pXZ * (1 - 0.5 * 0.8) + pYZ * (1 - 1 * 0.8);
  const pAB = pXY * (0.25 * 1) + pXZ * (0.25 * 0) + pYZ * (1 * 0);
  const o = computeOdds(pool, 2);
  check("sets partition 1", pXY + pXZ + pYZ, 1);
  check("pDesired (mixed probs)", o.pDesired, pD);
  check("pAllBad (mixed probs)", o.pAllBad, pAB);
}

// ————— Monte Carlo of the actual game procedure, seeded LCG —————

console.log("— seeded Monte Carlo of draw + modifier roll + promotion, full pool —");
{
  // mulberry32 — a well-mixed seeded PRNG (a plain LCG's serial
  // correlation between the creature pick and modifier pick biases this)
  let seed = 123456789;
  const rand = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // tier list: 0 = Desired, 1 = Neutral, 2 = Bad (5 tiers to exercise clamps)
  const TIER_CLS = ["desired", "desired", "neutral", "bad", "bad"];
  const baseIdx = t =>
    ["Araxytes", "Smoke Devils"].includes(t.name) ? 0 :
    ["Hydras"].includes(t.name) ? 1 :
    ["Crawling Hands", "Cave Crawlers"].includes(t.name) ? 4 :
    ["Rockslugs", "Jellies"].includes(t.name) ? 3 :
    ["Turoth"].includes(t.name) ? null : 2; // Turoth unranked
  // rules: fewer-kills moves up a tier, superior jumps to tier 0,
  // clue jumps to tier 2, xp modifier locked (only 4 types roll)
  const rules = t => {
    const r = ["none" /* points */, t.qty[0] < 0 ? "up" : "none" /* qty */];
    if (t.clue) r.push(2); // clue unlocked, jumps to the middle tier
    r.push(0);             // superior unlocked, jumps to the top
    return r;              // xp NOT unlocked
  };
  const clsOf = idx => idx === null ? "neutral" : TIER_CLS[idx];

  const pool = TASKS.map(t => {
    const classes = rules(t).map(r => clsOf(resolveTier(baseIdx(t), r, TIER_CLS.length)));
    return { name: t.name, weight: t.weight, ...slotProbs(classes), task: t };
  });
  const o = computeOdds(pool, 3);

  const N = 300000;
  let hitD = 0, hitAB = 0;
  for (let it = 0; it < N; it++) {
    // draw 3 without replacement (the reroll-duplicates procedure)
    const left = pool.slice();
    let remW = left.reduce((s, t) => s + t.weight, 0);
    let anyD = false, allB = true;
    for (let j = 0; j < 3; j++) {
      let x = rand() * remW, idx = 0;
      while (x >= left[idx].weight) { x -= left[idx].weight; idx++; }
      const c = left.splice(idx, 1)[0];
      remW -= c.weight;
      const rs = rules(c.task);
      const eff = clsOf(resolveTier(baseIdx(c.task), rs[Math.floor(rand() * rs.length)], TIER_CLS.length));
      if (eff === "desired") anyD = true;
      if (eff !== "bad") allB = false;
    }
    if (anyD) hitD++;
    else if (allB) hitAB++;
  }
  // 3σ binomial tolerance
  const tolD = 3 * Math.sqrt(o.pDesired * (1 - o.pDesired) / N);
  const tolAB = 3 * Math.sqrt(o.pAllBad * (1 - o.pAllBad) / N) + 1e-4;
  check(`pDesired within 3σ of ${N} sims`, o.pDesired, hitD / N, tolD);
  check(`pAllBad within 3σ of ${N} sims`, o.pAllBad, hitAB / N, tolAB);
  check("outcomes partition 1 (mixed)", o.pDesired + o.pAllBad + o.pNeutral, 1, 1e-9);
}

// ————— per-tier hit probabilities —————

console.log("— tierHit —");
{
  // deterministic tiers, equal weights: tierHit[j] = 1 − C(n−c_j,k)/C(n,k)
  const n = 10, k = 3, tierOf = i => i % 4; // counts: tier0:3, tier1:3, tier2:2, tier3:2
  const pool = Array.from({ length: n }, (_, i) => {
    const tierProbs = [0, 0, 0, 0];
    tierProbs[tierOf(i)] = 1;
    return { name: "c" + i, weight: 5, dProb: tierOf(i) === 0 ? 1 : 0, bProb: 0, tierProbs };
  });
  const o = computeOdds(pool, k);
  const counts = [3, 3, 2, 2];
  counts.forEach((c, j) =>
    check(`tierHit[${j}] hypergeometric`, o.tierHit[j], 1 - binom(n - c, k) / binom(n, k), 1e-9));
  check("single desired tier: tierHit[0] = pDesired", o.tierHit[0], o.pDesired, 1e-12);

  // fractional tier probs, k=2, hand-computed: X lands t0 w.p. .5/t1 .5; Y always t1; Z t0 .25/t1 .75
  const pool2 = [
    { name: "X", weight: 10, dProb: 0.5, bProb: 0, tierProbs: [0.5, 0.5] },
    { name: "Y", weight: 20, dProb: 0, bProb: 0, tierProbs: [0, 1] },
    { name: "Z", weight: 10, dProb: 0.25, bProb: 0, tierProbs: [0.25, 0.75] },
  ];
  const pXY = (10 / 40) * (20 / 30) + (20 / 40) * (10 / 20);
  const pXZ = (10 / 40) * (10 / 30) + (10 / 40) * (10 / 30);
  const pYZ = (20 / 40) * (10 / 20) + (10 / 40) * (20 / 30);
  const hit0 = pXY * 0.5 + pXZ * (1 - 0.5 * 0.75) + pYZ * 0.25;
  const o2 = computeOdds(pool2, 2);
  check("fractional tierHit[0] hand-computed", o2.tierHit[0], hit0, 1e-12);
  check("fractional tierHit[0] = pDesired (t0 is the desired tier)", o2.tierHit[0], o2.pDesired, 1e-12);
  check("tierHit[1] hand-computed (only XZ can miss it)", o2.tierHit[1], 1 - pXZ * 0.5 * 0.25, 1e-12);

  // best-tier distribution
  check("bestTier[0] = tierHit[0] (nothing beats the top tier)", o2.bestTier[0], o2.tierHit[0], 1e-12);
  check("Σ bestTier = 1 (fully placed pool)", o2.bestTier.reduce((a, b) => a + b, 0), 1, 1e-12);
  // best = tier1 means every slot rolled tier1: XY (.5·1), XZ (.5·.75), YZ (1·.75)
  check("bestTier[1] hand-computed", o2.bestTier[1], pXY * 0.5 + pXZ * 0.375 + pYZ * 0.75, 1e-12);

  // deterministic 4-tier case: S_j hypergeometric, best = S_j − S_{j+1}
  const pool3 = Array.from({ length: 10 }, (_, i) => {
    const tierProbs = [0, 0, 0, 0];
    tierProbs[i % 4] = 1;
    return { name: "c" + i, weight: 5, dProb: i % 4 === 0 ? 1 : 0, bProb: 0, tierProbs };
  });
  const o3 = computeOdds(pool3, 3);
  // counts per tier: [3,3,2,2]; S_j = C(remaining_at_or_worse, 3)/C(10,3)
  const S = j => binom([10, 7, 4, 2, 0][j], 3) / binom(10, 3);
  for (let j = 0; j < 4; j++)
    check(`deterministic bestTier[${j}] = S_${j} − S_${j + 1}`, o3.bestTier[j], S(j) - S(j + 1), 1e-9);
}

// ————— degenerate tiers must be exactly 0 / 1, not a few ULPs off —————

console.log("— unreachable tier snaps to exact 0/1 —");
{
  // the real pool, everyone in the middle tier of three, k=3: the top tier
  // is unreachable, so P(nothing top-or-better) must be exactly 1 — summing
  // ~22k terms otherwise lands on 0.9999999999999999 and 1−p explodes
  const pool = TASKS.map(t => ({
    name: t.name, weight: t.weight, tierProbs: [0, 1, 0],
  }));
  const o = computeOdds(pool, 3);
  check("tierHit[0] is exactly 0", o.tierHit[0], 0, 0);
  check("tierGE[1] is exactly 1", o.tierGE[1], 1, 0);
  check("1 − tierGE[1] is exactly 0", 1 - o.tierGE[1], 0, 0);
  check("bestTier[1] is exactly 1", o.bestTier[1], 1, 0);
  check("p/(1−p) stays finite via the guard", 1 - o.tierGE[1] > 0 ? 1 / (1 - o.tierGE[1]) : 0, 0, 0);
  // and the reachable case still isn't snapped away
  const pool2 = TASKS.map((t, i) => ({
    name: t.name, weight: t.weight, tierProbs: i === 0 ? [1, 0, 0] : [0, 1, 0],
  }));
  const o2 = computeOdds(pool2, 3);
  check("a reachable tier keeps its real value", o2.tierHit[0] > 0.001 && o2.tierHit[0] < 0.999 ? 1 : 0, 1);
}

// ————— edge cases —————

console.log("— edge cases —");
{
  const empty = computeOdds([], 3);
  check("empty pool: pDesired", empty.pDesired, 0);
  check("empty pool: pAllBad", empty.pAllBad, 0);

  const two = computeOdds(binaryPool([["X", 10, "desired"], ["Y", 8, "bad"]]), 3);
  check("k clamps to n: both always offered", two.appear["X"] + two.appear["Y"], 2, 1e-12);
  check("k clamps to n: pDesired = 1", two.pDesired, 1);

  const allBad = computeOdds(binaryPool([["X", 10, "bad"], ["Y", 8, "bad"]]), 2);
  check("all-bad pool: pAllBad = 1", allBad.pAllBad, 1);

  // a bad creature with a 50% promote-to-desired modifier, alone, k=1
  const solo = computeOdds([{ name: "X", weight: 10, dProb: 0.5, bProb: 0.5 }], 1);
  check("solo mixed: pDesired", solo.pDesired, 0.5);
  check("solo mixed: pAllBad", solo.pAllBad, 0.5);
}

// ————— strategy formulas vs direct expectation series —————

console.log("— strategy stats vs truncated expectation series —");
{
  const o = { pDesired: 0.19, pAllBad: 0.03, pNeutral: 0.78 };
  const st = strategyStats(o, 100);
  let meanRolls = 0, meanSkips = 0;
  for (let m = 1; m < 2000; m++) {
    meanRolls += m * o.pDesired * Math.pow(1 - o.pDesired, m - 1);
    meanSkips += (m - 1) * (1 - o.pAllBad) * Math.pow(o.pAllBad, m - 1);
  }
  check("offersPerDesired = Σ m·p·(1−p)^(m−1)", st.offersPerDesired, meanRolls, 1e-9);
  check("skipUntilDesiredCost = 100·(offers−1)", st.skipUntilDesiredCost, 100 * (meanRolls - 1), 1e-6);
  check("patientSkipsPerTask = Σ (m−1)·(1−q)·q^(m−1)", st.patientSkipsPerTask, meanSkips, 1e-9);
  check("patientDesiredShare", st.patientDesiredShare, 0.19 / 0.97);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
