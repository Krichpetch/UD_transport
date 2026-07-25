"""Stage 5 — merge matches.json + review decisions into
template_{mode}_v3.json + remarks_{mode}.json + an era_overrides skeleton
+ code_crosswalk_{mode}.json.

INVARIANT (T-INV, see tests/test_t_inv.py): the merged output's codes,
positions, and record existence come ENTIRELY from the new document — a
record's `code` is always its own new-document provisional code, exactly
as docx_parser.py assigned it. The old JSON's only role is a metadata
cache: it supplies `measurements[]` (verbatim when unchanged, including
`confirmed: true`), `note`, `facilityCode`, and `lawRefs` for a leaf the
aligner matched to an old one — it never influences a code, a position, an
ordering, or which records appear. This revokes the old "code stability"
contract (matched leaves used to keep their OLD code regardless of new
position) — that contract bought answer continuity across template
versions for free, but the app already gets that for free anyway (a
Checklist is stamped to the template VERSION it was created under; old
answers never migrate to a new template version), so freezing old
numbering into new templates cost readability for no benefit. Cross-version
identity, if ever needed for analytics, lives in code_crosswalk_{mode}.json
instead — see build_crosswalk().
"""
import csv
import json
from pathlib import Path

from aligner import _collect_groups, _collect_items, comparison_numbers
from enrich_measurements import extract as extract_measurements
from normalize import (ABSENT_MARKER, PRESENT_MARKER, extract_numbers,
                       parse_remark_numbers)


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
    column is blank — the merger must refuse to run in that case.

    A row's new_code is fixed (it's the new document's own record — never
    up for negotiation). The decision only ever controls METADATA
    sourcing: accept uses the row's proposed old_code as the metadata
    donor; reject means no donor (fresh extraction, as if genuinely
    ADDED); map_to:<code> overrides which OLD leaf donates metadata — the
    target is an OLD code, since the new leaf's own identity never
    changes."""
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


def resolve_leaf_matches(leaf_matches, decisions, old_by_code):
    """Apply human decisions: REVIEW-band pairs MUST have a decision
    (accept/reject/map_to:<code>); suspicious-signal rows on an otherwise
    auto-classified leaf only change behavior on 'reject' (split it) —
    'accept' (or no CSV row at all) leaves the original classification.

    The new leaf's code is never touched here (see module docstring) —
    every branch only changes which OLD leaf (if any) donates metadata to
    it. map_to's target is looked up in old_by_code, not new_by_code."""
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
            target = old_by_code.get(target_code)
            if target is None:
                raise ValueError(f"map_to target {target_code!r} not found in old IR")
            resolved.append({**m, "old_code": target_code, "old": target,
                              "old_label": target.get("labelRaw"),
                              "status": "MODIFIED",
                              "rationale": f"metadata mapped from {target_code}"})
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

def _build_subitems(item_new_records, metadata_source_of, old_by_code,
                     mode, review_rows):
    """A record's code is always its own (new-document) code — see the
    module docstring's invariant. metadata_source_of (new_code -> old_code,
    populated only for leaves the aligner matched) is consulted purely to
    find which old leaf's measurements/note/facilityCode/lawRefs to carry
    onto it; a container or an unmatched (ADDED) leaf simply has no entry,
    same as absent."""
    top = [r for r in item_new_records if r.get("parent") is None]
    children = {}
    for r in item_new_records:
        p = r.get("parent")
        if p is not None:
            children.setdefault(p, []).append(r)

    def build_node(rec):
        code = rec["code"]
        old_code = metadata_source_of.get(code)
        old_rec = old_by_code.get(old_code) if old_code else None
        node = {"code": code, "num": rec["num"], "labelTh": rec["labelRaw"]}
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


def _resolve_era_pair(v48, v64, label_numbers):
    """Reads a remark's 2548/2564 cells as either ONE thousands-grouped
    number each, or as parallel comma-separated value lists — genuinely
    ambiguous from the text alone: "2,500" (one value, the real A2.2-1
    case) and "50,120" (two values, e.g. a wall-gap gte and a height gte)
    have the identical shape, a comma followed by exactly 3 digits.

    The label only ever states ONE era's number (that's the nature of an
    era override — the other era's value necessarily differs), so at most
    one side can be corroborated directly against label_numbers. Once
    either side confirms the thousands reading, apply it to BOTH sides —
    same field, same units, no reason the other era would suddenly switch
    to a different cell shape."""
    thousands48, thousands64 = extract_numbers(str(v48) if v48 else ""), extract_numbers(str(v64) if v64 else "")
    confirmed = (
        (len(thousands48) == 1 and label_numbers and thousands48[0] in label_numbers)
        or (len(thousands64) == 1 and label_numbers and thousands64[0] in label_numbers)
    )
    if confirmed and len(thousands48) == 1 and len(thousands64) == 1:
        return thousands48[0], thousands64[0]
    return _numeric_or_list(v48), _numeric_or_list(v64)


def _existence_pair(v48, v64):
    """A remark cell pair of PRESENT_MARKER/ABSENT_MARKER (see
    docx_parser.py's Wingdings check/X-mark translation) means the whole
    criterion existed under one law era but not the other — an EXISTENCE
    override, not a threshold-VALUE one (MHT_2548/MHT_2564 are for
    numbers that changed; this is for whether the requirement applies at
    all). Only fires when the two sides actually disagree — both marked
    present (or both absent) isn't an era difference worth flagging."""
    markers = {PRESENT_MARKER: True, ABSENT_MARKER: False}
    if v48 in markers and v64 in markers and markers[v48] != markers[v64]:
        return markers[v48], markers[v64]
    return None, None


def build_remarks_and_era(remarks_raw, new_by_code):
    """Matches by the exact Stage-1 `code` each remark's owning record was
    stamped with (see docx_parser.py's remarks resolution, right after
    split_edition_duplicates) rather than by re-deriving a text key here —
    text collides constantly in this repetitive corpus (a handful of
    near-identical criteria recur under a dozen items), and a text-keyed
    dict can only remember one owner per key, silently losing every
    remark but the last-processed one for every collided item. Matching
    by code also picks up remarks whose row became a container (isLeaf
    False) rather than a leaf — those routinely carry their own remark
    data too (case-header rows like "กรณีทางลาดที่ความยาว...") and were
    previously invisible since the old labelkey dict was leaf-only.

    No re-keying step: a record's Stage-1 code IS its final code (see the
    module docstring's invariant), so remarks_raw's own `code` field is
    already the right key."""
    remarks_out = {}
    era_candidates = {}
    for r in remarks_raw:
        code = r.get("code")
        new_rec = new_by_code.get(code)
        if new_rec is None:
            continue
        remarks_out[code] = {
            "2548": r.get("2548"),
            "2564": r.get("2564"),
            "labelSnippet": r.get("criterion"),
        }
        exists48, exists64 = _existence_pair(r.get("2548"), r.get("2564"))
        n48, n64 = _resolve_era_pair(r.get("2548"), r.get("2564"), new_rec.get("numbers"))
        if exists48 is not None:
            era_candidates[code] = {
                "labelHint": r.get("criterion"),
                "exists_2548": exists48, "exists_2564": exists64,
                "confirmed": False,
            }
        elif n48 is not None and n64 is not None and n48 != n64:
            era_candidates[code] = {
                "labelHint": r.get("criterion"),
                "MHT_2548": n48, "MHT_2564": n64,
                "confirmed": False,
            }
        elif n48 is None and n64 is None:
            # Neither side reduced to a single value or a clean parallel
            # list — e.g. A1.1's parking-spot quota, a multi-bracket
            # capacity table ("10-50 51-100 101 ... " vs "<25 26-50
            # 151..."), not a plain threshold. Rather than silently
            # dropping a genuine era difference just because its shape
            # doesn't fit MHT_2548/MHT_2564 as scalars, surface the raw
            # text so a human can encode it properly — needsManualReview
            # signals the STRUCTURE needs a person, not just a confirm.
            raw48, raw64 = r.get("2548"), r.get("2564")
            if (raw48 and raw64 and raw48 != raw64
                    and extract_numbers(raw48) and extract_numbers(raw64)):
                era_candidates[code] = {
                    "labelHint": r.get("criterion"),
                    "MHT_2548": raw48, "MHT_2564": raw64,
                    "confirmed": False,
                    "needsManualReview": True,
                }
    return remarks_out, era_candidates


# --------------------------------------------------------------------------
# code crosswalk (cross-version identity, kept OUT of the codes themselves)
# --------------------------------------------------------------------------

def build_crosswalk(leaf_matches):
    """Array of {oldCode, newCode, classification, score} covering every
    leaf the aligner considered: matched pairs, REMOVED old leaves
    (newCode: null), and ADDED new leaves (oldCode: null). This is the
    durable record of cross-version identity now that codes themselves
    never carry it (see module docstring) — any future analytics that
    needs to follow a criterion's answer history across template versions
    reads this file, not the codes.

    Deterministic ordering for idempotency: sorted by newCode, entries with
    no newCode (REMOVED) sorted last by oldCode."""
    rows = [
        {"oldCode": m["old_code"], "newCode": m["new_code"],
         "classification": m["status"], "score": m["score"]}
        for m in leaf_matches
    ]
    rows.sort(key=lambda r: (r["newCode"] is None, r["newCode"] or "", r["oldCode"] or ""))
    return rows


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def merge(mode_key, old_definition, old_records, new_records, leaf_matches,
          source_docx_name, remarks_raw=None):
    old_by_code = {r["code"]: r for r in old_records if r.get("code")}
    new_by_code = {r["code"]: r for r in new_records if r.get("code")}

    # metadata_source_of: new_code -> old_code, for leaves the aligner
    # matched to an old one. This is consulted ONLY to decide which old
    # leaf donates measurements/note/facilityCode/lawRefs (_leaf_meta_out,
    # via _build_subitems) — it never touches a code, a position, or which
    # records appear (see module docstring's invariant). An ADDED leaf
    # (new_code set, old_code absent) simply gets no entry, same as a
    # container, which never goes through leaf alignment at all.
    metadata_source_of = {}
    for m in leaf_matches:
        if m["new_code"] and m["old_code"]:
            metadata_source_of[m["new_code"]] = m["old_code"]

    review_rows = []
    groups_out = []
    for g in _collect_groups(new_records):
        g_records = [r for r in new_records
                     if r.get("group") and r["group"]["code"] == g["code"]]
        items_out = []
        for it in _collect_items(new_records, g["code"]):
            item_records = [r for r in g_records
                             if r.get("item") and r["item"]["code"] == it["code"]]
            subitems = _build_subitems(item_records, metadata_source_of,
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
        remarks_out, era_candidates = build_remarks_and_era(remarks_raw, new_by_code)

    return {
        "definition": definition,
        "remarks": remarks_out,
        "era_overrides_candidates": era_candidates,
        "threshold_review_rows": review_rows,
        "code_crosswalk": build_crosswalk(leaf_matches),
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

    old_by_code = {r["code"]: r for r in old_records if r.get("code")}

    leaf_matches = resolve_leaf_matches(matches["leaf_matches"], decisions, old_by_code)

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
    _write_json(outdir / f"code_crosswalk_{mode_key}.json", result["code_crosswalk"])

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
