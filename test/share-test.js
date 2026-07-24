/* Share-code codec checks. Run: node test/share-test.js */
"use strict";
const fs = require("fs");
const path = require("path");
const { encode, decode } = require("../share.js");

let failures = 0;
function check(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "  ok " : "FAIL "} ${name}${cond || detail === undefined ? "" : "  " + detail}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const dataSrc = fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8");
const TASKS = JSON.parse(dataSrc.match(/const TASKS = (\[[\s\S]*\]);/)[1]);
const NAMES = TASKS.map(t => t.name);

const mastersSrc = fs.readFileSync(path.join(__dirname, "..", "masters.js"), "utf8");
const MASTERS = JSON.parse(mastersSrc.match(/const MASTERS = (\{[\s\S]*\});/)[1]);
const MT = Object.fromEntries(Object.entries(MASTERS).map(([k, v]) => [k, v.tasks.map(t => t.task)]));

// ————— round trip —————

console.log("— round trip —");
{
  const board = {
    level: 92, tasksDone: 75, venators: false, focusRank: 2,
    tiers: [
      { name: "S", creatures: ["Araxytes", "Smoke Devils"] },
      { name: "good", creatures: ["Hydras", "Gargoyles"] },
      { name: "if i must", creatures: NAMES.filter(n => !["Araxytes", "Smoke Devils", "Hydras", "Gargoyles", "Jellies"].includes(n)) },
      { name: "bad", creatures: ["Jellies"] },
    ],
    blocked: ["Drakes", "Turoth"],
    rules: { Kurask: { points: "up" }, Gargoyles: { sup: 1 }, Jellies: { xp: "down", clue: 3 } },
  };
  const code = encode(board, NAMES);
  const back = decode(code, NAMES);
  check("level survives", back.level === board.level);
  check("tasksDone survives", back.tasksDone === board.tasksDone);
  check("venators survives", back.venators === board.venators);
  check("focusRank survives", back.focusRank === board.focusRank);
  check("blocked survives", eq(back.blocked, board.blocked), JSON.stringify(back.blocked));
  check("tier names survive", eq(back.tiers.map(t => t.name), board.tiers.map(t => t.name)));
  check("tier membership survives", eq(back.tiers.map(t => t.creatures), board.tiers.map(t => t.creatures)));
  check("rules survive", eq(back.rules, board.rules), JSON.stringify(back.rules));
  check("every creature is placed exactly once",
    back.tiers.flatMap(t => t.creatures).length === NAMES.length);
  console.log(`     code is ${code.length} chars: ${code.slice(0, 48)}…`);
  check("code is url-safe", /^[A-Za-z0-9\-_]+$/.test(code));
  check("encode is deterministic", encode(board, NAMES) === code);
}

// ————— comparison settings (master, block slots, per-master blocks) —————

console.log("— comparison settings round trip —");
{
  const board = {
    level: 99, tasksDone: 100, venators: true, focusRank: 1,
    tiers: [{ name: "A", creatures: ["Hydras"] }, { name: "B", creatures: NAMES.filter(n => n !== "Hydras") }],
    blocked: [], rules: {},
    master: "konar", blockSlots: 5,
    masterBlocks: {
      duradel: ["Ankou", "Hellhounds"],
      konar: [MT.konar[0], MT.konar[3]],
      nieve: [],
    },
  };
  const back = decode(encode(board, NAMES, MT), NAMES, MT);
  check("selected master survives", back.master === "konar", back.master);
  check("block slots survive", back.blockSlots === 5, String(back.blockSlots));
  check("duradel blocks survive", eq(back.masterBlocks.duradel, ["Ankou", "Hellhounds"]), JSON.stringify(back.masterBlocks.duradel));
  check("konar blocks survive", eq(back.masterBlocks.konar, [MT.konar[0], MT.konar[3]]));
  check("empty list is omitted", !("nieve" in back.masterBlocks), JSON.stringify(back.masterBlocks));
  check("per-master lists stay separate",
    !eq(back.masterBlocks.duradel, back.masterBlocks.konar));

  // a task name that isn't in that master's list is dropped, not crashed on
  const ghost = { ...board, masterBlocks: { duradel: ["Ankou", "Definitely Not A Task"] } };
  const g = decode(encode(ghost, NAMES, MT), NAMES, MT);
  check("unknown master task dropped", eq(g.masterBlocks.duradel, ["Ankou"]), JSON.stringify(g.masterBlocks.duradel));
}

console.log("— older codes still decode —");
{
  // a 5-section code, as produced before the comparison panel existed
  const legacy = Buffer.from("M1~99.100.1.1~~Top:0;Rest:1~", "utf8").toString("base64url");
  let back = null, threw = false;
  try { back = decode(legacy, NAMES, MT); } catch (e) { threw = true; }
  check("legacy code decodes", !threw);
  check("legacy tiers intact", back && back.tiers.length === 2);
  check("legacy master is null", back && back.master === null, back && String(back.master));
  check("legacy blockSlots is null", back && back.blockSlots === null, back && String(back.blockSlots));
  check("legacy masterBlocks empty", back && eq(back.masterBlocks, {}));
  // decoding without the masterTasks argument at all must not throw
  let ok = true;
  try { decode(encode({ ...{
    level: 99, tasksDone: 100, venators: true, focusRank: 1,
    tiers: [{ name: "A", creatures: NAMES }], blocked: [], rules: {},
    master: "duradel", blockSlots: 3, masterBlocks: { duradel: ["Ankou"] },
  } }, NAMES, MT), NAMES); } catch (e) { ok = false; }
  check("decode without masterTasks is safe", ok);
}

// ————— tolerant input —————

console.log("— accepts pasted variants —");
{
  const board = {
    level: 99, tasksDone: 100, venators: true, focusRank: 1,
    tiers: [{ name: "A", creatures: ["Wyrms"] }, { name: "B", creatures: NAMES.filter(n => n !== "Wyrms") }],
    blocked: [], rules: {},
  };
  const code = encode(board, NAMES);
  const forms = {
    "bare code": code,
    "with #": "#" + code,
    "hash param": "#c=" + code,
    "full url": "https://example.com/mortimer/#c=" + code,
    "padded with spaces": "  " + code + "  ",
    "with a newline": code + "\n",
  };
  for (const [label, input] of Object.entries(forms)) {
    let ok = false;
    try { ok = decode(input, NAMES).tiers[0].creatures[0] === "Wyrms"; } catch (e) { ok = false; }
    check(label, ok);
  }
}

// ————— names with delimiters —————

console.log("— tier names with awkward characters —");
{
  const tricky = ["a:b,c;d~e", "100% 🐉", "  spaces  ", "<script>"];
  const board = {
    level: 5, tasksDone: 0, venators: true, focusRank: 1,
    tiers: tricky.map((name, i) => ({ name, creatures: i === 0 ? NAMES : [] })),
    blocked: [], rules: {},
  };
  const back = decode(encode(board, NAMES), NAMES);
  check("delimiters in names survive", eq(back.tiers.map(t => t.name), tricky.map(n => n.slice(0, 24))),
    JSON.stringify(back.tiers.map(t => t.name)));
}

// ————— rejection & clamping —————

console.log("— bad input —");
{
  const bad = ["", "   ", "not-a-code", "!!!!", Buffer.from("X9~1.1.1.1~~A:0~").toString("base64url")];
  for (const s of bad) {
    let threw = false;
    try { decode(s, NAMES); } catch (e) { threw = true; }
    check(`rejects ${JSON.stringify(s.slice(0, 18))}`, threw);
  }
  // out-of-range values clamp rather than corrupt the board
  const wild = Buffer.from("M1~999.-5.1.99~~T:0~", "utf8").toString("base64url");
  const back = decode(wild, NAMES);
  check("level clamps to 99", back.level === 99, String(back.level));
  check("tasksDone clamps to 0", back.tasksDone === 0, String(back.tasksDone));
  check("focusRank kept in range by the app's tier list", back.focusRank === 99);
  // unknown creature indices are dropped, not crashed on
  const ghost = Buffer.from("M1~99.100.1.1~zz~T:0,zz~zz:p=u", "utf8").toString("base64url");
  const g = decode(ghost, NAMES);
  check("unknown creature ignored in tiers", eq(g.tiers[0].creatures, [NAMES[0]]));
  check("unknown creature ignored in blocked", eq(g.blocked, []));
  check("unknown creature ignored in rules", eq(g.rules, {}));
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
