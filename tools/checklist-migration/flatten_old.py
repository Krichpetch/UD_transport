"""Stage 2 — flatten template_{mode}_v2.json into the same IR record shape
that docx_parser.py (Stage 1) emits, so aligner.py can diff two flat lists
of identically-shaped records instead of two different tree shapes.

Usage: python flatten_old.py <template_v2.json> <outfile.json>
"""
import json
import sys
from pathlib import Path

from normalize import extract_numbers, label_key


def _is_starred(label: str) -> bool:
    return (label or "").rstrip().endswith("*")


def _leaf_meta(node):
    return {
        "measurements": node.get("measurements", []),
        "note": node.get("note"),
        "facilityCode": node.get("facilityCode"),
        "lawRefs": node.get("lawRefs"),
        "star": _is_starred(node.get("labelTh")),
    }


def _walk_criteria(nodes, group, item, ancestor_path, parent_num, records):
    """Mirrors docx_parser.container_pass: only non-dot ('n') criteria get
    an ordinal; dot-numbered ('n.m') sub-criteria get a `parent` pointer
    (the owning criterion's num) instead — no ordinal of their own."""
    ordinal = 0
    for node in nodes:
        kids = node.get("subItems") or []
        is_leaf = not kids
        num = node.get("num")
        has_dot = bool(num and "." in str(num))
        label = node.get("labelTh", "")
        rec = {
            "path": list(ancestor_path),
            "group": dict(group),
            "item": dict(item),
            "num": num,
            "numSource": "literal",
            "code": node["code"],
            "labelRaw": label,
            "labelKey": label_key(label),
            "numbers": extract_numbers(label),
            "isLeaf": is_leaf,
            "tierBlock": None,
            "star": _is_starred(label),
        }
        if has_dot:
            rec["parent"] = parent_num
        else:
            ordinal += 1
            rec["ordinal"] = ordinal
        if is_leaf:
            rec["answerType"] = node["answerType"]
            rec["meta"] = _leaf_meta(node)
        records.append(rec)
        if kids:
            _walk_criteria(kids, group, item, ancestor_path + [node["code"]],
                           num, records)


def flatten_old(definition):
    """definition: parsed template_{mode}_v2.json. Returns a flat list of
    IR-shaped records (leaves and containers), matching docx_parser's
    st.records list shape closely enough for aligner.py to consume both."""
    records = []
    for g in definition["groups"]:
        group = {"code": g["code"], "label": g["labelTh"]}
        for it in g.get("items", []):
            item = {"code": it["code"], "label": it["labelTh"]}
            _walk_criteria(it.get("subItems", []), group, item,
                           [group["code"], item["code"]], None, records)
    return records


def main(in_path, out_path):
    definition = json.loads(Path(in_path).read_text(encoding="utf-8"))
    records = flatten_old(definition)
    Path(out_path).write_text(
        json.dumps(records, ensure_ascii=False, indent=1),
        encoding="utf8", newline="\n")
    leaves = sum(1 for r in records if r["isLeaf"])
    containers = sum(1 for r in records if not r["isLeaf"])
    print(f"{in_path}: {len(records)} records ({leaves} leaves, "
          f"{containers} containers)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
