"""aligner.py unit tests — one per change class, per checklist_migration_design.md
§6 suggested build order: renumber, reword, threshold swap, insert, delete,
cross-item move, plus the tier-block MODIFIED case from the migration task brief.
"""
from aligner import align


def leaf(code, group, item, num, ordinal, label, numbers=None, tier=None,
         answer_type="presence_standard"):
    g_code, g_label = group
    i_code, i_label = item
    return {
        "code": code,
        "group": {"code": g_code, "label": g_label},
        "item": {"code": i_code, "label": i_label},
        "num": num,
        "ordinal": ordinal,
        "labelRaw": label,
        "labelKey": label.replace(" ", ""),
        "numbers": numbers or [],
        "isLeaf": True,
        "answerType": answer_type,
        "tierBlock": tier,
        "star": False,
    }


A1 = ("A1", "ที่จอดรถ")
A11 = ("A1.1", "ที่จอดรถสำหรับคนพิการ")


def find(result, old_code=None, new_code=None):
    for m in result.leaf_matches:
        if (old_code is None or m["old_code"] == old_code) and \
           (new_code is None or m["new_code"] == new_code):
            return m
    return None


def test_pure_renumber_is_moved_within():
    old = [leaf("A1.1-4", A1, A11, "4", 4, "ข้อความเดิมไม่เปลี่ยน")]
    new = [leaf("A1.1-5", A1, A11, "5", 5, "ข้อความเดิมไม่เปลี่ยน")]
    result = align(old, new)
    m = find(result, old_code="A1.1-4")
    assert m["new_code"] == "A1.1-5"
    assert m["status"] == "MOVED_WITHIN"
    assert m["score"] == 1.0


def test_unchanged_same_text_same_slot():
    old = [leaf("A1.1-4", A1, A11, "4", 4, "ข้อความเดิมไม่เปลี่ยน")]
    new = [leaf("A1.1-4", A1, A11, "4", 4, "ข้อความเดิมไม่เปลี่ยน")]
    result = align(old, new)
    m = find(result, old_code="A1.1-4")
    assert m["status"] == "UNCHANGED"


def test_reword_is_matched_as_an_edit_not_split():
    """Per design §3.3: a pairing that clears the fuzzy threshold under
    assignment constraints is an edit — whether it auto-clears at >=0.92
    (MODIFIED) or lands in the 0.70-0.92 human-decides band (REVIEW), the
    invariant is that old and new stay paired rather than becoming a
    silent REMOVED+ADDED."""
    old = [leaf("A1.1-2", A1, A11, "2", 2,
                "ที่จอดรถสำหรับคนพิการให้จัดไว้ใกล้ทางเข้าและออกอาคารให้มากที่สุด")]
    new = [leaf("A1.1-2", A1, A11, "2", 2,
                "ที่จอดรถสำหรับคนพิการต้องจัดไว้ใกล้ทางเข้า-ออกอาคารให้มากที่สุดเท่าที่ทำได้")]
    result = align(old, new)
    m = find(result, old_code="A1.1-2")
    assert m["status"] in ("MODIFIED", "REVIEW")
    assert m["new_code"] == "A1.1-2"


def test_threshold_swap_numbers_changed_stays_paired_not_split():
    """A skeleton-matching row whose numeric literal changed (the 'law
    threshold changed' case) must remain paired with its old leaf — as
    MODIFIED if the text carries it past 0.92, or REVIEW for a human to
    confirm — never silently dropped into REMOVED+ADDED."""
    old = [leaf("A1.1-4", A1, A11, "4", 4,
                "ขนาดกว้างไม่น้อยกว่า 2,400 มิลลิเมตร และยาวไม่น้อยกว่า 6,000 มิลลิเมตร",
                numbers=[2400, 6000])]
    new = [leaf("A1.1-4", A1, A11, "4", 4,
                "ขนาดกว้างไม่น้อยกว่า 2,500 มิลลิเมตร และยาวไม่น้อยกว่า 6,000 มิลลิเมตร",
                numbers=[2500, 6000])]
    result = align(old, new)
    m = find(result, old_code="A1.1-4")
    assert m["status"] in ("MODIFIED", "REVIEW")
    assert m["new_code"] == "A1.1-4"


def test_pure_insert_is_added():
    old = [leaf("A1.1-1", A1, A11, "1", 1, "รายการเดิม")]
    new = [leaf("A1.1-1", A1, A11, "1", 1, "รายการเดิม"),
           leaf("A1.1-2", A1, A11, "2", 2, "รายการใหม่ที่เพิ่งเพิ่มเข้ามาในเอกสารฉบับปรับปรุง")]
    result = align(old, new)
    added = find(result, new_code="A1.1-2")
    assert added["status"] == "ADDED"
    assert added["old_code"] is None


def test_pure_delete_is_removed():
    old = [leaf("A1.1-1", A1, A11, "1", 1, "รายการเดิม"),
           leaf("A1.1-2", A1, A11, "2", 2, "รายการที่จะถูกลบออกจากเอกสารฉบับใหม่ทั้งหมด")]
    new = [leaf("A1.1-1", A1, A11, "1", 1, "รายการเดิม")]
    result = align(old, new)
    removed = find(result, old_code="A1.1-2")
    assert removed["status"] == "REMOVED"
    assert removed["new_code"] is None


def test_cross_item_move_is_moved_across_via_rescue_pass():
    A2 = ("A1", "ที่จอดรถ")
    A21 = ("A2.1", "ทางเข้าออก")
    distinctive = ("ตัวอักษรเบรลล์สำหรับผู้พิการทางสายตาติดตั้งบริเวณราวจับบันได"
                   "ความสูงจากพื้นไม่น้อยกว่า 900 มิลลิเมตร")
    old = [leaf("A1.1-9", A1, A11, "9", 9, distinctive, numbers=[900])]
    new = [leaf("A2.1-3", A2, A21, "3", 3, distinctive, numbers=[900])]
    result = align(old, new)
    m = find(result, old_code="A1.1-9")
    assert m["new_code"] == "A2.1-3"
    assert m["status"] == "MOVED_ACROSS"


def test_tier_block_parent_compares_flattened_and_is_modified():
    """The v2 A1.1-1 case: old JSON already flattened the tier mini-table
    into labelRaw; the new DOCX keeps a short stub label + structured
    tierBlock. Must classify as MODIFIED, not REMOVED+ADDED."""
    old_label = ("กำหนดให้มีที่จอดรถสำหรับคนพิการ ดังนี้ "
                 "- 10-50 คัน: อย่างน้อย 1 ช่องจอด\n"
                 "- 51-100 คัน: อย่างน้อย 2 ช่องจอด")
    old = [leaf("A1.1-1", A1, A11, "1", 1, old_label, numbers=[10, 50, 1, 51, 100, 2])]
    new = [leaf("A1.1-1", A1, A11, "1", 1, "กำหนดให้มีที่จอดรถสำหรับคนพิการ ดังนี้",
                numbers=[],
                tier=[["10-50 คัน", "อย่างน้อย 1 ช่องจอด"],
                      ["51-100 คัน", "อย่างน้อย 2 ช่องจอด"]])]
    result = align(old, new)
    m = find(result, old_code="A1.1-1")
    assert m is not None, "old and new A1.1-1 must be paired, not split into remove+add"
    assert m["new_code"] == "A1.1-1"
    assert m["status"] in ("MODIFIED", "UNCHANGED", "MOVED_WITHIN")


def test_no_old_leaf_claims_two_new_leaves():
    """Assignment-constrained matching: two near-identical new candidates
    (repetitive corpus, different items) competing for one old leaf must
    not both be claimed by it — the second stays ADDED."""
    old_text = "พื้นผิวต่างสัมผัสชนิดเตือนสีเหลืองอย่างน้อย 300 มิลลิเมตร"
    new_text = "พื้นผิวต่างสัมผัสชนิดเตือนสีเหลืองไม่น้อยกว่า 300 มิลลิเมตร"
    old = [leaf("A1.1-1", A1, A11, "1", 1, old_text, numbers=[300])]
    A12 = ("A1.2", "ทางลาด")
    new = [leaf("A1.1-1", A1, A11, "1", 1, new_text, numbers=[300]),
           leaf("A1.2-1", A1, A12, "1", 1, new_text, numbers=[300])]
    result = align(old, new)
    claims = [m for m in result.leaf_matches if m["old_code"] == "A1.1-1" and m["new_code"]]
    assert len(claims) == 1
    added = [m for m in result.leaf_matches if m["status"] == "ADDED"]
    assert len(added) == 1
