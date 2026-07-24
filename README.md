# mortimer-sim

Simulating outcomes for **Mortimer**, the new Old School RuneScape Slayer Master arriving with Wyrmscraig on **July 29, 2026**.

Source: [Meet Mortimer: Your Newest Slayer Master](https://secure.runescape.com/m=news/meet-mortimer-your-newest-slayer-master?oldschool=1) (news post, 24 July 2026).

## The app: Mortimer's Ledger

An interactive, dependency-free static site ([index.html](index.html), [app.js](app.js), [style.css](style.css)). Label each creature **✓ Desired**, **· Neutral**, or **✗ Bad**, block up to 2 (120 pts each), set your Slayer level / offer count (2, or 3 after 100 tasks) / Venators quest status, and it computes:

- P(next offer contains a desired task), P(neutral at best), P(all offers bad)
- Expected offers per desired task and average skip cost (100 pts/skip) to reach one
- Share of completed tasks that are desired under a patient strategy (skip only all-bad offers), and its point cost per task
- Per-creature chance of appearing in an offer

The math lives in [math.js](math.js) (shared between the browser and node) and enumerates every weighted draw-without-replacement sequence exactly (pool ≤ 29, offers ≤ 3) — no Monte Carlo error. Labels persist in `localStorage`.

### Model assumptions

- **Offer sets** are drawn by successive weighted draws without replacement — equivalent to "roll from the full pool, reroll duplicates", the natural implementation of the blog's no-duplicates rule. With equal weights this reduces to a uniform random subset.
- **Each offer roll is independent** (after a skip or a completed task, the next set is a fresh roll), so roll counts are geometric: mean rolls until a desired offer = 1/p, mean skips before it = (1−p)/p.
- **Patient strategy** (take desired if offered, else neutral, skip only all-bad sets): desired share of completed tasks = p_desired ∕ (p_desired + p_neutral); expected skips per completed task = p_allbad ∕ (1 − p_allbad).
- Not modeled: modifier types on offers (each unlocked type is equally likely, per the FAQ), the Slayer cape 10% same-task perk, and task storage.

### Tests

`node test/math-test.js` verifies the math by independent routes rather than re-running the same enumeration: exact BigInt-rational complementary counting (P(event) via P(complement) over restricted tuples), hypergeometric closed forms for the equal-weights case, term-by-term hand-computed small pools, edge cases, the Σ appear = k invariant, and strategy formulas against truncated expectation series.

Serve it from the repo root (any static server):

```bash
python3 -m http.server 8742 --directory /Users/richard/dev/mortimer-sim
```

`data.js` is generated from `data/mortimer_tasks.csv` — regenerate rather than editing by hand if the data changes.

## Goal

Model Mortimer's assignment system (task offers, weightings, guaranteed modifiers) to answer questions like:

- Expected Slayer XP/hr and Slayer points/hr vs. other masters
- Optimal pick strategy when offered 2 (later 3) tasks
- Time-to-Imbued-Heart estimates (Jagex ballpark: 65–80 hours at the top end with the third task choice unlocked, vs. 80–100 hours for current Turael-skip metas)
- Value of skips (100 pts) and blocks (120 pts each, max 2)

## Mechanics (from the blog)

**Unlock:** Reach Wyrmscraig during The Fallen From Grace quest, then 100 Combat + 70 Slayer, or 99 Slayer at any Combat level.

**Task offers**

- Mortimer offers a choice of **2 tasks** (a **3rd choice** unlocks after 100 completed tasks).
- No duplicate creatures within the same set of offers.
- Task weighting is **10** for every creature except a few strong ones reduced to **8** (Bloodvelds, Custodian Stalkers, Dust Devils, Nechryael, Abyssal Demons, Araxytes, Smoke Devils).
- All of Mortimer's creatures have Superior variants. Master-specific task unlocks don't apply (Gryphons, Aquanites, Basilisks etc. are available with no point investment); task **extensions do** apply.
- Venators are exclusive to Mortimer, gated behind the quest Blood Moon Rises (no Rewards Shop unlock needed).

**Modifiers ("Mortifiers")**

- **Every** task comes with exactly one guaranteed modifier.
- Once unlocked, each modifier type has an **equal chance** of appearing; different offers in the same set can share a modifier type.
- Modifier values roll in **increments of 5** within per-creature min/max ranges (see `data/mortimer_tasks.csv`).
- Quantity modifier is a **flat** adjustment (e.g. -50 = 50 fewer kills), not a percentage.
- Modifiers apply to the task's base value; existing in-game bonuses then apply on top.
- The Slayer XP modifier also boosts XP from Superior spawns.

| Tasks completed | Unlock |
|---|---|
| 0 | Slayer Point modifier |
| 0 | Task Quantity modifier |
| 25 | Clue Scroll modifier |
| 50 | Slayer XP modifier |
| 75 | Superior Unique (drop-table) modifier |
| 100 | Third task choice |

Note the 5th modifier boosts the chance to hit the **Superior unique drop table** (e.g. Imbued Heart), not the Superior spawn rate.

**Costs / constraints**

- Skipping an assignment: **100 Slayer points**. Turael cannot reset Mortimer tasks.
- Only **2 block slots** while using Mortimer, **120 points each**.
- Task storage works (shared with the normal store slots) and preserves modifiers.
- Slayer cape perk works: 10% chance of same task reassigned with the same length and modifiers.

## Data

- [data/mortimer_tasks_official_sheet.csv](data/mortimer_tasks_official_sheet.csv) — raw CSV export of the [official Google Sheet](https://docs.google.com/spreadsheets/d/e/2PACX-1vSE_OR6P95Ofk9Ud38dc5wS_skvr4ZfBR-BEgWcTd3TnNWHQe56iwIOrU_-CVtzr65AsPe2qLMN3Asc/pubhtml?gid=0&single=true), untouched.
- [data/mortimer_tasks.csv](data/mortimer_tasks.csv) — normalized single-header version for loading into code. `N/A` in clue columns means that creature has no Clue Scroll modifier available. All modifier ranges are inclusive min/max; percentage columns are in percent units (e.g. `25` = 25%).

Note: the blog page's HTML table lists Warped Creatures' quantity modifier as 50–100, but the official sheet says 30–80; we follow the sheet.
