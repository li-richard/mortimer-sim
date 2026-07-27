/* Reward economics for Mortimer tasks — DOM-free so node can test it.
 *
 * Every task carries exactly one modifier, drawn uniformly from the types
 * unlocked and applicable to that creature. So an expected value is the
 * mean over those types, not a product of independent bonuses: a task
 * cannot have both the quantity and the XP modifier at once.
 *
 * Modifier value is taken as the midpoint of its published range.
 *
 * Sources for the fixed rates (OSRS Wiki):
 *   superior spawn      1/200, or 1/150 with elite Combat Achievements
 *   unique drop table   1/(200 − floor((SlayerReq+55)^2 / 125)) per superior
 *   imbued heart        1/8 of the first unique table
 *   => heart per superior = 1 / (8 * (200 − floor((req+55)^2 / 125)))
 */
(function (global) {
  "use strict";

  const SUPERIOR_SPAWN = 1 / 200;
  const SUPERIOR_SPAWN_ELITE_CA = 1 / 150;

  /* The yardstick for heart hunting. Jagex put Mortimer at 65–80 hours for
   * an imbued heart at the top end, so "hearts in 80 hours" reads directly
   * against that claim: 1.0 means roughly one heart in the window they
   * are aiming for. Unlike a per-task figure it is time-normalised, so a
   * long assignment doesn't flatter a slow creature. */
  const HEART_WINDOW_HOURS = 80;

  /** Imbued heart chance per superior kill, from the creature's Slayer requirement. */
  function heartPerSuperior(slayerReq) {
    const denom = 8 * (200 - Math.floor(Math.pow(slayerReq + 55, 2) / 125));
    return denom > 0 ? 1 / denom : 0;
  }

  const mid = range => (range ? (range[0] + range[1]) / 2 : 0);

  /** Which modifier types can roll on this creature, given progression. */
  function applicableMods(task, unlocked) {
    const mods = ["points", "qty"];
    if (task.clue && unlocked.clue) mods.push("clue");
    if (unlocked.xp) mods.push("xp");
    if (unlocked.sup) mods.push("sup");
    return mods;
  }

  /**
   * Expected rewards for one task of this creature.
   *   task    a row from data.js
   *   stat    the matching row from stats.js (may lack slayerXp)
   *   opts    { unlocked:{clue,xp,sup}, eliteCA:bool, kph:number|null }
   */
  function rewards(task, stat, opts) {
    const unlocked = (opts && opts.unlocked) || { clue: true, xp: true, sup: true };
    const spawn = opts && opts.eliteCA ? SUPERIOR_SPAWN_ELITE_CA : SUPERIOR_SPAWN;
    const kph = (opts && opts.kph) || null;

    const mods = applicableMods(task, unlocked);
    const baseQty = (task.assignMin + task.assignMax) / 2;
    const heart = heartPerSuperior(task.level);
    const xpPerKill = stat && stat.slayerXp ? Number(stat.slayerXp) : null;

    // average over which modifier lands, since exactly one does
    let qty = 0, xpMult = 0, supMult = 0, points = 0, clueMult = 0;
    for (const m of mods) {
      qty += (baseQty + (m === "qty" ? mid(task.qty) : 0)) / mods.length;
      xpMult += (1 + (m === "xp" ? mid(task.xp) / 100 : 0)) / mods.length;
      supMult += (1 + (m === "sup" ? mid(task.sup) / 100 : 0)) / mods.length;
      clueMult += (1 + (m === "clue" && task.clue ? mid(task.clue) / 100 : 0)) / mods.length;
      points += (m === "points" ? mid(task.pts) : 0) / mods.length;
    }

    // per hour depends only on kill rate, not on task length
    const xpPerTask = xpPerKill === null ? null : qty * xpPerKill * xpMult;
    const heartsPerTask = qty * spawn * heart * supMult;
    return {
      mods: mods.length,
      qty,
      xpPerKill,
      xpPerTask,
      xpPerHour: kph && xpPerKill !== null ? kph * xpPerKill * xpMult : null,
      heartPerSuperior: heart,
      heartsPerTask,
      heartsPerHour: kph ? kph * spawn * heart * supMult : null,
      heartsPerWindow: kph ? kph * spawn * heart * supMult * HEART_WINDOW_HOURS : null,
      tasksPerHeart: heartsPerTask > 0 ? 1 / heartsPerTask : Infinity,
      hoursPerHeart: kph && heartsPerTask > 0 ? 1 / (kph * spawn * heart * supMult) : null,
      pointsBonus: points,
      clueMult,
      xpMult,
      supMult,
    };
  }

  const MOD_LABELS = {
    points: "Slayer points", qty: "Task size", clue: "Clue scrolls",
    xp: "Slayer XP", sup: "Superior uniques",
  };

  /**
   * The same rewards, but split out per modifier instead of averaged —
   * what this task is worth GIVEN that modifier landed. The averaged
   * figures hide a wide spread: a Superior modifier can be worth several
   * times a points modifier on the same creature.
   */
  function rewardsByModifier(task, stat, opts) {
    const unlocked = (opts && opts.unlocked) || { clue: true, xp: true, sup: true };
    const spawn = opts && opts.eliteCA ? SUPERIOR_SPAWN_ELITE_CA : SUPERIOR_SPAWN;
    const kph = (opts && opts.kph) || null;

    const baseQty = (task.assignMin + task.assignMax) / 2;
    const heart = heartPerSuperior(task.level);
    const xpPerKill = stat && stat.slayerXp ? Number(stat.slayerXp) : null;

    return applicableMods(task, unlocked).map(m => {
      const range = m === "points" ? task.pts : m === "qty" ? task.qty
        : m === "clue" ? task.clue : m === "xp" ? task.xp : task.sup;
      const qty = baseQty + (m === "qty" ? mid(task.qty) : 0);
      const xpMult = 1 + (m === "xp" ? mid(task.xp) / 100 : 0);
      const supMult = 1 + (m === "sup" ? mid(task.sup) / 100 : 0);
      const heartsPerTask = qty * spawn * heart * supMult;
      return {
        key: m,
        label: MOD_LABELS[m],
        range,
        isPercent: m === "clue" || m === "xp" || m === "sup",
        qty,
        xpPerTask: xpPerKill === null ? null : qty * xpPerKill * xpMult,
        xpPerHour: kph && xpPerKill !== null ? kph * xpPerKill * xpMult : null,
        heartsPerTask,
        heartsPerHour: kph ? kph * spawn * heart * supMult : null,
        heartsPerWindow: kph ? kph * spawn * heart * supMult * HEART_WINDOW_HOURS : null,
        tasksPerHeart: heartsPerTask > 0 ? 1 / heartsPerTask : Infinity,
        hoursPerHeart: kph && heartsPerTask > 0 ? 1 / (kph * spawn * heart * supMult) : null,
        pointsBonus: m === "points" ? mid(task.pts) : 0,
      };
    });
  }

  const api = { rewards, rewardsByModifier, heartPerSuperior, applicableMods, MOD_LABELS,
                SUPERIOR_SPAWN, SUPERIOR_SPAWN_ELITE_CA, HEART_WINDOW_HOURS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.MortimerRewards = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
