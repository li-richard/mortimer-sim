/* Pure odds math for Mortimer's offer system. No DOM — usable from the
 * browser (window.MortimerMath) and from node (module.exports) so the
 * test suite can exercise exactly the code the app runs.
 *
 * Model assumptions (see README):
 *  - An offer set of k creatures is drawn by successive weighted draws
 *    without replacement — equivalent to "roll from the full pool,
 *    reroll duplicates", the natural reading of the no-duplicates rule.
 *  - Every task rolls exactly one modifier, uniformly among the types
 *    that are unlocked AND applicable to that creature (FAQ: equal
 *    chance; creatures without a clue modifier roll from the rest).
 *    Modifier rolls are independent between the tasks of one offer set
 *    (FAQ: different tasks can share a modifier).
 *  - Every new offer set (after a skip or a completed task) is an
 *    independent fresh roll.
 */
(function (global) {
  "use strict";

  /* ————— modifier promotion ————— */

  const TIER_UP = { bad: "neutral", neutral: "desired", desired: "desired" };

  /* rule: "none" | "tier" (+1 tier) | "neutral" (floor at neutral) |
   * "desired" (always desired). Rules only ever promote, never demote. */
  function promote(label, rule) {
    switch (rule) {
      case "tier": return TIER_UP[label];
      case "neutral": return label === "bad" ? "neutral" : label;
      case "desired": return "desired";
      default: return label;
    }
  }

  /* Effective per-slot outcome distribution for one creature: its base
   * verdict, promoted by whichever modifier lands on it. `rules` holds
   * one promotion rule per applicable unlocked modifier type (each
   * equally likely). Empty/absent rules = plain base verdict. */
  function slotProbs(label, rules) {
    if (!rules || rules.length === 0) {
      return { dProb: label === "desired" ? 1 : 0, bProb: label === "bad" ? 1 : 0 };
    }
    let d = 0, b = 0;
    for (const r of rules) {
      const eff = promote(label, r);
      if (eff === "desired") d++;
      else if (eff === "bad") b++;
    }
    return { dProb: d / rules.length, bProb: b / rules.length };
  }

  /* ————— offer-set odds ————— */

  /**
   * Exact enumeration of every ordered draw sequence.
   * pool: [{ name, weight, dProb, bProb }] — per-slot probabilities that
   *   the creature, with its rolled modifier, counts as desired / bad
   *   (dProb + bProb ≤ 1; the remainder is neutral).
   * offers: number of tasks presented (clamped to pool size).
   *
   * Modifier rolls are independent across the k slots, so for a fixed
   * creature set: P(no desired) = Π(1−dProb_i) and P(all bad) = Π bProb_i.
   *
   * Returns { k, n, pDesired, pAllBad, pNeutral, appear } where
   * appear[name] = P(name is among the k offered).
   */
  function computeOdds(pool, offers) {
    const n = pool.length;
    const k = Math.min(offers, n);
    const appear = {};
    if (k === 0) return { k, n, pDesired: 0, pAllBad: 0, pNeutral: 0, appear };

    const w = pool.map(t => t.weight);
    const d = pool.map(t => t.dProb);
    const b = pool.map(t => t.bProb);
    const totalW = w.reduce((a, x) => a + x, 0);
    const appearArr = new Array(n).fill(0);
    const used = new Array(n).fill(false);
    const chosen = [];
    let pDesired = 0, pAllBad = 0;

    (function rec(prob, remW, noDesired, allBad) {
      if (chosen.length === k) {
        pDesired += prob * (1 - noDesired);
        pAllBad += prob * allBad;
        for (const i of chosen) appearArr[i] += prob;
        return;
      }
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true; chosen.push(i);
        rec(prob * w[i] / remW, remW - w[i],
            noDesired * (1 - d[i]), allBad * b[i]);
        chosen.pop(); used[i] = false;
      }
    })(1, totalW, 1, 1);

    pool.forEach((t, i) => { appear[t.name] = appearArr[i]; });
    const pNeutral = Math.max(0, 1 - pDesired - pAllBad);
    return { k, n, pDesired, pAllBad, pNeutral, appear };
  }

  /**
   * Derived strategy metrics. Each offer roll is independent, so counts
   * of rolls until a given outcome are geometric.
   */
  function strategyStats({ pDesired, pAllBad, pNeutral }, skipCost) {
    return {
      // mean rolls until an offer contains a desired task
      offersPerDesired: pDesired > 0 ? 1 / pDesired : Infinity,
      // mean points spent skipping until a desired task appears
      skipUntilDesiredCost: pDesired > 0 ? skipCost * (1 - pDesired) / pDesired : Infinity,
      // taking desired when offered, neutral otherwise, skipping only
      // all-bad offers: share of completed tasks that are desired ...
      patientDesiredShare: (pDesired + pNeutral) > 0 ? pDesired / (pDesired + pNeutral) : NaN,
      // ... and mean skips paid per completed task
      patientSkipsPerTask: pAllBad < 1 ? pAllBad / (1 - pAllBad) : Infinity,
    };
  }

  const api = { computeOdds, strategyStats, promote, slotProbs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.MortimerMath = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
