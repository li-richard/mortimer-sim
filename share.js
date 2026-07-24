/* Compact share codes for a Mortimer's Ledger board.
 *
 * A code is base64url of a small delimited string, so it pastes as one
 * opaque token. Creatures are referenced by their index in the task list
 * (base36) and tiers by rank, so nothing depends on internal ids.
 *
 *   M1~<level>.<tasksDone>.<venators>.<focusRank>~<blocked>~<tiers>~<rules>
 *     ~<master>.<blockSlots>~<masterBlocks>
 *
 * tiers:  name:idx,idx;name:idx      (names percent-encoded)
 * rules:  idx:k=v,k=v;idx:k=v        (k in p q c x s; v in u d 1..n)
 * masterBlocks: key:idx,idx;key:idx  (idx into that master's task list)
 *
 * The last two sections were added after the first release; codes without
 * them still decode, so old share codes keep working.
 *
 * No DOM here — test/share-test.js exercises it in node.
 */
(function (global) {
  "use strict";

  const MAGIC = "M1";
  const MOD_CODE = { points: "p", qty: "q", clue: "c", xp: "x", sup: "s" };
  const CODE_MOD = Object.fromEntries(Object.entries(MOD_CODE).map(([k, v]) => [v, k]));

  const b64urlEncode = s => {
    const b64 = typeof btoa !== "undefined"
      ? btoa(String.fromCharCode(...new TextEncoder().encode(s)))
      : Buffer.from(s, "utf8").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const b64urlDecode = s => {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof atob !== "undefined") {
      const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
      return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
    }
    return Buffer.from(b64, "base64").toString("utf8");
  };

  const n36 = n => n.toString(36);
  const p36 = s => parseInt(s, 36);

  /**
   * board: {
   *   level, tasksDone, venators (bool), focusRank (1-based),
   *   tiers: [{ name, creatures: [creatureName] }],
   *   blocked: [creatureName],
   *   rules: { creatureName: { points|qty|clue|xp|sup: "up"|"down"|<rank> } }
   * }
   * names: the canonical creature-name list (index = id)
   * masterTasks: { masterKey: [taskName, …] } for the comparison blocks
   */
  function encode(board, names, masterTasks) {
    const idx = Object.fromEntries(names.map((n, i) => [n, i]));
    const head = [
      board.level, board.tasksDone, board.venators ? 1 : 0, board.focusRank,
    ].join(".");
    const blocked = (board.blocked || [])
      .filter(n => n in idx).map(n => n36(idx[n])).join(",");
    const tiers = (board.tiers || []).map(t =>
      // encodeURIComponent leaves ~ alone, and ~ is our section delimiter
      encodeURIComponent(t.name).replace(/~/g, "%7E") + ":" +
      (t.creatures || []).filter(n => n in idx).map(n => n36(idx[n])).join(",")
    ).join(";");
    const rules = Object.entries(board.rules || {})
      .filter(([n]) => n in idx)
      .map(([n, r]) => {
        const parts = Object.entries(r)
          .filter(([k, v]) => MOD_CODE[k] && v !== undefined && v !== null)
          .map(([k, v]) => MOD_CODE[k] + "=" +
            (v === "up" ? "u" : v === "down" ? "d" : n36(Number(v))));
        return parts.length ? n36(idx[n]) + ":" + parts.join(",") : "";
      })
      .filter(Boolean).join(";");
    const cmp = [board.master || "", board.blockSlots ?? ""].join(".");
    const mt = masterTasks || {};
    const mBlocks = Object.entries(board.masterBlocks || {})
      .map(([k, list]) => {
        const idx = Object.fromEntries((mt[k] || []).map((n, i) => [n, i]));
        const ids = (list || []).filter(n => n in idx).map(n => n36(idx[n]));
        return ids.length ? `${k}:${ids.join(",")}` : "";
      })
      .filter(Boolean).join(";");
    return b64urlEncode([MAGIC, head, blocked, tiers, rules, cmp, mBlocks].join("~"));
  }

  /** Returns a board object, or throws if the code isn't one of ours. */
  function decode(code, names, masterTasks) {
    const raw = String(code || "").trim()
      // tolerate a pasted URL or a leading #
      .replace(/^.*[#?]c=/, "").replace(/^#/, "").replace(/[^A-Za-z0-9\-_]/g, "");
    if (!raw) throw new Error("empty code");
    let text;
    try { text = b64urlDecode(raw); } catch (e) { throw new Error("not a valid code"); }
    const [magic, head = "", blocked = "", tiers = "", rules = "", cmp = "", mBlocks = ""] = text.split("~");
    if (magic !== MAGIC) throw new Error("not a Mortimer's Ledger code");

    const [level, tasksDone, venators, focusRank] = head.split(".");
    const valid = new Set(names);
    const nameAt = i => names[i];

    const board = {
      level: clamp(Number(level), 1, 99, 99),
      tasksDone: clamp(Number(tasksDone), 0, 999, 100),
      venators: venators !== "0",
      focusRank: clamp(Number(focusRank), 1, 99, 1),
      blocked: blocked ? blocked.split(",").map(p36).map(nameAt).filter(n => valid.has(n)) : [],
      tiers: tiers ? tiers.split(";").map(seg => {
        const at = seg.indexOf(":");
        const name = decodeURIComponent(at === -1 ? seg : seg.slice(0, at));
        const list = at === -1 ? "" : seg.slice(at + 1);
        return {
          name: name.slice(0, 24) || "Tier",
          creatures: list ? list.split(",").map(p36).map(nameAt).filter(n => valid.has(n)) : [],
        };
      }) : [],
      rules: {},
    };
    if (!board.tiers.length) throw new Error("code has no tiers");

    for (const seg of rules ? rules.split(";") : []) {
      const [who, list] = seg.split(":");
      const name = nameAt(p36(who));
      if (!valid.has(name) || !list) continue;
      const r = {};
      for (const pair of list.split(",")) {
        const [k, v] = pair.split("=");
        const mod = CODE_MOD[k];
        if (!mod || !v) continue;
        if (v === "u") r[mod] = "up";
        else if (v === "d") r[mod] = "down";
        else {
          const rank = p36(v);
          if (rank >= 1 && rank <= board.tiers.length) r[mod] = rank;
        }
      }
      if (Object.keys(r).length) board.rules[name] = r;
    }

    // comparison settings (absent in pre-comparison codes)
    const [master, slots] = cmp.split(".");
    board.master = master || null;
    board.blockSlots = slots === "" || slots === undefined ? null : clamp(Number(slots), 0, 7, null);
    board.masterBlocks = {};
    const mt = masterTasks || {};
    for (const seg of mBlocks ? mBlocks.split(";") : []) {
      const [key, list] = seg.split(":");
      const tasks = mt[key];
      if (!tasks || !list) continue;
      const picked = list.split(",").map(p36).map(i => tasks[i]).filter(Boolean);
      if (picked.length) board.masterBlocks[key] = picked;
    }
    return board;
  }

  function clamp(v, lo, hi, dflt) {
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt;
  }

  const api = { encode, decode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.MortimerShare = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
