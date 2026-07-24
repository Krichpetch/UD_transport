"""Unit tests for docx_parser.container_pass() and split_edition_duplicates()
— synthetic record lists, no DOCX involved.
"""
from docx_parser import container_pass, split_edition_duplicates

ITEM = {"code": "A1.3", "label": "พื้นผิวต่างสัมผัส"}


def leaf(label, num=None, **kw):
    r = {"item": ITEM, "group": {"code": "A1", "label": "g"}, "num": num,
         "labelRaw": label, "labelKey": label, "isLeaf": True,
         "answerType": "presence_standard", "grayedHalf": False,
         "tierBlock": None, "subheader": None,
         "numSource": "literal" if num else "positional"}
    r.update(kw)
    return r


def test_container_pass_nests_three_level_numbering():
    """2.2 -> 2.2.1..2.2.4 (the B1.1-2.2 case from real data)."""
    recs = [
        leaf("กรณีเป็นประตูบานเลื่อน", "2.2"),
        leaf("ข้อ 1", "2.2.1"),
        leaf("ข้อ 2", "2.2.2"),
    ]
    container_pass(recs)
    assert recs[0]["isLeaf"] is False
    assert recs[1]["parent"] == "2.2"
    assert recs[2]["parent"] == "2.2"
    assert recs[0]["code"] == "A1.3-2.2"
    assert recs[1]["code"] == "A1.3-2.2.1"


def test_container_pass_two_restarting_sections_collide_by_design():
    """Two case blocks that each restart their own sub-numbering at .1
    correctly attach each child to ITS OWN header (not the other one's) —
    but since both headers are un-numbered, they infer the same top code.
    That collision is exactly what split_edition_duplicates() resolves."""
    recs = [
        leaf("กรณี A", None), leaf("A ข้อ 1", "1.1"), leaf("A ข้อ 2", "1.2"),
        leaf("กรณี B", None), leaf("B ข้อ 1", "1.1"), leaf("B ข้อ 2", "1.2"),
    ]
    container_pass(recs)
    header_a, header_b = recs[0], recs[3]
    assert recs[1]["parent"] == header_a["num"]
    assert recs[2]["parent"] == header_a["num"]
    assert recs[4]["parent"] == header_b["num"]
    assert recs[5]["parent"] == header_b["num"]
    assert header_a["code"] == header_b["code"]  # the collision


def _run(recs):
    container_pass(recs)
    return split_edition_duplicates(recs)


def test_split_drops_byte_identical_second_edition():
    recs = [
        leaf("กรณี A", None), leaf("ข้อ 1", "1.1"), leaf("ข้อ 2", "1.2"),
        leaf("กรณี A", None), leaf("ข้อ 1", "1.1"), leaf("ข้อ 2", "1.2"),
    ]
    out, metro_only = _run(recs)
    assert len(out) == 3
    assert metro_only == []
    assert [r["labelRaw"] for r in out] == ["กรณี A", "ข้อ 1", "ข้อ 2"]


def test_split_rebases_different_second_edition_onto_a_fresh_code():
    recs = [
        leaf("มีประตูสำหรับคนพิการ", None),
        leaf("ความกว้าง", "1.1"),
        leaf("เปิดปิดง่าย", "1.2"),
        leaf("กรณีทางลาด", None),          # 2nd occurrence of top num "1", different text
        leaf("มีทางลาด", "1.1"),
        leaf("ความกว้างทางลาด", "1.2"),
    ]
    out, metro_only = _run(recs)
    assert len(out) == 6  # nothing dropped — both editions kept
    codes = [r["code"] for r in out]
    assert len(set(codes)) == 6  # all unique now

    ramp_header = next(r for r in out if r["labelRaw"] == "กรณีทางลาด")
    ramp_child = next(r for r in out if r["labelRaw"] == "มีทางลาด")
    assert ramp_header["code"] != "A1.3-1"  # rebased off the collision
    assert metro_only == [ramp_header["code"]]
    assert ramp_child["parent"] == ramp_header["num"]
    assert ramp_child["code"] == f"A1.3-{ramp_header['num']}.1"


def test_split_rebases_three_level_second_edition():
    """The rebase must cascade through a 3-level nested duplicate block,
    not just direct (1-level) children."""
    recs = [
        leaf("case A", None), leaf("sub A", "1.1"),
        leaf("case B", None),                      # collides with "case A" on top num
        leaf("nested header", "1.1"),
        leaf("nested child", "1.1.1"),
    ]
    out, metro_only = _run(recs)
    case_b = next(r for r in out if r["labelRaw"] == "case B")
    nested_header = next(r for r in out if r["labelRaw"] == "nested header")
    nested_child = next(r for r in out if r["labelRaw"] == "nested child")
    assert nested_header["parent"] == case_b["num"]
    assert nested_header["num"] == f"{case_b['num']}.1"
    assert nested_child["parent"] == nested_header["num"]
    assert nested_child["num"] == f"{case_b['num']}.1.1"
    assert metro_only == [case_b["code"]]


def test_split_is_noop_when_no_top_level_code_repeats():
    recs = [leaf("only one", None), leaf("sub", "1.1")]
    out, metro_only = _run(recs)
    assert len(out) == 2
    assert metro_only == []
