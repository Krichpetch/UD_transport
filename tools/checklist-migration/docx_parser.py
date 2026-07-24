"""Stage 1 — parse a revised สนข. checklist DOCX into the canonical IR.

Usage: python docx_parser.py <file.docx> <outdir>

Outputs: new_ir.json, tree_preview.json, remarks_raw.json, parse_report.md
"""
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import docx
from docx.oxml.ns import qn

from normalize import (GROUP_CODE_RE, ITEM_CODE_RE, clean_ws, extract_numbers,
                       label_key, literal_num_prefix, strip_group_note)

NEUTRAL_FILLS = {"auto", "FFFFFF", None, "nil"}


class Cell:
    __slots__ = ("text", "c0", "span", "vmerge", "fill", "origin", "pad")

    def __init__(self, text, c0, span, vmerge, fill):
        self.text, self.c0, self.span = text, c0, span
        self.vmerge, self.fill, self.origin = vmerge, fill, True
        self.pad = False

    @property
    def interval(self):
        return (self.c0, self.c0 + self.span)


def densify(table):
    grid = table._tbl.find(qn("w:tblGrid"))
    ncols = len(grid.findall(qn("w:gridCol")))
    rows = []
    for tr in table._tbl.findall(qn("w:tr")):
        c0, row = 0, []
        for tc in tr.findall(qn("w:tc")):
            tcPr = tc.find(qn("w:tcPr"))
            span, vmerge, fill = 1, None, None
            if tcPr is not None:
                gs = tcPr.find(qn("w:gridSpan"))
                if gs is not None:
                    span = int(gs.get(qn("w:val")))
                vm = tcPr.find(qn("w:vMerge"))
                if vm is not None:
                    vmerge = vm.get(qn("w:val")) or "cont"
                shd = tcPr.find(qn("w:shd"))
                if shd is not None:
                    fill = shd.get(qn("w:fill"))
            text = clean_ws("".join(n.text or "" for n in tc.iter(qn("w:t"))))
            row.append(Cell(text, c0, span, vmerge, fill))
            c0 += span
        if c0 < ncols:
            padc = Cell("", c0, ncols - c0, None, None)
            padc.pad = True
            row.append(padc)
        rows.append(row)
    for ri in range(1, len(rows)):
        for cell in rows[ri]:
            if cell.vmerge == "cont":
                for above in rows[ri - 1]:
                    a0, a1 = above.interval
                    if a0 <= cell.c0 < a1:
                        cell.text, cell.fill, cell.origin = above.text, above.fill, False
                        break
    return rows, ncols


HEADER_SIGNATURE = ["group", "item", "crit", "present", "absent", "std", "nostd", "remark"]


def map_columns(header_row):
    cols = {}
    for cell in header_row:
        t = cell.text.replace(" ", "")
        if t == "กลุ่ม":
            cols["group"] = cell.interval
        elif t == "รายการตรวจสอบ":
            cols["item"] = cell.interval
        elif t == "ลักษณะ":
            cols["crit"] = cell.interval
        elif t == "มี":
            cols["present"] = cell.interval
        elif t == "ไม่มี":
            cols["absent"] = cell.interval
        elif t.startswith("ได้"):
            cols["std"] = cell.interval
        elif t.startswith("ไม่ได้"):
            cols["nostd"] = cell.interval
        elif t.startswith("หมายเหตุ"):
            cols["remark"] = cell.interval
    required = {"group", "item", "present", "absent", "std", "nostd"}
    return cols if required <= set(cols) else None


def bucket(row, cols, origin_only=True):
    """Positional assignment — the invariant of this document family.

    Rows are fully tiled left-to-right: cell[0]=group, cell[1]=item,
    the last (4 + r) cells are [present, absent, std, nostd] + r remark
    cells (r=2 when 2548/2564 sub-columns carry separate cells, else 1),
    and every cell in between belongs to the criterion (ลักษณะ) area —
    one cell for a plain criterion, several for nested tier sub-rows.
    Immune to the per-row grid shifts that defeat interval scoring.
    """
    cells = [c for c in row if not c.pad]   # padding is layout, not data
    n = len(cells)
    have_subs = "y2548" in cols and "y2564" in cols

    def ov(cell, iv):
        s0, s1 = cell.interval
        return max(0, min(s1, iv[1]) - max(s0, iv[0]))

    r = 1
    if have_subs and n >= 8:
        # r=2 when the penultimate cell sits in the 2548 sub-column
        if ov(cells[-2], cols["y2548"]) >= ov(cells[-2], cols["nostd"]) and ov(cells[-2], cols["y2548"]) > 0:
            r = 2
    tail_keys = ["present", "absent", "std", "nostd"]
    if have_subs:
        tail_keys += ["y2548", "y2564"] if r == 2 else ["y2564"]
    elif "remark" in cols:
        tail_keys += ["remark"]
    k = n - 2 - len(tail_keys)          # criterion-area cell count
    if k < 0:
        return defaultdict(list)         # malformed row — caller sees empty

    out = defaultdict(list)
    assign = [("group", cells[0]), ("item", cells[1])]
    assign += [("crit", c) for c in cells[2:2 + k]]
    assign += list(zip(tail_keys, cells[2 + k:]))
    for key, cell in assign:
        if key == "crit" and "crit" not in cols:
            key = "item"                 # overview tables have no ลักษณะ
        if origin_only and not cell.origin:
            continue
        out[key].append(cell)
    # a single remark cell spanning both years reports under both keys
    if have_subs and r == 1 and "y2564" in out:
        out["y2548"] = []
    return out


def btext(b, key):
    return clean_ws(" ".join(c.text for c in b.get(key, []) if c.text))


def is_header_row(row):
    texts = {c.text.replace(" ", "") for c in row}
    return "กลุ่ม" in texts and "รายการตรวจสอบ" in texts


SECTION_RE = re.compile(r"^([A-C])\s")


class ParserState:
    def __init__(self):
        self.section = None
        self.group = None
        self.item = None
        self.records = []
        self.remarks = []
        self.warnings = []
        self.counters = Counter()
        self.overview_items = {}
        self.detail_items = {}
        self.groups_seen = {}
        self.item_occurrence = Counter()


def parse_overview_table(rows, cols, st):
    for row in rows:
        if is_header_row(row):
            st.counters["rows_header_skipped"] += 1
            continue
        full = [c for c in row if c.origin and c.text]
        if len(full) == 1 and SECTION_RE.match(full[0].text):
            st.counters["rows_section_banner"] += 1
            continue
        b = bucket(row, cols)
        itext = btext(b, "item")
        m = ITEM_CODE_RE.match(itext)
        if m:
            st.overview_items[m.group(1)] = clean_ws(ITEM_CODE_RE.sub("", itext))
            st.counters["rows_overview_item"] += 1
        elif itext:
            st.warnings.append(f"overview row not classified: {itext[:60]!r}")
            st.counters["rows_unclassified"] += 1
        else:
            st.counters["rows_empty"] += 1


def shaded(b, key):
    return any(c.fill and c.fill not in NEUTRAL_FILLS for c in b.get(key, []))


TIER_HINT_RE = re.compile(r"คัน|ที่นั่ง|ขึ้นไป")


def parse_detail_table(rows, cols, st):
    for row in rows[:3]:
        for cell in row:
            if cell.origin and cell.text in ("2548", "2564"):
                cols["y" + cell.text] = cell.interval
    open_tier = None

    for row in rows:
        if is_header_row(row):
            st.counters["rows_header_skipped"] += 1
            continue
        if all(c.text in ("2548", "2564", "") for c in row if c.origin):
            st.counters["rows_subheader_skipped"] += 1
            continue
        full = [c for c in row if c.origin and c.text]
        if len(full) == 1 and full[0].span >= cols["nostd"][1] - 1 \
                and SECTION_RE.match(full[0].text):
            st.section = full[0].text
            st.counters["rows_section_banner"] += 1
            continue

        b = bucket(row, cols, origin_only=True)
        b_all = bucket(row, cols, origin_only=False)

        gtext = btext(b, "group")
        if gtext:
            m = GROUP_CODE_RE.match(gtext)
            if m:
                st.group = {"code": m.group(1),
                            "label": strip_group_note(GROUP_CODE_RE.sub("", gtext))}
                st.groups_seen[m.group(1)] = st.group["label"]
                st.counters["group_starts"] += 1
            elif gtext:
                st.warnings.append(f"group cell without code: {gtext[:50]!r}")

        itext_origin = btext(b, "item")
        if itext_origin:
            m = ITEM_CODE_RE.match(itext_origin)
            if m:
                code = m.group(1)
                st.item_occurrence[code] += 1
                st.item = {"code": code,
                           "label": clean_ws(ITEM_CODE_RE.sub("", itext_origin)),
                           "occurrence": st.item_occurrence[code]}
                st.detail_items[code] = st.item["label"]
                st.counters["item_starts"] += 1

        # per-row subheader: inherited item-column text that is NOT an item code
        itext_all = btext(b_all, "item")
        subheader = None
        if itext_all and not ITEM_CODE_RE.match(itext_all):
            subheader = itext_all
            st.counters.setdefault("subheader_rows", 0)
            st.counters["subheader_rows"] += 1

        crit_cells = [c for c in b.get("crit", []) if c.text]
        if not crit_cells:
            if not itext_origin and not gtext:
                st.counters["rows_empty"] += 1
            continue

        if len(crit_cells) >= 2:
            parts = [c.text for c in crit_cells]
            if open_tier is None:
                prev = st.records[-1] if st.records else None
                plausible = prev is not None and (
                    prev["labelRaw"].rstrip().endswith("ดังนี้")
                    or TIER_HINT_RE.search(" ".join(parts)))
                if plausible:
                    prev["tierBlock"] = open_tier = []
                else:
                    st.warnings.append(f"multi-cell crit row not a tier: {parts}")
                    st.counters["rows_unclassified"] += 1
                    continue
            open_tier.append(parts)
            st.counters["tier_rows"] += 1
            continue

        open_tier = None
        crit_text = crit_cells[0].text
        num, rest = literal_num_prefix(crit_text)
        grayed_std, grayed_no = shaded(b_all, "std"), shaded(b_all, "nostd")
        if grayed_std != grayed_no:
            st.warnings.append(
                f"asymmetric graying at {st.item and st.item['code']}: {crit_text[:40]!r}")
        rec = {
            "section": st.section,
            "group": st.group and dict(st.group),
            "item": st.item and dict(st.item),
            "subheader": subheader,
            "num": num,
            "numSource": "literal" if num else "positional",
            "labelRaw": rest if num else crit_text,
            "labelKey": label_key(crit_text),
            "numbers": extract_numbers(rest if num else crit_text),
            "isLeaf": True,
            "answerType": "presence" if (grayed_std and grayed_no) else "presence_standard",
            "grayedHalf": grayed_std != grayed_no,
            "tierBlock": None,
            "star": crit_text.rstrip().endswith("*"),
        }
        st.records.append(rec)
        st.counters["leaves_raw"] += 1
        if crit_text.rstrip().endswith("ดังนี้"):
            open_tier_candidate = True  # tier may follow; opened lazily above

        r48, r64 = btext(b, "y2548"), btext(b, "y2564")
        if r48 or r64:
            st.remarks.append({
                "item": st.item and st.item["code"],
                "criterion": crit_text[:80],
                "labelKey": rec["labelKey"],
                "2548": r48 or None, "2564": r64 or None,
            })


def container_pass(records):
    """Mark container criteria: a record R becomes a container when later
    records in the same item carry dot-numbers n.m[.k...] whose immediate
    parent prefix (n for n.m; n.m for n.m.k; ...) 'belongs' to R (R.num
    equals that prefix, or R is the nearest preceding record at a
    shallower nesting depth). Depth-based, not "dot vs no dot", so a case
    block that restarts its own sub-numbering two levels deep (2.2 ->
    2.2.1..2.2.4) nests under its own header rather than jumping straight
    to the outer item-level container.

    Owner inference is deliberately LAZY (owner["num"] is only assigned
    the first time it's needed, from whichever dotted child asks first) —
    NOT hoisted into an upfront positional pass. An item can have several
    top-level sections that each restart their own sub-numbering at .1
    (two unrelated "กรณี..." case blocks, say) — hoisting would give each
    section's un-numbered header a distinct, unique num, but then a child
    genuinely written as "1.1" in the DOCX would no longer structurally
    match its own (now differently-numbered) header, breaking parent
    assignment for the entire second block. Lazy inference keeps parent-
    finding correct (the nearest not-yet-numbered candidate is always the
    true owner) at the cost of the container code colliding with any
    other section that also restarts at .1 — a real ambiguity in how this
    document nests repeated case blocks, not a numbering bug to paper
    over here. See subtype_scope.csv workflow notes for how that surfaces
    downstream. Grouped by (item code, occurrence) rather than item code
    alone, so ordinal counting and owner inference each restart cleanly
    when the SAME item code is explicitly re-started later in the document
    (a fresh origin item-code cell, not just a numbering quirk) — this is
    what lets split_edition_duplicates() below catch repeated blocks that
    have no literal numbering to collide on (see its own docstring)."""
    by_item = defaultdict(list)
    for r in records:
        it = r["item"] or {}
        by_item[(it.get("code"), it.get("occurrence"))].append(r)
    for recs in by_item.values():
        for r in recs:
            if r["num"] and "." in r["num"]:
                parent_num = r["num"].rsplit(".", 1)[0]
                depth = r["num"].count(".")
                # find owner: nearest preceding record at a shallower depth
                owner = None
                for cand in reversed(recs[:recs.index(r)]):
                    cand_depth = cand["num"].count(".") if cand["num"] else 0
                    if cand_depth < depth:
                        if cand["num"] in (parent_num, None):
                            owner = cand
                        break
                if owner is not None:
                    owner["isLeaf"] = False
                    owner.pop("answerType", None)
                    if owner["num"] is None:
                        owner["num"] = parent_num
                        owner["numSource"] = "inferred"
                    r["parent"] = owner["num"]
    # ordinals + provisional codes
    for (item_code, _occurrence), recs in by_item.items():
        n = 0
        for r in recs:
            if not (r["num"] and "." in str(r["num"])):
                n += 1
                r["ordinal"] = n
                if r["num"] is None:
                    r["num"] = str(n)
            r["code"] = f"{item_code}-{r['num']}" if item_code else None


def _rebase_num(num, old_top, new_top):
    """'2.1' rebased from top '2' to top '8' -> '8.1'. Only the leading
    (top-level) segment changes; everything after it is untouched."""
    parts = num.split(".")
    assert parts[0] == old_top
    return ".".join([new_top] + parts[1:])


def split_edition_duplicates(records):
    """This DOCX interleaves TWO editions per item back to back — a base
    (รถไฟ/train) edition and a second (รถไฟฟ้า/metro) edition — and both
    frequently restart their own top-level numbering. container_pass()'s
    lazy owner inference is correct for parent-finding within each
    edition, but it means the second edition's un-numbered headers get
    re-inferred to the SAME top-level num as the first edition's, so they
    collide onto one code (see container_pass's docstring).

    This splits them back apart, one item at a time, using document order
    (a header's whole subtree is always the contiguous run of records
    between it and the next top-level record — true regardless of nesting
    depth, since nested rows are always laid out immediately after their
    parent): the first occurrence of a top-level code is the base edition
    and is left alone; a later occurrence is either
      - a byte-identical repeat of the same criterion in both editions
        (dropped — one copy is enough), or
      - a genuinely different criterion that only exists in the metro
        edition (kept, but re-based onto a freshly minted top-level code
        so it no longer collides with the base edition's).

    Returns (records, metro_only_codes) — metro_only_codes are the newly
    minted codes, ready to paste into subtype_scope.csv as metro_only.
    """
    by_item = defaultdict(list)
    for r in records:
        by_item[(r["item"] or {}).get("code")].append(r)

    to_drop = set()
    metro_only_codes = []

    for item_code, recs in by_item.items():
        if not item_code:
            continue
        top_positions = [i for i, r in enumerate(recs) if r.get("parent") is None]
        used_tops = {r["num"] for r in recs if r.get("parent") is None}
        next_top = max((int(n) for n in used_tops if n.isdigit()), default=0) + 1

        seen_top_code = {}
        for ti, pos in enumerate(top_positions):
            end = top_positions[ti + 1] if ti + 1 < len(top_positions) else len(recs)
            header = recs[pos]
            block = recs[pos:end]
            code = header["code"]
            first = seen_top_code.get(code)
            if first is None:
                seen_top_code[code] = header
                continue

            if header["labelRaw"] == first["labelRaw"]:
                to_drop.update(id(r) for r in block)
                continue

            old_top = header["num"]
            new_top = str(next_top)
            next_top += 1
            for r in block:
                if r["num"].split(".")[0] == old_top:
                    r["num"] = _rebase_num(r["num"], old_top, new_top)
                    r["code"] = f"{item_code}-{r['num']}"
                if r.get("parent") and r["parent"].split(".")[0] == old_top:
                    r["parent"] = _rebase_num(r["parent"], old_top, new_top)
            metro_only_codes.append(header["code"])

    return [r for r in records if id(r) not in to_drop], metro_only_codes


def build_tree(records):
    tree = defaultdict(lambda: defaultdict(list))
    for r in records:
        g = (r["group"] or {}).get("code", "?")
        i = (r["item"] or {}).get("code", "?")
        e = {"num": r["num"], "label": r["labelRaw"][:64],
             "type": ("container" if not r["isLeaf"]
                      else ("P" if r["answerType"] == "presence" else "PS"))}
        if r["tierBlock"]:
            e["tiers"] = r["tierBlock"]
        if r["subheader"]:
            e["sub"] = r["subheader"][:24]
        tree[g][i].append(e)
    return {g: dict(v) for g, v in tree.items()}


def main(path, outdir):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    doc = docx.Document(path)
    st = ParserState()
    for ti, table in enumerate(doc.tables):
        rows, _ = densify(table)
        cols = map_columns(rows[0])
        if cols is None:
            st.warnings.append(f"table {ti}: header not recognized — skipped")
            continue
        (parse_detail_table if "crit" in cols else parse_overview_table)(rows, cols, st)
        st.counters[f"table_{ti}_rows"] = len(rows)

    container_pass(st.records)
    st.records, metro_only_codes = split_edition_duplicates(st.records)
    leaves = sum(1 for r in st.records if r["isLeaf"])
    containers = sum(1 for r in st.records if not r["isLeaf"])

    ov, dt = set(st.overview_items), set(st.detail_items)
    (outdir / "new_ir.json").write_text(
        json.dumps(st.records, ensure_ascii=False, indent=1),
        encoding="utf8", newline="\n")
    (outdir / "tree_preview.json").write_text(
        json.dumps(build_tree(st.records), ensure_ascii=False, indent=1),
        encoding="utf8", newline="\n")
    (outdir / "remarks_raw.json").write_text(
        json.dumps(st.remarks, ensure_ascii=False, indent=1),
        encoding="utf8", newline="\n")

    if metro_only_codes:
        with open(outdir / "metro_only_candidates.csv", "w", newline="",
                  encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["code", "scope"])
            w.writerows([c, "metro_only"] for c in metro_only_codes)

    lines = ["# Parse report", "", f"Source: {path}", "", "## Counters", ""]
    lines += [f"- {k}: {v}" for k, v in sorted(st.counters.items())]
    lines += ["", "## Inventory",
              f"- overview items (2.1): {len(ov)}",
              f"- detail items (2.2): {len(dt)}",
              f"- groups in detail: {sorted(st.groups_seen)}",
              f"- answerable leaves: {leaves}   containers: {containers}",
              f"- remark rows captured: {len(st.remarks)}",
              f"- metro-only additions split out (see metro_only_candidates.csv): {len(metro_only_codes)}",
              "",
              "## 2.1 vs 2.2 cross-check",
              f"- overview-only items: {sorted(ov - dt)}",
              f"- detail-only items: {sorted(dt - ov)}", "",
              "## Warnings", ""]
    lines += [f"- {w}" for w in st.warnings] or ["- none"]
    (outdir / "parse_report.md").write_text(
        "\n".join(lines), encoding="utf8", newline="\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
