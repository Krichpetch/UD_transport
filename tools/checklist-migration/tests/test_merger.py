import csv
import json

import pytest

from merger import (UndecidedReviewRows, load_review_decisions, merge,
                     resolve_leaf_matches)
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
