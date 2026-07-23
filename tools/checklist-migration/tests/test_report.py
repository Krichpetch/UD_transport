import csv

from aligner import AlignResult, make_match
from report import write_report, write_review_csv


def leaf(code, label, **kw):
    d = {"code": code, "labelRaw": label, "labelKey": label.replace(" ", ""),
         "numbers": kw.pop("numbers", []), "grayedHalf": kw.pop("grayedHalf", False),
         "numSource": kw.pop("numSource", "literal")}
    d.update(kw)
    return d


def test_report_lists_non_unchanged_and_omits_unchanged_detail(tmp_path):
    unchanged = make_match(leaf("A1.1-1", "เดิม"), leaf("A1.1-1", "เดิม"), "UNCHANGED", 1.0, "exact")
    modified = make_match(leaf("A1.1-2", "เดิมสอง"), leaf("A1.1-2", "ใหม่สอง"), "MODIFIED", 0.95, "fuzzy")
    result = AlignResult(leaf_matches=[unchanged, modified])

    out = tmp_path / "report.md"
    write_report("rail", result, out)
    text = out.read_text(encoding="utf-8")

    assert "| UNCHANGED | 1 |" in text
    assert "| MODIFIED | 1 |" in text
    assert "MODIFIED — A1.1-2 → A1.1-2" in text
    assert "UNCHANGED — A1.1-1" not in text  # only non-UNCHANGED get detail sections


def test_review_csv_includes_review_band_rows_with_blank_decision(tmp_path):
    review = make_match(leaf("A1.1-2", "เดิม"), leaf("A1.1-2", "ใหม่ที่คล้ายกัน"), "REVIEW", 0.8, "fuzzy")
    result = AlignResult(leaf_matches=[review])
    out = tmp_path / "review.csv"
    rows = write_review_csv("rail", result, out)
    assert len(rows) == 1
    with open(out, encoding="utf-8-sig", newline="") as f:
        reader = list(csv.DictReader(f))
    assert reader[0]["decision"] == ""
    assert reader[0]["status"] == "REVIEW"


def test_review_csv_omits_clean_auto_matches(tmp_path):
    unchanged = make_match(leaf("A1.1-1", "เดิม"), leaf("A1.1-1", "เดิม"), "UNCHANGED", 1.0, "exact")
    result = AlignResult(leaf_matches=[unchanged])
    rows = write_review_csv("rail", result, tmp_path / "review.csv")
    assert rows == []


def test_review_csv_flags_asymmetric_graying_even_when_auto_classified(tmp_path):
    new_rec = leaf("A1.1-2", "ใหม่", grayedHalf=True)
    m = make_match(leaf("A1.1-2", "เดิม"), new_rec, "UNCHANGED", 1.0, "exact")
    result = AlignResult(leaf_matches=[m])
    rows = write_review_csv("rail", result, tmp_path / "review.csv")
    assert len(rows) == 1
    assert "asymmetric graying" in rows[0][4]


def test_review_csv_flags_positional_numbering_on_modified_leaf(tmp_path):
    new_rec = leaf("A1.1-2", "ใหม่", numSource="positional")
    m = make_match(leaf("A1.1-2", "เดิม"), new_rec, "MODIFIED", 0.95, "fuzzy")
    result = AlignResult(leaf_matches=[m])
    rows = write_review_csv("rail", result, tmp_path / "review.csv")
    assert len(rows) == 1
    assert "positional-only numbering" in rows[0][4]


def test_review_csv_flags_remark_vs_label_numeric_disagreement(tmp_path):
    new_rec = leaf("A1.3-1", "จุดสัมผัสสูงไม่เกิน200มม", numbers=[200.0])
    new_rec["labelKey"] = "จุดสัมผัสสูงไม่เกิน200มม"
    m = make_match(leaf("A1.3-1", "เดิม"), new_rec, "UNCHANGED", 1.0, "exact")
    result = AlignResult(leaf_matches=[m])
    remarks = [{"labelKey": "จุดสัมผัสสูงไม่เกิน200มม", "2548": "200", "2564": "150"}]
    rows = write_review_csv("rail", result, tmp_path / "review.csv", remarks=remarks)
    assert len(rows) == 1
    assert "disagrees" in rows[0][4]
