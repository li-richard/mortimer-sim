# mortimer-sim

Simulating outcomes for **Mortimer**, the new Old School RuneScape Slayer Master arriving with Wyrmscraig on **July 29, 2026**.

Source: [Meet Mortimer: Your Newest Slayer Master](https://secure.runescape.com/m=news/meet-mortimer-your-newest-slayer-master?oldschool=1) (news post, 24 July 2026).

> ⚠️ **Pre-release data.** Every number here comes from that blog, where Jagex describes the modifier ranges as *proposed*. Wyrmscraig launches 29 July 2026 and the figures may change. Verify against the game before relying on them.

> Unofficial fan content. Not affiliated with or endorsed by Jagex. See [LICENSE](LICENSE) for how the code and the bundled artwork are licensed differently.

## The app: Mortimer's Ledger

An interactive, dependency-free static site ([index.html](index.html), [app.js](app.js), [style.css](style.css)). The primary interface is a TierMaker-style **tier board** of purely *ordinal* tiers — the top tier is the best, and rank alone carries meaning (no good/bad labels). Every creature starts in the middle tier. Drag chips between tiers (with a live insertion marker; manual order is preserved), drag a tier's ⠿ grip to reorder tiers, and add/rename/delete tiers freely. Chips show each creature's chance of appearing in an offer; clicking one opens a floating card with its stat ranges, a block toggle (max 2, 120 pts each), and its per-modifier rules (tier changes are drag-only). Set your Slayer level, Venators quest status, and **tasks completed for Mortimer** — progression is automatic, so that one number derives which modifier types are unlocked (clue at 25, XP at 50, Superior at 75) and whether you get a third task choice (100). The results card then computes, for whichever tier you focus:

- P(next offer contains a task landing in the focused tier), and in that tier *or better*
- The exact distribution of the best tier on offer (one bar segment per tier)
- Expected offers until a focused-tier task appears, and the average skip cost (100 pts/skip) to get there
- Per-tier hit chances in each tier row, and per-creature offer chances on each chip

**Per-task Mortifier rules** (click any chip): every offered task carries exactly one modifier, so for each creature you can declare that a given modifier moves it on the tier board — **▲ up one tier**, **▼ down one tier**, or **→ any specific tier**. Relative moves clamp at the board's ends. The card shows that creature's actual rolled ranges (e.g. Bloodveld's Superior modifier is +100–150%) and its chance of being moved up (▲) or down (▼) by whatever modifier rolls — uniform over applicable types per the FAQ, independent between the tasks of one offer. Creatures with no clue table roll from their remaining modifier types. Deleting a tier moves its creatures to the middle tier and clears rules that pointed at it.

The math lives in [math.js](math.js) (shared between the browser and node) and enumerates every weighted draw-without-replacement sequence exactly (pool ≤ 29, offers ≤ 3) — no Monte Carlo error. The whole board persists in `localStorage`.

### Share codes

**Copy share code** puts the whole board — tiers and their order, every creature's placement, modifier rules, blocks, Slayer level, tasks completed, Venators and the focused tier — into one url-safe string (~150 characters for a full board). **Paste share code** accepts the bare code, a `#c=…` fragment, or a full URL containing one. Opening `…/index.html#c=<code>` loads that board directly and then cleans the URL, so a code doubles as a share link.

The codec is [share.js](share.js) (DOM-free, tested by [test/share-test.js](test/share-test.js)). Creatures are referenced by index in the task list and tiers by rank, so codes don't depend on internal ids. Unknown creature indices, out-of-range numbers, and non-Mortimer codes are rejected or clamped rather than corrupting the board.

### Model assumptions

- **Offer sets** are drawn by successive weighted draws without replacement — equivalent to "roll from the full pool, reroll duplicates", the natural implementation of the blog's no-duplicates rule. With equal weights this reduces to a uniform random subset.
- **Each offer roll is independent** (after a skip or a completed task, the next set is a fresh roll), so roll counts are geometric: mean rolls until the focused tier appears = 1/p, mean skips before it = (1−p)/p.
- **Skip economics** assume you skip every offer containing nothing in the focused tier or better: expected skips per kept offer = p_nothing ∕ (1 − p_nothing), priced at 100 points each.
- **Modifier unlocks are progression, not choices.** The blog says modifiers unlock as you complete assignments, at fixed counts — you cannot decline one. Because each unlocked type is equally likely, unlocking *dilutes* any single type: a given modifier rolls 1-in-2 with two types unlocked and 1-in-5 with five. So a rule keyed to one modifier fires less often later in progression, even though the newly unlocked modifiers carry their own value. That dilution is real; the ability to avoid it is not.
- Not modeled: the Slayer cape 10% same-task perk, and task storage.

### Tests

`node test/math-test.js && node test/share-test.js`

The math suite verifies the odds by independent routes rather than re-running the same enumeration: exact BigInt-rational complementary counting (P(event) via P(complement) over restricted tuples), hypergeometric closed forms for the equal-weights case, term-by-term hand-computed small pools, edge cases, the Σ appear = k invariant, and strategy formulas against truncated expectation series.

Serve it from the repo root (any static server):

```bash
python3 -m http.server 8742
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

## Creature art

`assets/creatures/*.png` are 120px thumbnails pulled from the [Old School RuneScape Wiki](https://oldschool.runescape.wiki), used under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/); the game assets depicted are the property of Jagex Ltd. They are stored locally so the app has no runtime dependency on the wiki. `assets/creatures/sources.json` records the source URL and byte size for each file, and the filename is the creature's slug — chips fall back to text alone if a file is missing. Full terms, including what carries over if you redistribute them, are in [assets/creatures/ATTRIBUTION.md](assets/creatures/ATTRIBUTION.md).

Two mappings are approximations, since the wiki has no single image for the task: **Warped Creatures** uses the [Warped Terrorbird](https://oldschool.runescape.wiki/w/Warped_Terrorbird), and **Custodian Stalkers** uses the baby custodian stalker (no adult image exists yet).

## Data

- [data/mortimer_tasks_official_sheet.csv](data/mortimer_tasks_official_sheet.csv) — raw CSV export of the [official Google Sheet](https://docs.google.com/spreadsheets/d/e/2PACX-1vSE_OR6P95Ofk9Ud38dc5wS_skvr4ZfBR-BEgWcTd3TnNWHQe56iwIOrU_-CVtzr65AsPe2qLMN3Asc/pubhtml?gid=0&single=true), untouched.
- [data/mortimer_tasks.csv](data/mortimer_tasks.csv) — normalized single-header version for loading into code. `N/A` in clue columns means that creature has no Clue Scroll modifier available. All modifier ranges are inclusive min/max; percentage columns are in percent units (e.g. `25` = 25%).

Note: the blog page's HTML table lists Warped Creatures' quantity modifier as 50–100, but the official sheet says 30–80; we follow the sheet.

## License

The source code is MIT licensed — see [LICENSE](LICENSE).

The bundled creature artwork is **not** MIT: it is CC BY-NC-SA 3.0 material from the Old School RuneScape Wiki, depicting assets owned by Jagex Ltd. If you fork or redistribute this project, those terms travel with the images — credit the wiki, keep the use non-commercial, and share alike. Removing `assets/creatures/` leaves the app fully functional (chips render as text).
