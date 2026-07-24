"""Stage 5 — merge matches.json + review decisions into
template_{mode}_v3.json + remarks_{mode}.json + an era_overrides skeleton.

New document wins structure/order/text/answerType. Old JSON supplies
accumulated metadata (measurements, note, facilityCode/lawRefs) for matched
leaves and, per §3.4, matched leaves KEEP THEIR OLD CODE regardless of new
position — that is the code-stability contract every downstream reference
(remarks sidecar, era overrides, review CSVs) relies on.
"""
import csv
import json
from pathlib import Path

from aligner import _collect_groups, _collect_items, comparison_numbers
from enrich_measurements import extract as extract_measurements
from normalize import parse_remark_numbers


class UndecidedReviewRows(Exception):
    pass


# --------------------------------------------------------------------------
# rail subtype scope (metro vs train) — opt-in, separate from Stage 4 review
# --------------------------------------------------------------------------
#
# The รถไฟฟ้า (metro) and รถไฟ (train) checklists are separate template
# documents (see @repo/types/template-variant.ts), but a single revised DOCX
# can carry additions that only apply to one subtype (e.g. metro-only items
# appended at the end of a shared item). subtype_scope.csv — a small,
# hand-maintained file in `outdir`, absent by default — lets a reviewer tag
# just those specific codes; everything else is unaffected and applies to
# both outputs. Tag at whatever level is convenient: a leaf/container code
# (e.g. "B1.1-9.1"), an item code (e.g. "B1.5"), or a group code — a record
# is dropped if ANY of its own code / item code / group code is scoped to
# the other subtype. Dropping a container this way drops its whole subtree
# for free, since _build_subitems() only recurses into records it can still
# see in `top`/`children`.

SUBTYPE_SCOPE_HEADER = ["code", "scope"]  # scope: "metro_only" | "train_only"


def load_subtype_scope(path):
    """dict code -> 'metro_only'/'train_only'. Missing file = no tags (every
    record applies to both subtypes) — this is the common, no-friction case."""
    if not Path(path).exists():
        return {}
    scope = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            code = (row.get("code") or "").strip()
            tag = (row.get("scope") or "").strip()
            if code and tag:
                scope[code] = tag
    return scope


def infer_target_subtype(mode_key):
    """'metro'/'train'/None from a mode key like 'rail_metro'/'rail_train' —
    matches RAIL_METRO_VARIANT_KEY/RAIL_TRAIN_VARIANT_KEY's naming. None
    means "not a subtype-split run" — no filtering, e.g. plain 'rail' or
    any other mode."""
    key = mode_key.lower()
    if "metro" in key:
        return "metro"
    if "train" in key:
        return "train"
    return None


def filter_new_records_by_subtype(new_records, scope_map, target_subtype):
    """Drops new-side records tagged for the OTHER rail subtype. No-op when
    there's nothing to filter (no scope file, or a non-subtype-split run)."""
    if not scope_map or target_subtype is None:
        return new_records

    def excluded(r):
        ids = [r.get("code")]
        if r.get("item"):
            ids.append(r["item"]["code"])
        if r.get("group"):
            ids.append(r["group"]["code"])
        for i in ids:
            tag = scope_map.get(i)
            if tag == "metro_only" and target_subtype != "metro":
                return True
            if tag == "train_only" and target_subtype != "train":
                return True
        return False

    return [r for r in new_records if not excluded(r)]


# --------------------------------------------------------------------------
# Stage 4 review CSV -> decisions
# --------------------------------------------------------------------------

def load_review_decisions(csv_path):
    """dict (old_code, new_code) -> decision string ('accept' / 'reject' /
    'map_to:<code>'). Raises UndecidedReviewRows if any row's decision
    column is blank — the merger must refuse to run in that case."""
    if not Path(csv_path).exists():
        return {}
    decisions = {}
    undecided = []
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            key = (row.get("old_code") or None, row.get("new_code") or None)
            dec = (row.get("decision") or "").strip()
            if not dec:
                undecided.append(key)
                continue
            decisions[key] = dec
    if undecided:
        raise UndecidedReviewRows(
            f"{len(undecided)} review row(s) still undecided: {undecided[:5]}"
            f"{' ...' if len(undecided) > 5 else ''}")
    return decisions


def resolve_leaf_matches(leaf_matches, decisions, new_by_code):
    """Apply human decisions: REVIEW-band pairs MUST have a decision
    (accept/reject/map_to:<code>); suspicious-signal rows on an otherwise
    auto-classified leaf only change behavior on 'reject' (split it) —
    'accept' (or no CSV row at all) leaves the original classification."""
    resolved = []
    for m in leaf_matches:
        key = (m["old_code"], m["new_code"])
        dec = decisions.get(key)

        if m["status"] != "REVIEW":
            if dec == "reject":
                resolved += _split(m)
            else:
                resolved.append(m)
            continue

        if dec is None:
            raise UndecidedReviewRows(
                f"no review decision found for {m['old_code']} -> {m['new_code']}")
        if dec == "accept":
            resolved.append({**m, "status": "MODIFIED"})
        elif dec == "reject":
            resolved += _split(m)
        elif dec.startswith("map_to:"):
            target_code = dec.split(":", 1)[1].strip()
            target = new_by_code.get(target_code)
            if target is None:
                raise ValueError(f"map_to target {target_code!r} not found in new IR")
            resolved.append({**m, "new_code": target_code, "new": target,
                              "new_label": target.get("labelRaw"),
                              "status": "MODIFIED",
                              "rationale": f"manually mapped to {target_code}"})
        else:
            raise ValueError(f"unknown decision {dec!r} for {m['old_code']} -> {m['new_code']}")
    return resolved


def _split(m):
    out = []
    if m["old_code"]:
        out.append({**m, "new_code": None, "new": None, "new_label": None,
                     "status": "REMOVED", "rationale": "rejected in review"})
    if m["new_code"]:
        out.append({**m, "old_code": None, "old": None, "old_label": None,
                     "status": "ADDED", "rationale": "rejected in review"})
    return out


# --------------------------------------------------------------------------
# code allocation for ADDED leaves/containers
# --------------------------------------------------------------------------

def _num_suffix(item_code, code):
    return code[len(item_code) + 1:]


def _max_major(codes, item_code):
    best = 0
    for c in codes:
        n = _num_suffix(item_code, c)
        if "." not in n:
            try:
                best = max(best, int(n))
            except ValueError:
                pass
    return best


def _max_minor(codes, item_code, major):
    best = 0
    prefix = f"{major}."
    for c in codes:
        n = _num_suffix(item_code, c)
        if n.startswith(prefix):
            try:
                best = max(best, int(n.split(".", 1)[1]))
            except ValueError:
                pass
    return best


def _allocate_added_codes(item_code, item_new_records, final_code_of, old_item_codes):
    """Mutates final_code_of (new_code -> final_code) in place, minting the
    next free suffix for every ADDED record in this item. Retired (REMOVED)
    old codes are never reused because old_item_codes includes them."""
    reserved_majors = set()
    for c in old_item_codes:
        n = _num_suffix(item_code, c)
        if "." not in n:
            try:
                reserved_majors.add(int(n))
            except ValueError:
                pass
    next_major = _max_major(old_item_codes, item_code) + 1

    for r in item_new_records:
        if r.get("parent") is not None:
            continue
        new_code = r["code"]
        if new_code in final_code_of and final_code_of[new_code] is not None:
            continue
        if final_code_of.get(new_code) is None and _is_added(final_code_of, new_code):
            while next_major in reserved_majors:
                next_major += 1
            final_code_of[new_code] = f"{item_code}-{next_major}"
            reserved_majors.add(next_major)
            next_major += 1

    minor_counters = {}
    for r in item_new_records:
        parent = r.get("parent")
        if parent is None:
            continue
        new_code = r["code"]
        if not _is_added(final_code_of, new_code):
            continue
        parent_record = next((x for x in item_new_records if x.get("num") == parent
                               and x.get("parent") is None), None)
        parent_final = final_code_of.get(parent_record["code"]) if parent_record else None
        if parent_final is None:
            continue
        major = _num_suffix(item_code, parent_final)
        if major not in minor_counters:
            minor_counters[major] = _max_minor(old_item_codes, item_code, major) + 1
        n = minor_counters[major]
        final_code_of[new_code] = f"{item_code}-{major}.{n}"
        minor_counters[major] = n + 1


def _is_added(final_code_of, new_code):
    return new_code in final_code_of and final_code_of[new_code] is None


# --------------------------------------------------------------------------
# measurements
# --------------------------------------------------------------------------

def _measurements_for(old_rec, new_rec, mode, review_rows):
    old_meta = (old_rec or {}).get("meta") or {}
    old_measurements = old_meta.get("measurements") or []

    if old_rec is not None:
        old_nums = set(comparison_numbers(old_rec))
        new_nums = set(comparison_numbers(new_rec))
        if old_nums == new_nums and old_measurements:
            return old_measurements

    extracted = extract_measurements(new_rec.get("labelRaw", ""))
    if old_measurements:
        for mm in extracted:
            review_rows.append([
                mode, new_rec["code"], mm["operator"], mm["value"],
                mm.get("value2", ""), mm["unit"], mm["sourceText"],
                new_rec.get("labelRaw", ""),
                json.dumps(old_measurements, ensure_ascii=False),
            ])
    return extracted


def _leaf_meta_out(old_rec, new_rec, mode, review_rows):
    old_meta = (old_rec or {}).get("meta") or {}
    out = {}
    measurements = _measurements_for(old_rec, new_rec, mode, review_rows)
    if measurements:
        out["measurements"] = measurements
    if old_meta.get("note"):
        out["note"] = old_meta["note"]
    if old_meta.get("facilityCode"):
        out["facilityCode"] = old_meta["facilityCode"]
    if old_meta.get("lawRefs"):
        out["lawRefs"] = old_meta["lawRefs"]
    return out


# --------------------------------------------------------------------------
# tree building
# --------------------------------------------------------------------------

def _build_subitems(item_code, item_new_records, final_code_of, old_by_code,
                     mode, review_rows):
    top = [r for r in item_new_records if r.get("parent") is None]
    by_num = {r["num"]: r for r in top}
    children = {}
    for r in item_new_records:
        p = r.get("parent")
        if p is not None:
            children.setdefault(p, []).append(r)

    def build_node(rec):
        final_code = final_code_of[rec["code"]]
        old_rec = old_by_code.get(final_code) if final_code in old_by_code else None
        node = {"code": final_code, "num": rec["num"],
                "labelTh": rec["labelRaw"]}
        kids = children.get(rec["num"], [])
        if kids:
            node["subItems"] = [build_node(k) for k in kids]
        else:
            node["answerType"] = rec["answerType"]
            node.update(_leaf_meta_out(old_rec, rec, mode, review_rows))
        return node

    return [build_node(r) for r in top]


# --------------------------------------------------------------------------
# remarks + era overrides
# --------------------------------------------------------------------------

def _numeric_or_list(value):
    """A remark cell is usually one number, but may pack more than one
    threshold comma-separated when its leaf has multiple measurements (see
    parse_remark_numbers). Collapse the common single-value case back to a
    plain float so existing single-threshold consumers/tests are unaffected;
    multi-value cells surface as a list so nothing is silently merged into
    one bogus number."""
    values = parse_remark_numbers(value)
    if not values:
        return None
    return values[0] if len(values) == 1 else values


def build_remarks_and_era(remarks_raw, new_by_labelkey, final_code_of):
    remarks_out = {}
    era_candidates = {}
    for r in remarks_raw:
        new_rec = new_by_labelkey.get(r.get("labelKey"))
        if new_rec is None:
            continue
        final_code = final_code_of.get(new_rec["code"])
        if final_code is None:
            continue
        remarks_out[final_code] = {
            "2548": r.get("2548"),
            "2564": r.get("2564"),
            "labelSnippet": r.get("criterion"),
        }
        n48, n64 = _numeric_or_list(r.get("2548")), _numeric_or_list(r.get("2564"))
        if n48 is not None and n64 is not None and n48 != n64:
            era_candidates[final_code] = {
                "labelHint": r.get("criterion"),
                "MHT_2548": n48, "MHT_2564": n64,
                "confirmed": False,
            }
    return remarks_out, era_candidates


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def merge(mode_key, old_definition, old_records, new_records, leaf_matches,
          source_docx_name, remarks_raw=None):
    old_by_code = {r["code"]: r for r in old_records if r.get("code")}
    new_by_code = {r["code"]: r for r in new_records if r.get("code")}

    final_code_of = {}
    for m in leaf_matches:
        if m["new_code"] and m["old_code"]:
            final_code_of[m["new_code"]] = m["old_code"]
        elif m["new_code"] and not m["old_code"]:
            final_code_of[m["new_code"]] = None  # ADDED — minted below

    # Containers never go through leaf-level alignment (aligner.align()
    # only produces leaf_matches for isLeaf=True records) — structure is
    # the new document's alone to own, so containers always keep their
    # own new-doc code. Only *leaves* carry the code-stability contract.
    for r in new_records:
        if not r.get("isLeaf") and r.get("code"):
            final_code_of.setdefault(r["code"], r["code"])

    review_rows = []
    groups_out = []
    for g in _collect_groups(new_records):
        g_records = [r for r in new_records
                     if r.get("group") and r["group"]["code"] == g["code"]]
        items_out = []
        for it in _collect_items(new_records, g["code"]):
            item_records = [r for r in g_records
                             if r.get("item") and r["item"]["code"] == it["code"]]
            old_item_codes = [r["code"] for r in old_records
                               if r.get("item") and r["item"]["code"] == it["code"]]
            _allocate_added_codes(it["code"], item_records, final_code_of, old_item_codes)
            subitems = _build_subitems(it["code"], item_records, final_code_of,
                                        old_by_code, mode_key, review_rows)
            items_out.append({"code": it["code"], "labelTh": it["label"],
                               "subItems": subitems})
        groups_out.append({"code": g["code"], "labelTh": g["label"],
                            "items": items_out})

    definition = {
        "schemaVersion": old_definition.get("schemaVersion", 2),
        "mode": old_definition["mode"],
        "answerTypes": old_definition.get("answerTypes", {}),
        "source": source_docx_name,
        "version": 3,
        "status": "DRAFT",
        "provisional": True,
        "groups": groups_out,
    }

    remarks_out, era_candidates = {}, {}
    if remarks_raw:
        new_by_labelkey = {r["labelKey"]: r for r in new_records if r.get("isLeaf")}
        remarks_out, era_candidates = build_remarks_and_era(
            remarks_raw, new_by_labelkey, final_code_of)

    return {
        "definition": definition,
        "remarks": remarks_out,
        "era_overrides_candidates": era_candidates,
        "threshold_review_rows": review_rows,
    }


def run(mode_key, outdir):
    """Reads the artifacts run.py already wrote to `outdir` and emits Stage
    5 outputs into the same directory. If outdir/subtype_scope.csv exists
    and mode_key is a rail_metro/rail_train run, new-side records tagged for
    the other subtype are dropped before the tree is built."""
    outdir = Path(outdir)
    decisions = load_review_decisions(outdir / f"migration_review_{mode_key}.csv")

    matches = json.loads((outdir / "matches.json").read_text(encoding="utf-8"))
    old_records = json.loads((outdir / "old_ir.json").read_text(encoding="utf-8"))
    new_records = json.loads((outdir / "new_ir.json").read_text(encoding="utf-8"))

    scope_map = load_subtype_scope(outdir / "subtype_scope.csv")
    new_records = filter_new_records_by_subtype(
        new_records, scope_map, infer_target_subtype(mode_key))

    new_by_code = {r["code"]: r for r in new_records if r.get("code")}

    leaf_matches = resolve_leaf_matches(matches["leaf_matches"], decisions, new_by_code)

    old_definition = json.loads(
        Path(matches.get("_old_template_path", "")).read_text(encoding="utf-8")) \
        if matches.get("_old_template_path") else None

    remarks_raw = None
    remarks_path = outdir / "remarks_raw.json"
    if remarks_path.exists():
        remarks_raw = json.loads(remarks_path.read_text(encoding="utf-8"))

    result = merge(mode_key, old_definition, old_records, new_records,
                    leaf_matches, matches.get("_source_docx", ""), remarks_raw)

    _write_json(outdir / f"template_{mode_key}_v3.json", result["definition"])
    _write_json(outdir / f"remarks_{mode_key}.json", result["remarks"])
    _write_json(outdir / f"era_overrides_{mode_key}_candidates.json",
                result["era_overrides_candidates"])

    if result["threshold_review_rows"]:
        with open(outdir / f"threshold_review_{mode_key}_v3.csv", "w",
                  newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["mode", "leaf_code", "operator", "value_cm", "value2_cm",
                        "unit", "source_fragment", "leaf_text", "old_measurements"])
            w.writerows(result["threshold_review_rows"])

    return result


def _write_json(path, data):
    Path(path).write_text(
        json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True),
        encoding="utf8", newline="\n")


if __name__ == "__main__":
    import sys
    run(sys.argv[1], sys.argv[2])
