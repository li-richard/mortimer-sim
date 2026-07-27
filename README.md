# mortimer-sim

Simulating outcomes for **Mortimer**, the new Old School RuneScape Slayer Master arriving with Wyrmscraig on **July 29, 2026**.

Source: [Meet Mortimer: Your Newest Slayer Master](https://secure.runescape.com/m=news/meet-mortimer-your-newest-slayer-master?oldschool=1) (news post, 24 July 2026, revised 27 July).

> ⚠️ **Pre-release data.** Every number here comes from that blog, where Jagex describes the modifier ranges as *proposed*. Wyrmscraig launches 29 July 2026 and the figures may change. Verify against the game before relying on them.

> Unofficial fan content. Not affiliated with or endorsed by Jagex. See [LICENSE](LICENSE) for how the code and the bundled artwork are licensed differently.

## The app: Mortimer's Ledger

An interactive, dependency-free static site ([index.html](index.html), [app.js](app.js), [style.css](style.css)). The primary interface is a TierMaker-style **tier board** of purely *ordinal* tiers — the top tier is the best, and rank alone carries meaning (no good/bad labels). Every creature starts in the middle tier. Drag chips between tiers (with a live insertion marker; manual order is preserved), drag a tier's ⠿ grip to reorder tiers, and add/rename/delete tiers freely. Chips show each creature's chance of appearing in an offer; clicking one opens a floating card with its stat ranges, a block toggle (max 2, 120 pts each), and its per-modifier rules (tier changes are drag-only). Set your Slayer level, Venators quest status, and **tasks completed for Mortimer** — progression is automatic, so that one number derives which modifier types are unlocked (clue at 15, Superior at 25, XP at 40) and whether you get a third task choice (50). The results card then computes, for whichever tier you focus:

- P(next offer contains a task landing in the focused tier), and in that tier *or better*
- The exact distribution of the best tier on offer (one bar segment per tier)
- Expected offers until a focused-tier task appears, and the average skip cost (100 pts/skip) to get there
- Per-tier hit chances in each tier row, and per-creature offer chances on each chip

**Per-task Mortifier rules** (click any chip): every offered task carries exactly one modifier, so for each creature you can declare that a given modifier moves it on the tier board — **▲ up one tier**, **▼ down one tier**, or **→ any specific tier**. Relative moves clamp at the board's ends. The card shows that creature's actual rolled ranges (e.g. Bloodveld's Superior modifier is +100–150%) and its chance of being moved up (▲) or down (▼) by whatever modifier rolls — uniform over applicable types per the FAQ, independent between the tasks of one offer. Creatures with no clue table roll from their remaining modifier types. Deleting a tier moves its creatures to the middle tier and clears rules that pointed at it.

The math lives in [math.js](math.js) (shared between the browser and node) and enumerates every weighted draw-without-replacement sequence exactly (pool ≤ 29, offers ≤ 3) — no Monte Carlo error. The whole board persists in `localStorage`.

### vs Turael skipping

The results card compares Mortimer against the current meta — take a Duradel task, and if it isn't the one you want, get a quick task from Turael to reroll. Both sides are measured the same way: **the chance one roll lands in your focused tier or better**, and how many rolls that implies (1∕p).

What differs is the currency. Mortimer charges **100 points per skip**; Turael skipping costs **no points but resets your task streak** every time, plus the filler task itself. The panel quotes each in its own terms rather than pretending they're interchangeable.

Pick the master to compare against — **Duradel** (42 tasks), **Konar quo Maten** (39, the only source of Hydras) or **Nieve / Steve** (46). Their weights come from the OSRS Wiki's `/Slayer_assignments` tables ([data/master_tasks.csv](data/master_tasks.csv) → `masters.js`).

**Block lists are per master**, matching the game — each master keeps its own list, and only Turael/Aya/Spria share one. Expand the block editor to toggle any of that master's tasks, including ones outside Mortimer's pool (blocking Ankou or Hellhounds is a real part of the meta). The slot count is account-wide: one per 50 quest points up to 300, plus one for the Elite Lumbridge & Draynor Diary, so **7 max** — set yours in the editor. Mortimer's own two 120-point slots are separate, set with the ⛨ toggle on a creature card.

Modelling notes:

- These masters have **no modifiers**, so a creature counts only by where it sits on the board — no promotions.
- Blocked tasks leave the pool entirely, which is how the game's own task-weight formula treats them.
- Tasks needing a Rewards Shop unlock (TzHaar, boss tasks, …) are **excluded**, since Mortimer grants his equivalents for free. Tasks above your Slayer level are excluded too.
- **Only 16–19 of each master's tasks overlap Mortimer's pool.** The rest (Ankou, Cave Kraken, Hellhounds, …) can't be tiered, so they count as misses — the honest reading of a board that says which creatures you want.
- Combat level is not modelled; these masters already require high Combat.

## The Rewards page

[rewards.html](rewards.html) puts a number on what each task is actually worth. It reads the same saved board, so your tiers and progression carry over.

Because **exactly one modifier lands per task**, every figure is a mean over the modifier types that can roll on that creature — not every bonus applied at once. Unlocking more types therefore *dilutes* any single one, which the numbers reflect.

| Column | How it's derived |
|---|---|
| Qty | Average assignment size, plus the quantity modifier weighted by how often it rolls |
| Kills / hr | **Editable.** Seeded from the wiki's money making guides where one covers that creature |
| XP / hr | Kill rate × XP per kill × expected XP multiplier — independent of task length |
| Hearts / task | Qty × 1/200 superior spawn (1/150 with elite CAs) × `1 / (8 × (200 − ⌊(req+55)²/125⌋))` × the Superior-unique modifier. Hover for the same figure as one-heart-per-N-tasks |
| +Pts | Average Slayer points added by the points modifier |

Set a **threshold** on any metric to mark which tasks clear your bar; rows that pass are highlighted and the rest dim.

**Click a row to expand it into one line per modifier** — what the task is worth *if that modifier lands*, next to the rule saying where it should send the task, and the tier it ends up in. This is where the averaging on the parent row comes apart: on Araxytes the XP modifier is worth 1.08x the average, and on creatures with a big Superior range the spread is much wider. Base tier is a picker on the parent row, so you can rank by XP/hr and set both the tier and its modifier rules without leaving the table; everything writes straight to your board.

**On kill rates.** The wiki publishes no per-monster kills/hour table, so `scripts/fetch_creature_stats.py` builds one from two wiki sources, in order:

1. **Money making guides** — `default_kph` where a guide covers the task monster (8 creatures). A direct count of kills.
2. **[Slayer training](https://oldschool.runescape.wiki/w/Slayer_training) → Task summary** — the "Approx. XP/h" column, divided by that creature's Slayer XP per kill (9 more). These are *effective* kills/hour: the best listed method is used, so multi-target barrage and cannon rates are included, which is right for both XP and superior rolls since every kill rolls for a superior.

That covers **17 of 29**; the remaining 12 are left blank rather than invented, and per-hour columns stay empty until a rate is set. Every seeded rate carries its source and method in the field's tooltip, and anything you type is marked as yours and saved.

Three sourced rates are approximations flagged in the data: Nechryael uses the Greater Nechryael guide, Basilisks uses Basilisk Knights, and Warped Creatures uses the Warped-creature task rate (the task covers several monsters).

Slayer XP per kill comes from the wiki's `infobox_monster` bucket (28 of 29 — Custodian Stalkers has no infobox yet, being new content). Regenerate everything with:

```bash
python3 scripts/fetch_creature_stats.py
```

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

`node test/math-test.js && node test/share-test.js && node test/rewards-test.js`

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
| 15 | Clue Scroll modifier |
| 25 | Superior Unique (drop-table) modifier |
| 40 | Slayer XP modifier |
| 50 | Third task choice |

Thresholds were roughly halved — and Superior moved ahead of XP — in the **27 July feedback update**, which also raised **Venators'** Superior-unique modifier from 50–100% to **200–300%**. That update supersedes the older unlock table and creature table still shown further down the same blog post, and the published spreadsheet has not been revised to match.

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
