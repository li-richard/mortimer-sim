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

  /* ————— tier resolution ————— */

  /* Tiers are an ordered list, index 0 = best. A modifier rule moves a
   * task within it: "up" / "down" shift one tier (clamped at the ends),
   * a number jumps to that tier index (clamped), "none" stays put.
   * baseIdx === null means unranked — relative moves have nowhere to
   * start from and leave it unranked; absolute jumps still apply. */
  function resolveTier(baseIdx, rule, tierCount) {
    if (typeof rule === "number") return Math.max(0, Math.min(tierCount - 1, rule));
    if (baseIdx === null || baseIdx === undefined) return null;
    if (rule === "up") return Math.max(0, baseIdx - 1);
    if (rule === "down") return Math.min(tierCount - 1, baseIdx + 1);
    return baseIdx;
  }

  /* Effective per-slot outcome distribution for one creature: `classes`
   * holds the outcome class ("desired" | "neutral" | "bad") the task
   * ends up as under each of its applicable modifiers, one entry per
   * modifier, each equally likely to roll. */
  function slotProbs(classes) {
    if (!classes || classes.length === 0) return { dProb: 0, bProb: 0 };
    let d = 0, b = 0;
    for (const c of classes) {
      if (c === "desired") d++;
      else if (c === "bad") b++;
    }
    return { dProb: d / classes.length, bProb: b / classes.length };
  }

  /* ————— offer-set odds ————— */

  /**
   * Exact enumeration of every ordered draw sequence.
   * pool: [{ name, weight, dProb, bProb, tierProbs? }] — per-slot
   *   probabilities that the creature, with its rolled modifier, counts
   *   as desired / bad (dProb + bProb ≤ 1; the remainder is neutral).
   *   Optional tierProbs[j] = P(the rolled modifier lands the task in
   *   tier j); when present (same length on every entry) the result
   *   includes tierHit.
   * offers: number of tasks presented (clamped to pool size).
   *
   * Modifier rolls are independent across the k slots, so for a fixed
   * creature set: P(no desired) = Π(1−dProb_i) and P(all bad) = Π bProb_i,
   * and per tier j: P(no task in j) = Π(1−tierProbs_i[j]).
   *
   * Returns { k, n, pDesired, pAllBad, pNeutral, appear, tierHit } where
   * appear[name] = P(name is among the k offered) and
   * tierHit[j] = P(at least one offered task ends up in tier j).
   */
  function computeOdds(pool, offers) {
    const n = pool.length;
    const k = Math.min(offers, n);
    const appear = {};
    const m = n > 0 && Array.isArray(pool[0].tierProbs) ? pool[0].tierProbs.length : 0;
    if (k === 0) {
      return { k, n, pDesired: 0, pAllBad: 0, pNeutral: 0, appear,
               tierHit: m ? new Array(m).fill(0) : null };
    }

    const w = pool.map(t => t.weight);
    const d = pool.map(t => t.dProb);
    const b = pool.map(t => t.bProb);
    const tp = m ? pool.map(t => t.tierProbs) : null;
    // cum[i][j] = P(slot i lands in tier j or worse); cum[i][m] = 0
    const cum = m ? pool.map(t => {
      const c = new Array(m + 1).fill(0);
      for (let j = m - 1; j >= 0; j--) c[j] = c[j + 1] + t.tierProbs[j];
      return c;
    }) : null;
    const totalW = w.reduce((a, x) => a + x, 0);
    const appearArr = new Array(n).fill(0);
    const tierHit = m ? new Array(m).fill(0) : null;
    // tierGE[j] = P(every offered task lands in tier j or worse)
    const tierGE = m ? new Array(m + 1).fill(0) : null;
    const used = new Array(n).fill(false);
    const chosen = [];
    let pDesired = 0, pAllBad = 0;

    (function rec(prob, remW, noDesired, allBad, noTier, allGE) {
      if (chosen.length === k) {
        pDesired += prob * (1 - noDesired);
        pAllBad += prob * allBad;
        for (const i of chosen) appearArr[i] += prob;
        if (m) {
          for (let j = 0; j < m; j++) tierHit[j] += prob * (1 - noTier[j]);
          for (let j = 0; j <= m; j++) tierGE[j] += prob * allGE[j];
        }
        return;
      }
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true; chosen.push(i);
        rec(prob * w[i] / remW, remW - w[i],
            noDesired * (1 - d[i]), allBad * b[i],
            m ? noTier.map((x, j) => x * (1 - tp[i][j])) : null,
            m ? allGE.map((x, j) => x * cum[i][j]) : null);
        chosen.pop(); used[i] = false;
      }
    })(1, totalW, 1, 1,
       m ? new Array(m).fill(1) : null,
       m ? new Array(m + 1).fill(1) : null);

    pool.forEach((t, i) => { appear[t.name] = appearArr[i]; });
    const pNeutral = Math.max(0, 1 - pDesired - pAllBad);
    // bestTier[j] = P(the best task on offer lands exactly in tier j)
    const bestTier = m ? tierGE.slice(0, m).map((s, j) => Math.max(0, s - tierGE[j + 1])) : null;
    return { k, n, pDesired, pAllBad, pNeutral, appear, tierHit, tierGE, bestTier };
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

  const api = { computeOdds, strategyStats, resolveTier, slotProbs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.MortimerMath = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
