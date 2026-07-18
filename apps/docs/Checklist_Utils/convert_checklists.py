#!/usr/bin/env python3
"""
Convert the 4 completed checklist workbooks (Rail/Water/Air/Land) into
canonical ChecklistTemplate `definition` JSON for the UD Transport
E-form redesign (Session E1 schema).

Hierarchy produced:
  groups[]              (A1) ...
    items[]             (A1.1) ...          <- the current system's "item"
      subItems[]        1. ลักษณะ criterion
        subItems[]      1.1 sub-criterion   (optional)

Leaf answerType:
  presence_standard  -> มี/ไม่มี + ได้มาตรฐาน/ไม่ได้มาตรฐาน
  presence           -> มี/ไม่มี only (ได้มาตรฐาน cells grayed in source)

E-column semantics resolved per leaf:
  blank / '-'            -> none flagged
  'Yes'                  -> every leaf of the row flagged
  'Yes (All)'            -> every leaf of the row flagged
  'Yes (Only a, b)'      -> only listed codes flagged
  'Yes (a-b)' / '(a.b-a.c)' -> numeric range flagged
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl

RE_CITE = re.compile(r"\s*\[cite[^\]]*\]?", re.I)
RE_GROUP = re.compile(r"^\(?([A-Z]\d*)\)\s*(.*)$")
RE_ITEM = re.compile(r"^\(?([A-Z]\d*\.\d+)\)\s*(.*)$")
RE_L1 = re.compile(r"^(\d+)\.\s*(.*)$", re.S)
RE_L2 = re.compile(r"^(\d+\.\d+)\s+(.*)$", re.S)
RE_NUM = re.compile(r"(\d+(?:\.\d+)?)")


def clean(s):
    if s is None:
        return ""
    s = RE_CITE.sub("", str(s))
    s = unicodedata.normalize("NFC", s)
    return re.sub(r"[ \t]+", " ", s).strip()


def parse_flag(e_val, leaf_codes):
    """Return the set of leaf numbers (strings like '2.1' or '4') the
    E-column flags as no-standard-needed, resolved against this row's
    actual leaf numbers."""
    e = clean(e_val)
    if not e or e in ("-",):
        return set()
    if not e.lower().startswith("yes"):
        return set()
    inner = re.search(r"\((.*?)\)", e)
    if not inner:
        return set(leaf_codes)  # plain "Yes"
    body = inner.group(1).strip()
    if body.lower() in ("all",):
        return set(leaf_codes)
    body = re.sub(r"(?i)^only\s*", "", body)
    flagged = set()
    for part in re.split(r"[,;]\s*", body):
        part = part.strip()
        rng = re.match(r"^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$", part)
        if rng:
            a, b = rng.group(1), rng.group(2)
            # range over x.y codes with same major, or over integers
            for code in leaf_codes:
                try:
                    if _num_in_range(code, a, b):
                        flagged.add(code)
                except ValueError:
                    pass
        else:
            m = RE_NUM.match(part)
            if m and m.group(1) in leaf_codes:
                flagged.add(m.group(1))
    return flagged


def _num_in_range(code, a, b):
    def key(x):
        p = x.split(".")
        return tuple(int(q) for q in p)
    return key(a) <= key(code) <= key(b)


def split_d_cell(d_text):
    """A D cell may contain several 'x.y ...' sub-criteria separated by
    newlines. Return list of (code, text)."""
    d = clean(d_text)
    if not d or d == "-":
        return []
    parts = []
    # split at every occurrence of a leading x.y marker on a new segment
    chunks = re.split(r"(?:^|\n)\s*(?=\d+\.\d+\s)", str(d_text))
    for ch in chunks:
        ch = clean(ch)
        if not ch:
            continue
        m = RE_L2.match(ch)
        if m:
            parts.append((m.group(1), clean(m.group(2))))
        elif parts:
            # continuation glued to previous
            parts[-1] = (parts[-1][0], (parts[-1][1] + " " + ch).strip())
        else:
            parts.append((None, ch))
    return parts


def convert(path, mode_key):
    wb = openpyxl.load_workbook(path)
    ws = wb.worksheets[0]
    groups = []       # ordered
    gmap = {}
    imap = {}
    warnings = []

    for r in ws.iter_rows(min_row=2, values_only=True):
        if not any(v not in (None, "") for v in (r + (None,))[:5]):
            continue
        g_raw, i_raw, c_raw, d_raw, e_raw = (list(r) + [None] * 5)[:5]
        g_txt, i_txt, c_txt = clean(g_raw), clean(i_raw), clean(c_raw)

        gm = RE_GROUP.match(g_txt) if g_txt else None
        im = RE_ITEM.match(i_txt) if i_txt else None
        if not gm or not im:
            warnings.append(f"row skipped (unparseable group/item): "
                            f"{g_txt[:30]!r} | {i_txt[:30]!r}")
            continue
        g_code, g_label = gm.group(1), gm.group(2).strip()
        i_code, i_label = im.group(1), im.group(2).strip()

        if g_code not in gmap:
            gmap[g_code] = {"code": g_code, "labelTh": g_label, "items": []}
            groups.append(gmap[g_code])
        elif len(g_label) > len(gmap[g_code]["labelTh"]):
            gmap[g_code]["labelTh"] = g_label

        if i_code not in imap:
            imap[i_code] = {"code": i_code, "labelTh": i_label,
                            "subItems": []}
            gmap[g_code]["items"].append(imap[i_code])
        elif len(i_label) > len(imap[i_code]["labelTh"]):
            imap[i_code]["labelTh"] = i_label
        item = imap[i_code]

        cm = RE_L1.match(c_txt) if c_txt else None
        if not cm:
            warnings.append(f"{i_code}: unparseable ลักษณะ: {c_txt[:50]!r}")
            continue
        c_num, c_label = cm.group(1), clean(cm.group(2))
        crit = next((c for c in item["subItems"]
                     if c["code"] == f"{i_code}-{c_num}"), None)
        if crit is None:
            crit = {"code": f"{i_code}-{c_num}", "num": c_num,
                    "labelTh": c_label, "subItems": []}
            item["subItems"].append(crit)

        leaves = split_d_cell(d_raw)
        if leaves and leaves[0][0] is None and len(leaves) == 1:
            # D has prose but no x.y number -> treat as extension of C
            crit["labelTh"] = (crit["labelTh"] + " " + leaves[0][1]).strip()
            leaves = []

        if leaves:
            leaf_codes = [n for n, _ in leaves if n]
            flagged = parse_flag(e_raw, leaf_codes)
            for n, txt in leaves:
                if n is None:
                    continue
                crit["subItems"].append({
                    "code": f"{i_code}-{n}", "num": n, "labelTh": txt,
                    "answerType": "presence" if n in flagged
                                  else "presence_standard",
                })
        else:
            flagged = parse_flag(e_raw, [c_num])
            crit["answerType"] = ("presence" if c_num in flagged
                                  else "presence_standard")

    # tidy: criteria with children need no own answerType; drop empty lists
    n_items = n_crit = n_leaf = n_presence = 0
    for g in groups:
        for it in g["items"]:
            n_items += 1
            for c in it["subItems"]:
                n_crit += 1
                if c["subItems"]:
                    c.pop("answerType", None)
                    for sc in c["subItems"]:
                        n_leaf += 1
                        n_presence += sc["answerType"] == "presence"
                else:
                    del c["subItems"]
                    n_leaf += 1
                    n_presence += c.get("answerType") == "presence"

    definition = {
        "schemaVersion": 2,
        "mode": mode_key,
        "answerTypes": {
            "presence_standard": "มี/ไม่มี + ได้มาตรฐาน/ไม่ได้มาตรฐาน",
            "presence": "มี/ไม่มี เท่านั้น (ได้มาตรฐาน grayed in source form)",
        },
        "source": Path(path).name,
        "provisional": True,
        "groups": groups,
    }
    stats = {"groups": len(groups), "items": n_items, "criteria": n_crit,
             "leaves": n_leaf, "presence_only": n_presence,
             "warnings": warnings}
    return definition, stats


MODES = {
    "rail": ("ทางราง", "Checklist_Rail_Complete.xlsx"),
    "water": ("ทางน้ำ", "Checklist_Water_Complete.xlsx"),
    "air": ("ทางอากาศ", "Checklist_Air_Complete.xlsx"),
    "land": ("ทางบก", "Checklist_Land_Complete.xlsx"),
}


def main(in_dir, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    all_stats = {}
    for key, (mode_th, fname) in MODES.items():
        definition, stats = convert(Path(in_dir) / fname, mode_th)
        p = out / f"template_{key}_v2.json"
        with open(p, "w", encoding="utf-8") as f:
            json.dump(definition, f, ensure_ascii=False, indent=1)
        all_stats[key] = stats
        print(f"{key:6} -> {p.name}: {stats['groups']} groups, "
              f"{stats['items']} items, {stats['criteria']} criteria, "
              f"{stats['leaves']} leaves "
              f"({stats['presence_only']} presence-only), "
              f"{len(stats['warnings'])} warnings")
        for w in stats["warnings"][:10]:
            print("   !", w)
    with open(out / "conversion_stats.json", "w", encoding="utf-8") as f:
        json.dump(all_stats, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".",
         sys.argv[2] if len(sys.argv) > 2 else "./templates")
