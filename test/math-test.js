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
 *   5. Invariants              — sum of appear[] must equal k; the three
 *      outcome probabilities must partition 1.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { computeOdds, strategyStats } = require("../math.js");

let failures = 0;
function check(name, actual, expected, tol = 1e-12) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "FAIL "} ${name}  ${actual}${ok ? "" : "  expected " + expected}`);
}

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

// ————— 1+2: full pool, cross-checked by exact complementary counting —————

console.log("— full 29-creature pool, k=3, vs exact complementary counting —");
{
  const desired = new Set(["Gargoyles", "Abyssal Demons"]);
  const bad = new Set(["Crawling Hands", "Cave Crawlers", "Rockslugs"]);
  const pool = TASKS.map(t => ({
    name: t.name, weight: t.weight,
    label: desired.has(t.name) ? "desired" : bad.has(t.name) ? "bad" : "neutral",
  }));
  const W = pool.reduce((s, t) => s + t.weight, 0);
  const k = 3;
  const o = computeOdds(pool, k);

  const nonDesired = pool.filter(t => t.label !== "desired").map(t => t.weight);
  const badW = pool.filter(t => t.label === "bad").map(t => t.weight);
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

// ————— 3: equal weights ⇒ uniform k-subset (hypergeometric closed form) —————

console.log("— equal weights reduce to C(n−d,k)/C(n,k) —");
for (const [n, d, b, k] of [[29, 3, 4, 3], [10, 2, 3, 2], [6, 1, 5, 3], [5, 2, 0, 2]]) {
  const pool = Array.from({ length: n }, (_, i) => ({
    name: "c" + i, weight: 7,
    label: i < d ? "desired" : i < d + b ? "bad" : "neutral",
  }));
  const o = computeOdds(pool, k);
  check(`n=${n} d=${d} k=${k}: pDesired`, o.pDesired, 1 - binom(n - d, k) / binom(n, k), 1e-9);
  check(`n=${n} d=${d} b=${b} k=${k}: pAllBad`, o.pAllBad, binom(b, k) / binom(n, k), 1e-9);
  check(`n=${n} k=${k}: appear = k/n`, o.appear["c0"], k / n, 1e-9);
}

// ————— 4: unequal weights, k=2, written out term by term —————

console.log("— hand-computed 4-creature pool, k=2 —");
{
  // A(8, desired), B(10, bad), C(10, neutral), D(12, bad); W = 40
  const pool = [
    { name: "A", weight: 8, label: "desired" },
    { name: "B", weight: 10, label: "bad" },
    { name: "C", weight: 10, label: "neutral" },
    { name: "D", weight: 12, label: "bad" },
  ];
  const o = computeOdds(pool, 2);
  const pA = 8 / 40 + (10 / 40) * (8 / 30) + (10 / 40) * (8 / 30) + (12 / 40) * (8 / 28);
  const pBD = (10 / 40) * (12 / 30) + (12 / 40) * (10 / 28);
  check("pDesired = P(A offered)", o.pDesired, pA);
  check("appear[A] = pDesired here", o.appear["A"], pA);
  check("pAllBad = P({B,D})", o.pAllBad, pBD);
}

// ————— edge cases —————

console.log("— edge cases —");
{
  const empty = computeOdds([], 3);
  check("empty pool: pDesired", empty.pDesired, 0);
  check("empty pool: pAllBad", empty.pAllBad, 0);

  const two = computeOdds([
    { name: "X", weight: 10, label: "desired" },
    { name: "Y", weight: 8, label: "bad" },
  ], 3); // offers clamp to pool size
  check("k clamps to n: both always offered", two.appear["X"] + two.appear["Y"], 2, 1e-12);
  check("k clamps to n: pDesired = 1", two.pDesired, 1);

  const allBad = computeOdds([
    { name: "X", weight: 10, label: "bad" },
    { name: "Y", weight: 8, label: "bad" },
  ], 2);
  check("all-bad pool: pAllBad = 1", allBad.pAllBad, 1);
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
