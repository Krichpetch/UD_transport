import csv
import json

import pytest

from merger import (UndecidedReviewRows, filter_new_records_by_subtype,
                     infer_target_subtype, load_review_decisions,
                     load_subtype_scope, merge, resolve_leaf_matches, run)
from normalize import label_key

A1 = {"code": "A1", "label": "ที่จอดรถ"}
A11 = {"code": "A1.1", "label": "ที่จอดรถสำหรับคนพิการ"}
OLD_DEF = {"schemaVersion": 2, "mode": "ทางราง", "answerTypes": {}}


def old_leaf(code, num, label, measurements=None, **kw):
    return {"code": code, "group": A1, "item": A11, "num": num,
            "labelRaw": label, "isLeaf": True,
            "answerType": kw.pop("answerType", "presence_standard"),
            "tierBlock": None,
            "meta": {"measurements": measurements or [], "note": kw.pop("note", None),
                     "facilityCode": None, "lawRefs": None}}


def new_leaf(code, num, label, parent=None, **kw):
    return {"code": code, "group": A1, "item": A11, "num": num, "parent": parent,
            "labelRaw": label, "labelKey": label_key(label), "isLeaf": True,
            "answerType": kw.pop("answerType", "presence_standard"),
            "tierBlock": None, "grayedHalf": False, "numSource": "literal"}


def match(old_code, new_code, status="UNCHANGED", score=1.0):
    return {"old_code": old_code, "new_code": new_code, "status": status,
            "score": score, "rationale": "", "decision": "auto",
            "old_label": None, "new_label": None}


# --------------------------------------------------------------------------
# review CSV loading
# --------------------------------------------------------------------------

def write_csv(path, rows, header=("old_code", "new_code", "status", "score",
                                   "reasons", "old_label", "new_label", "decision")):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def test_load_review_decisions_raises_on_blank_decision(tmp_path):
    p = tmp_path / "review.csv"
    write_csv(p, [["A1.1-2", "A1.1-2", "REVIEW", "0.8", "fuzzy", "old", "new", ""]])
    with pytest.raises(UndecidedReviewRows):
        load_review_decisions(p)


def test_load_review_decisions_parses_decided_rows(tmp_path):
    p = tmp_path / "review.csv"
    write_csv(p, [["A1.1-2", "A1.1-2", "REVIEW", "0.8", "fuzzy", "old", "new", "accept"]])
    decisions = load_review_decisions(p)
    assert decisions[("A1.1-2", "A1.1-2")] == "accept"


def test_load_review_decisions_missing_file_returns_empty(tmp_path):
    assert load_review_decisions(tmp_path / "nope.csv") == {}


# --------------------------------------------------------------------------
# decision resolution
# --------------------------------------------------------------------------

def test_resolve_review_accept_promotes_to_modified():
    m = match("A1.1-2", "A1.1-2", status="REVIEW", score=0.8)
    resolved = resolve_leaf_matches([m], {("A1.1-2", "A1.1-2"): "accept"}, {})
    assert resolved[0]["status"] == "MODIFIED"


def test_resolve_review_reject_splits_into_removed_and_added():
    m = match("A1.1-2", "A1.1-2", status="REVIEW", score=0.8)
    resolved = resolve_leaf_matches([m], {("A1.1-2", "A1.1-2"): "reject"}, {})
    statuses = {r["status"] for r in resolved}
    assert statuses == {"REMOVED", "ADDED"}


def test_resolve_review_map_to_remaps_new_code():
    target = new_leaf("A1.1-7", "7", "รายการที่ถูกต้อง")
    m = match("A1.1-2", "A1.1-2", status="REVIEW", score=0.8)
    resolved = resolve_leaf_matches(
        [m], {("A1.1-2", "A1.1-2"): "map_to:A1.1-7"}, {"A1.1-7": target})
    assert resolved[0]["new_code"] == "A1.1-7"
    assert resolved[0]["status"] == "MODIFIED"


def test_resolve_review_without_decision_raises():
    m = match("A1.1-2", "A1.1-2", status="REVIEW", score=0.8)
    with pytest.raises(UndecidedReviewRows):
        resolve_leaf_matches([m], {}, {})


def test_resolve_non_review_reject_signal_still_splits():
    m = match("A1.1-2", "A1.1-2", status="MODIFIED", score=0.95)
    resolved = resolve_leaf_matches(
        [m], {("A1.1-2", "A1.1-2"): "reject"}, {})
    statuses = {r["status"] for r in resolved}
    assert statuses == {"REMOVED", "ADDED"}


def test_resolve_non_review_no_signal_passes_through_unchanged():
    m = match("A1.1-2", "A1.1-2", status="MODIFIED", score=0.95)
    resolved = resolve_leaf_matches([m], {}, {})
    assert resolved == [m]


# --------------------------------------------------------------------------
# merge()
# --------------------------------------------------------------------------

def test_matched_leaf_numbers_unchanged_carries_measurements_verbatim():
    old = [old_leaf("A1.1-4", "4", "กว้างไม่น้อยกว่า 2400 มม",
                     measurements=[{"key": "m1", "operator": "gte", "value": 240.0,
                                     "unit": "cm", "confirmed": True}])]
    new = [new_leaf("A1.1-4", "4", "กว้างไม่น้อยกว่า 2400 มม")]
    matches = [match("A1.1-4", "A1.1-4", "UNCHANGED")]
    result = merge("rail", OLD_DEF, old, new, matches, "doc.docx")
    leaf = result["definition"]["groups"][0]["items"][0]["subItems"][0]
    assert leaf["code"] == "A1.1-4"
    assert leaf["measurements"][0]["confirmed"] is True
    assert leaf["measurements"][0]["value"] == 240.0
    assert result["threshold_review_rows"] == []


def test_matched_leaf_numbers_changed_reextracts_and_logs_review_row():
    old = [old_leaf("A1.1-4", "4", "กว้างไม่น้อยกว่า 2,400 มิลลิเมตร",
                     measurements=[{"key": "m1", "operator": "gte", "value": 240.0,
                                     "unit": "cm", "confirmed": True}])]
    new = [new_leaf("A1.1-4", "4", "กว้างไม่น้อยกว่า 2,500 มิลลิเมตร")]
    matches = [match("A1.1-4", "A1.1-4", "MODIFIED", 0.93)]
    result = merge("rail", OLD_DEF, old, new, matches, "doc.docx")
    leaf = result["definition"]["groups"][0]["items"][0]["subItems"][0]
    assert leaf["measurements"][0]["value"] == 250.0
    assert leaf["measurements"][0]["confirmed"] is False
    assert len(result["threshold_review_rows"]) == 1
    assert result["threshold_review_rows"][0][1] == "A1.1-4"


def test_matched_leaf_keeps_old_code_not_new_positional_code():
    old = [old_leaf("A1.1-4", "4", "ข้อความ")]
    new = [new_leaf("A1.1-9", "9", "ข้อความ")]  # renumbered in the new doc
    matches = [match("A1.1-4", "A1.1-9", "MOVED_WITHIN")]
    result = merge("rail", OLD_DEF, old, new, matches, "doc.docx")
    leaf = result["definition"]["groups"][0]["items"][0]["subItems"][0]
    assert leaf["code"] == "A1.1-4"


def test_added_leaf_mints_next_free_code_and_gets_fresh_extraction():
    old = [old_leaf("A1.1-1", "1", "ข้อความเดิม"),
           old_leaf("A1.1-2", "2", "ข้อความเดิมสอง")]
    new = [new_leaf("A1.1-1", "1", "ข้อความเดิม"),
           new_leaf("A1.1-2", "2", "ข้อความเดิมสอง"),
           new_leaf("A1.1-9", "9", "รายการใหม่ไม่น้อยกว่า 100 มิลลิเมตร")]
    matches = [match("A1.1-1", "A1.1-1", "UNCHANGED"),
               match("A1.1-2", "A1.1-2", "UNCHANGED"),
               match(None, "A1.1-9", "ADDED", None)]
    result = merge("rail", OLD_DEF, old, new, matches, "doc.docx")
    codes = {s["code"] for s in result["definition"]["groups"][0]["items"][0]["subItems"]}
    assert codes == {"A1.1-1", "A1.1-2", "A1.1-3"}
    added = next(s for s in result["definition"]["groups"][0]["items"][0]["subItems"]
                 if s["code"] == "A1.1-3")
    assert added["measurements"][0]["value"] == 10.0
    assert added["measurements"][0]["confirmed"] is False


def test_removed_leaf_absent_from_output():
    old = [old_leaf("A1.1-1", "1", "ข้อความเดิม"),
           old_leaf("A1.1-2", "2", "ข้อความที่จะถูกลบ")]
    new = [new_leaf("A1.1-1", "1", "ข้อความเดิม")]
    matches = [match("A1.1-1", "A1.1-1", "UNCHANGED"),
               match("A1.1-2", None, "REMOVED", None)]
    result = merge("rail", OLD_DEF, old, new, matches, "doc.docx")
    codes = {s["code"] for s in result["definition"]["groups"][0]["items"][0]["subItems"]}
    assert codes == {"A1.1-1"}


def test_merge_output_json_is_idempotent():
    old = [old_leaf("A1.1-1", "1", "ข้อความเดิม")]
    new = [new_leaf("A1.1-1", "1", "ข้อความเดิม")]
    matches = [match("A1.1-1", "A1.1-1", "UNCHANGED")]
    r1 = merge("rail", OLD_DEF, old, new, matches, "doc.docx")
    r2 = merge("rail", OLD_DEF, old, new, matches, "doc.docx")
    assert json.dumps(r1["definition"], sort_keys=True, ensure_ascii=False) == \
           json.dumps(r2["definition"], sort_keys=True, ensure_ascii=False)


def test_output_definition_marks_v3_draft_provisional():
    old = [old_leaf("A1.1-1", "1", "ข้อความเดิม")]
    new = [new_leaf("A1.1-1", "1", "ข้อความเดิม")]
    matches = [match("A1.1-1", "A1.1-1", "UNCHANGED")]
    result = merge("rail", OLD_DEF, old, new, matches, "Rail_Checklist_Example.docx")
    d = result["definition"]
    assert d["version"] == 3
    assert d["status"] == "DRAFT"
    assert d["provisional"] is True
    assert d["source"] == "Rail_Checklist_Example.docx"
    assert d["mode"] == "ทางราง"


def test_era_override_candidate_emitted_when_2548_ne_2564():
    old = [old_leaf("A1.3-1", "1", "จุดสัมผัสสูงไม่เกิน 200 มิลลิเมตร")]
    new = [new_leaf("A1.3-1", "1", "จุดสัมผัสสูงไม่เกิน 200 มิลลิเมตร")]
    matches = [match("A1.3-1", "A1.3-1", "UNCHANGED")]
    remarks_raw = [{"item": "A1.3", "criterion": "จุดสัมผัสสูงไม่เกิน 200 มิลลิเมตร",
                    "labelKey": new[0]["labelKey"],
                    "2548": "200", "2564": "150"}]
    result = merge("rail", OLD_DEF, old, new, matches, "doc.docx", remarks_raw=remarks_raw)
    assert result["remarks"]["A1.3-1"]["2548"] == "200"
    assert result["remarks"]["A1.3-1"]["2564"] == "150"
    assert result["era_overrides_candidates"]["A1.3-1"]["MHT_2548"] == 200.0
    assert result["era_overrides_candidates"]["A1.3-1"]["MHT_2564"] == 150.0


def test_era_override_candidate_handles_multivalue_remark():
    """A leaf with two thresholds may carry a comma-separated remark like
    "50,120" — each value is its own threshold, not a thousands-grouped
    number, so 2548 vs 2564 must compare as lists, not one garbled float."""
    old = [old_leaf("A2.3-3.7", "1", "ห่างจากผนังไม่น้อยกว่า 50 มม สูงไม่น้อยกว่า 120 มม")]
    new = [new_leaf("A2.3-3.7", "1", "ห่างจากผนังไม่น้อยกว่า 50 มม สูงไม่น้อยกว่า 100 มม")]
    matches = [match("A2.3-3.7", "A2.3-3.7", "UNCHANGED")]
    remarks_raw = [{"item": "A2.3", "criterion": "ราวจับ",
                    "labelKey": new[0]["labelKey"],
                    "2548": "50,120", "2564": "50,100"}]
    result = merge("rail", OLD_DEF, old, new, matches, "doc.docx", remarks_raw=remarks_raw)
    assert result["era_overrides_candidates"]["A2.3-3.7"]["MHT_2548"] == [50.0, 120.0]
    assert result["era_overrides_candidates"]["A2.3-3.7"]["MHT_2564"] == [50.0, 100.0]


def test_added_leaf_three_levels_deep_gets_minted_not_left_null():
    """merger.py's code minting used to only handle two levels (item-major
    and major.minor); a leaf ADDED three levels deep under a container
    nested inside another container was silently left with
    final_code_of[...] == None forever (the real-data B1.1-2.1 bug)."""
    top = new_leaf("A1.1-2", "2", "container top")
    top["isLeaf"] = False
    mid = new_leaf("A1.1-2.1", "2.1", "container mid", parent="2")
    mid["isLeaf"] = False
    deep = new_leaf("A1.1-2.1.1", "2.1.1", "new leaf, three levels deep", parent="2.1")
    new = [top, mid, deep]
    matches = [match(None, "A1.1-2.1.1", "ADDED", None)]
    result = merge("rail", OLD_DEF, [], new, matches, "doc.docx")
    container = result["definition"]["groups"][0]["items"][0]["subItems"][0]
    grandchild = container["subItems"][0]["subItems"][0]
    assert grandchild["code"] is not None
    assert grandchild["code"] == "A1.1-2.1.1"


def test_container_reminted_when_it_collides_with_matched_leaf_retained_code():
    """A3.2-1 real-data bug: a leaf's retained OLD code coincidentally
    equals a container's fresh NEW-position code once the document has
    been reorganised (new content inserted ahead of the leaf's old spot)."""
    old = [old_leaf("A1.1-1", "1", "signage requirement")]
    container = new_leaf("A1.1-1", "1", "staircase (new content)")
    container["isLeaf"] = False
    child = new_leaf("A1.1-1.1", "1.1", "staircase surface", parent="1")
    signage = new_leaf("A1.1-4", "4", "signage requirement")  # moved to position 4
    new = [container, child, signage]
    matches = [match("A1.1-1", "A1.1-4", "MOVED_WITHIN"),
               match(None, "A1.1-1.1", "ADDED", None)]
    result = merge("rail", OLD_DEF, old, new, matches, "doc.docx")
    subitems = result["definition"]["groups"][0]["items"][0]["subItems"]
    codes = [s["code"] for s in subitems]
    assert len(codes) == len(set(codes))
    signage_final = next(s for s in subitems if s.get("answerType"))
    container_final = next(s for s in subitems if "subItems" in s)
    assert signage_final["code"] == "A1.1-1"
    assert container_final["code"] != "A1.1-1"
    assert container_final["subItems"][0]["code"] == f"{container_final['code']}.1"


# --------------------------------------------------------------------------
# rail subtype scope (metro vs train)
# --------------------------------------------------------------------------

def test_infer_target_subtype():
    assert infer_target_subtype("rail_metro") == "metro"
    assert infer_target_subtype("rail_train") == "train"
    assert infer_target_subtype("rail") is None
    assert infer_target_subtype("land") is None


def test_load_subtype_scope_missing_file_is_empty(tmp_path):
    assert load_subtype_scope(tmp_path / "nope.csv") == {}


def test_load_subtype_scope_reads_code_to_tag(tmp_path):
    p = tmp_path / "subtype_scope.csv"
    write_csv(p, [["B1.1-9.1", "metro_only"], ["B1.1-9.2", "metro_only"]],
              header=("code", "scope"))
    assert load_subtype_scope(p) == {"B1.1-9.1": "metro_only", "B1.1-9.2": "metro_only"}


def test_filter_new_records_drops_metro_only_for_train_target():
    shared = new_leaf("A1.1-1", "1", "ทั่วไป")
    metro_only = new_leaf("A1.1-2", "2", "เฉพาะรถไฟฟ้า")
    scope = {"A1.1-2": "metro_only"}
    train_out = filter_new_records_by_subtype([shared, metro_only], scope, "train")
    metro_out = filter_new_records_by_subtype([shared, metro_only], scope, "metro")
    assert [r["code"] for r in train_out] == ["A1.1-1"]
    assert [r["code"] for r in metro_out] == ["A1.1-1", "A1.1-2"]


def test_filter_new_records_only_drops_directly_tagged_records():
    """filter_new_records_by_subtype() only removes records whose OWN code/
    item code/group code is tagged — it does not walk parent chains. A
    child left behind after its container is filtered out becomes
    unreachable once merge() builds the tree (see the whole-subtree test
    below), but the flat list returned here still contains it."""
    header = new_leaf("B1.1-9", "9", "กรณีพิเศษสำหรับรถไฟฟ้า")
    child = new_leaf("B1.1-9.1", "9.1", "ราวจับพิเศษ", parent="9")
    scope = {"B1.1-9": "metro_only"}
    out = filter_new_records_by_subtype([header, child], scope, "train")
    assert out == [child]


def test_tagging_container_code_drops_whole_subtree_from_built_tree():
    """Tagging just the container code should drop its children too, without
    listing every descendant leaf — once the container is filtered out of
    new_records, _build_subitems()'s recursion never reaches its orphaned
    children, so they silently disappear from the built tree."""
    shared = new_leaf("A1.1-1", "1", "ทั่วไป")
    header = new_leaf("A1.1-2", "2", "กรณีพิเศษสำหรับรถไฟฟ้า")
    header["isLeaf"] = False
    child = new_leaf("A1.1-2.1", "2.1", "ราวจับพิเศษ", parent="2")
    new_records = [shared, header, child]
    leaf_matches = [
        match(None, "A1.1-1", "ADDED"),
        match(None, "A1.1-2.1", "ADDED"),
    ]
    filtered = filter_new_records_by_subtype(new_records, {"A1.1-2": "metro_only"}, "train")
    result = merge("rail_train", OLD_DEF, [], filtered, leaf_matches, "doc.docx")
    assert _subitem_codes(result) == ["A1.1-1"]


def test_filter_new_records_noop_without_scope_or_target():
    recs = [new_leaf("A1.1-1", "1", "ทั่วไป")]
    assert filter_new_records_by_subtype(recs, {}, "train") == recs
    assert filter_new_records_by_subtype(recs, {"A1.1-1": "metro_only"}, None) == recs


def _subitem_codes(result):
    codes = []
    for g in result["definition"]["groups"]:
        for it in g["items"]:
            for sub in it["subItems"]:
                codes.append(sub["code"])
    return codes


def test_run_produces_different_trees_for_metro_vs_train(tmp_path):
    """End-to-end: the same Stage 1-4 artifacts, run twice under
    rail_metro/rail_train mode keys, must differ by exactly the container
    (and its child) tagged in subtype_scope.csv."""
    shared = new_leaf("A1.1-1", "1", "ทั่วไป")
    metro_header = new_leaf("A1.1-2", "2", "กรณีพิเศษสำหรับรถไฟฟ้า")
    metro_header["isLeaf"] = False
    metro_child = new_leaf("A1.1-2.1", "2.1", "ราวจับพิเศษ", parent="2")
    new_records = [shared, metro_header, metro_child]
    old_records = []  # nothing pre-existing — everything is a fresh ADDED leaf
    leaf_matches = [
        {"old_code": None, "new_code": "A1.1-1", "old_label": None,
         "new_label": "ทั่วไป", "status": "ADDED", "score": None,
         "rationale": "new", "decision": "auto"},
        {"old_code": None, "new_code": "A1.1-2.1", "old_label": None,
         "new_label": "ราวจับพิเศษ", "status": "ADDED", "score": None,
         "rationale": "new", "decision": "auto"},
    ]

    for mode_key in ("rail_metro", "rail_train"):
        outdir = tmp_path / mode_key
        outdir.mkdir()
        old_def_path = outdir / "old_definition.json"
        old_def_path.write_text(json.dumps(OLD_DEF, ensure_ascii=False), encoding="utf-8")
        matches_json = {"leaf_matches": leaf_matches,
                         "_old_template_path": str(old_def_path),
                         "_source_docx": "doc.docx"}
        (outdir / "matches.json").write_text(json.dumps(matches_json, ensure_ascii=False), encoding="utf-8")
        (outdir / "old_ir.json").write_text(json.dumps(old_records, ensure_ascii=False), encoding="utf-8")
        (outdir / "new_ir.json").write_text(json.dumps(new_records, ensure_ascii=False), encoding="utf-8")
        write_csv(outdir / f"migration_review_{mode_key}.csv", [])
        write_csv(outdir / "subtype_scope.csv", [["A1.1-2", "metro_only"]], header=("code", "scope"))

    metro_result = run("rail_metro", tmp_path / "rail_metro")
    train_result = run("rail_train", tmp_path / "rail_train")

    assert _subitem_codes(metro_result) == ["A1.1-1", "A1.1-2"]
    assert _subitem_codes(train_result) == ["A1.1-1"]
