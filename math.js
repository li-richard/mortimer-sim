/* Pure odds math for Mortimer's offer system. No DOM — usable from the
 * browser (window.MortimerMath) and from node (module.exports) so the
 * test suite can exercise exactly the code the app runs.
 *
 * Model assumptions (see README):
 *  - An offer set of k creatures is drawn by successive weighted draws
 *    without replacement — equivalent to "roll from the full pool,
 *    reroll duplicates", the natural reading of the no-duplicates rule.
 *  - Every new offer set (after a skip or a completed task) is an
 *    independent fresh roll.
 */
(function (global) {
  "use strict";

  /**
   * Exact enumeration of every ordered draw sequence.
   * pool: [{ name, weight, label }] with label in "desired"|"neutral"|"bad"
   * offers: number of tasks presented (clamped to pool size)
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
    const lab = pool.map(t => t.label);
    const totalW = w.reduce((a, b) => a + b, 0);
    const appearArr = new Array(n).fill(0);
    const used = new Array(n).fill(false);
    const chosen = [];
    let pDesired = 0, pAllBad = 0;

    (function rec(prob, remW, hasDesired, allBad) {
      if (chosen.length === k) {
        if (hasDesired) pDesired += prob;
        else if (allBad) pAllBad += prob;
        for (const i of chosen) appearArr[i] += prob;
        return;
      }
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true; chosen.push(i);
        rec(prob * w[i] / remW, remW - w[i],
            hasDesired || lab[i] === "desired", allBad && lab[i] === "bad");
        chosen.pop(); used[i] = false;
      }
    })(1, totalW, false, true);

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

  const api = { computeOdds, strategyStats };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.MortimerMath = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
