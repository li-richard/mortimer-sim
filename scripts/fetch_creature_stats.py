#!/usr/bin/env python3
"""Pull per-creature combat/reward stats for Mortimer's task pool from the
OSRS Wiki and write data/creature_stats.csv (+ stats.js).

Three sources, all from the wiki:
  * infobox_monster bucket  -> Slayer XP per kill, HP, combat level
  * Superior slayer monster -> the normal -> superior pairing
  * Slayer training + money_making_guide -> kills/hour

Kills/hour is deliberately left blank when no guide covers that creature:
a wrong rate is worse than an absent one, and the app lets you type your
own. Rates that ARE filled in are quoted from the guide named in the
kph_source column.

Usage:  python3 scripts/fetch_creature_stats.py
"""
import csv
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://oldschool.runescape.wiki/api.php"
UA = "mortimer-sim (https://github.com/li-richard/mortimer-sim)"

# Task names that don't map to a monster page by simple de-pluralising.
# Warped Creatures covers several monsters; the Terrorbird is the
# representative used elsewhere in the app, and all three warped variants
# award similar Slayer XP (140–200).
NAME_OVERRIDES = {
    "Jellies": "Jelly",
    "Warped Creatures": "Warped Terrorbird",
}

# Money making guides that genuinely measure killing the task monster.
# Used only as a fallback where the Slayer training guide has no XP/h,
# because these describe profit methods rather than XP ones.
#
# Deliberately excluded: "Picking up drops from Greater Nechryael" is a
# loot run rather than a kill rate (143/h against the 100k XP/h barrage
# method), "Killing basilisk knights" is a different monster, and the
# boss guides (Thermonuclear Smoke Devil, Alchemical Hydra, Abyssal
# Sire) are not the task monster at all.
KPH_OVERRIDES = {
    "Cave Horrors": ("Killing cave horrors", None),
    "Drakes": ("Killing Drakes (Slayer)", None),
    "Gargoyles": ("Killing gargoyles", None),
    "Hydras": ("Killing hydras", None),
    "Kurask": ("Killing kurasks", None),
    "Wyrms": ("Killing Wyrms (Slayer)", None),
}


def get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=40))


def bucket(query):
    return get({"action": "bucket", "format": "json", "query": query})


def monsters_by_name():
    """Every monster's Slayer XP / HP / combat level, keyed by lowercase name."""
    fields = ["page_name", "page_name_sub", "name", "slayer_experience", "hitpoints", "combat_level"]
    sel = ",".join(map(repr, fields))
    out, offset = {}, 0
    while True:
        d = bucket(f"bucket('infobox_monster').select({sel})"
                   f".limit(500).offset({offset}).orderBy('page_name_sub','asc').run()")
        rows = d.get("bucket", [])
        for m in rows:
            name = m.get("name")
            if not isinstance(name, str):
                continue
            xp = m.get("slayer_experience")
            prev = out.get(name.lower())
            # keep the variant with the highest Slayer XP (superiors and
            # higher-level variants share a name in a few cases)
            if prev is None or (xp or 0) > (prev.get("slayer_experience") or 0):
                out[name.lower()] = m
        if len(rows) < 500:
            break
        offset += 500
        time.sleep(0.2)
    return out


def superior_pairs():
    """normal name -> superior name, parsed from the wiki's summary table."""
    txt = get({"action": "parse", "page": "Superior slayer monster",
               "prop": "wikitext", "format": "json"})["parse"]["wikitext"]["*"]
    pairs = {}
    for chunk in txt.split("\n|-"):
        links = re.findall(r"\[\[([^|\]]+)(?:\|([^\]]+))?\]\]", chunk)
        names = [(b or a).strip() for a, b in links if "File:" not in a]
        if len(names) >= 2:
            pairs[names[0].lower()] = names[1]
    return pairs


def mmg_kph():
    """activity name -> kills/hour, for guides measured in kills."""
    out, offset = {}, 0
    while True:
        d = bucket(f"bucket('money_making_guide').select('page_name','json')"
                   f".limit(500).offset({offset}).run()")
        rows = d.get("bucket", [])
        for r in rows:
            j = r.get("json")
            if isinstance(j, str):
                j = json.loads(j)
            prices = (j or {}).get("prices") or {}
            kph, label = prices.get("default_kph"), str(prices.get("kph_text", ""))
            if kph and "kill" in label.lower():
                activity = re.sub(r"\[\[([^|\]]*\|)?|\]\]", "", (j or {}).get("activity", ""))
                out[activity] = kph
        if len(rows) < 500:
            break
        offset += 500
        time.sleep(0.2)
    return out


def slayer_training_xp():
    """Approx. XP/h per assignment from the wiki's Slayer training guide.

    Values are method-labelled (Magic, cannon, melee...); we keep the best
    listed rate and its label, since that is what a player optimising for
    XP would actually do. Returns name -> (xp_per_hour, method).
    """
    txt = get({"action": "parse", "page": "Slayer training",
               "prop": "wikitext", "format": "json"})["parse"]["wikitext"]["*"]
    start = txt.find("==Task summary==")
    table = txt[start:txt.find("\n==", start + 10)]
    out = {}
    for row in table.split("\n|-")[1:]:
        cells = [c for c in re.split(r"\n\|(?!\})", row) if c.strip()]
        if len(cells) < 6:
            continue
        m = re.search(r"\[\[([^|\]]+)(?:\|([^\]]+))?\]\]", cells[0])
        if not m:
            continue
        name = (m.group(2) or m.group(1)).strip()
        cell = re.sub(r"<br\s*/?>", " ", cells[-1])
        vals = [(int(v.replace(",", "")), (lbl or "").strip())
                for v, lbl in re.findall(r"([\d][\d,]{3,})\s*(?:\(([^)]*)\))?", cell)]
        if vals:
            out[name.lower()] = max(vals, key=lambda v: v[0])
    return out


def main():
    tasks = json.loads(re.search(r"const TASKS = (\[[\s\S]*\]);",
                                 (ROOT / "data.js").read_text()).group(1))
    print(f"resolving stats for {len(tasks)} creatures…")
    mons, pairs, kph = monsters_by_name(), superior_pairs(), mmg_kph()
    xp_hr = slayer_training_xp()
    print(f"  {len(mons)} monsters · {len(pairs)} superior pairs · "
          f"{len(kph)} kill-rate guides · {len(xp_hr)} XP/h entries")

    rows = []
    for t in tasks:
        # the task name is plural ("Bloodvelds"); monster pages are singular
        cands = [NAME_OVERRIDES.get(t["name"], t["name"]), t["name"],
                 t["name"].rstrip("s"), t["name"].rstrip("s") + "e",
                 re.sub(r"ies$", "y", t["name"])]
        mon = next((mons[c.lower()] for c in cands if c.lower() in mons), None)
        sup_name = next((pairs[c.lower()] for c in cands if c.lower() in pairs), None)
        sup = mons.get((sup_name or "").lower())

        xp_per_kill = (mon or {}).get("slayer_experience")
        sup_xp = (sup or {}).get("slayer_experience")
        rate, source, note = "", "", None

        # Prefer the Slayer training guide's XP/h: it describes how people
        # actually train the task. Divide by the effective XP per kill —
        # normal plus the superior's share — because that published rate
        # is total XP earned, superiors included. Dividing by the plain
        # value would inflate our XP/hr back above the source by ~20%.
        if xp_per_kill:
            hit = next((xp_hr[c.lower()] for c in cands if c.lower() in xp_hr), None)
            if hit:
                effective = float(xp_per_kill) + (float(sup_xp) / 200 if sup_xp else 0)
                rate = round(hit[0] / effective)
                source = "Slayer training: {:,} XP/h".format(hit[0]) + (f" ({hit[1]})" if hit[1] else "")
                note = "derived from XP/h" + (f" using {hit[1]}" if hit[1] else "")

        # otherwise a money making guide that counts kills of this monster
        if not rate:
            guide, gnote = KPH_OVERRIDES.get(t["name"], (None, None))
            if guide and kph.get(guide):
                rate = kph[guide]
                source = f"money making guide: {guide}"
                note = gnote

        rows.append({
            "creature": t["name"],
            "slayer_level": t["level"],
            "slayer_xp": xp_per_kill or "",
            "hitpoints": (mon or {}).get("hitpoints") or "",
            "superior": sup_name or "",
            "superior_slayer_xp": sup_xp or "",
            "kph": rate,
            "kph_source": source,
            "kph_note": note or "",
        })
        flag = "" if rows[-1]["slayer_xp"] else "   <- no monster match"
        print(f"  {t['name']:20} xp={rows[-1]['slayer_xp'] or '?':>5} "
              f"sup={(sup_name or '?')[:24]:26} kph={rows[-1]['kph'] or '-'}{flag}")

    out = ROOT / "data" / "creature_stats.csv"
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    js = [{
        "name": r["creature"],
        "slayerXp": r["slayer_xp"] or None,
        "hp": r["hitpoints"] or None,
        "superior": r["superior"] or None,
        "superiorXp": r["superior_slayer_xp"] or None,
        "kph": r["kph"] or None,
        "kphSource": r["kph_source"] or None,
        "kphNote": r["kph_note"] or None,
    } for r in rows]
    (ROOT / "stats.js").write_text(
        "// Generated by scripts/fetch_creature_stats.py — do not edit by hand.\n"
        "// Sources: OSRS Wiki infobox_monster + money_making_guide buckets.\n"
        "const STATS = " + json.dumps(js, indent=2) + ";\n")
    print(f"\nwrote {out.relative_to(ROOT)} and stats.js "
          f"({sum(1 for r in rows if r['kph'])} of {len(rows)} have a sourced kill rate)")


if __name__ == "__main__":
    main()
