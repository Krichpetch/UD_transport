"""Unit tests for docx_parser.bucket() — the positional cell-assignment
invariant that replaced interval-overlap scoring (see checklist_migration_design.md
§1.2 and the "hard-won implementation knowledge" notes in the migration task).

Cell lists are synthesized directly; no DOCX involved.
"""
from docx_parser import Cell, bucket


def cell(text, c0, span=1, fill=None, pad=False):
    c = Cell(text, c0, span, None, fill)
    c.pad = pad
    return c


# A "no year-split" column map: group | item | crit | present | absent |
# std | nostd | remark — used for tests that don't care about 2548/2564.
PLAIN_COLS = {
    "group": (0, 1), "item": (1, 2), "crit": (2, 3),
    "present": (3, 4), "absent": (4, 5), "std": (5, 6), "nostd": (6, 7),
    "remark": (7, 9),
}

# A year-split column map (r=1 vs r=2 remark cells).
YEAR_COLS = {
    "group": (0, 1), "item": (1, 2), "crit": (2, 3),
    "present": (3, 4), "absent": (4, 5), "std": (5, 6), "nostd": (6, 7),
    "y2548": (7, 8), "y2564": (8, 9),
}


def test_shifted_row_assigns_positionally_not_by_interval():
    """Header intervals declare small grid columns, but this data row's
    cells sit far to the right (the documented grid-shift pathology).
    bucket() must still resolve group/item/crit/tail by cell ORDER."""
    row = [
        cell("A1", 0), cell("(A1.1)", 1), cell("ลักษณะ X", 50),
        cell("มี", 51), cell("ไม่มี", 52), cell("ได้มาตรฐาน", 53),
        cell("ไม่ได้มาตรฐาน", 54), cell("remark val", 55),
    ]
    b = bucket(row, PLAIN_COLS)
    assert [c.text for c in b["group"]] == ["A1"]
    assert [c.text for c in b["item"]] == ["(A1.1)"]
    assert [c.text for c in b["crit"]] == ["ลักษณะ X"]
    assert [c.text for c in b["present"]] == ["มี"]
    assert [c.text for c in b["absent"]] == ["ไม่มี"]
    assert [c.text for c in b["std"]] == ["ได้มาตรฐาน"]
    assert [c.text for c in b["nostd"]] == ["ไม่ได้มาตรฐาน"]
    assert [c.text for c in b["remark"]] == ["remark val"]


def test_wide_group_cell_bleeds_into_item_interval():
    """A wide group cell ('A2) ...' spanning grid cols 0-2) overlaps the
    header's declared item interval. Positional assignment must still put
    it under 'group', not split/misassign it against 'item'."""
    row = [
        cell("A2) ทางเข้า-ทางออก", 0, span=3),
        cell("(A2.1) รายการที่หนึ่ง", 3),
        cell("ลักษณะ", 4),
        cell("มี", 5), cell("ไม่มี", 6), cell("ได้", 7), cell("ไม่ได้", 8),
        cell("remark", 9),
    ]
    b = bucket(row, PLAIN_COLS)
    assert [c.text for c in b["group"]] == ["A2) ทางเข้า-ทางออก"]
    assert [c.text for c in b["item"]] == ["(A2.1) รายการที่หนึ่ง"]


def test_tier_row_puts_multiple_cells_under_crit():
    """A tier sub-row has >1 non-tail cell — bucket() groups them all under
    'crit'; the caller (parse_detail_table) is what decides len>=2 means
    'this is a tier row', but bucket() must hand back all of them."""
    row = [
        cell("", 0), cell("", 1),
        cell("10-50 คัน", 2), cell("อย่างน้อย 1 ช่องจอด", 3),
        cell("มี", 4), cell("ไม่มี", 5), cell("ได้", 6), cell("ไม่ได้", 7),
        cell("remark", 8),
    ]
    b = bucket(row, PLAIN_COLS)
    assert [c.text for c in b["crit"]] == ["10-50 คัน", "อย่างน้อย 1 ช่องจอด"]


def test_padded_row_excludes_padding_cells():
    """A row that tiles short of the table grid gets a synthetic pad cell
    appended by densify(). bucket() must ignore it entirely — it is layout,
    not data — and not let it shift positional counting."""
    with_pad = [
        cell("A1", 0), cell("(A1.1)", 1), cell("ลักษณะ X", 2),
        cell("มี", 3), cell("ไม่มี", 4), cell("ได้", 5), cell("ไม่ได้", 6),
        cell("remark", 7),
        cell("", 9, span=2, pad=True),
    ]
    without_pad = [c for c in with_pad if not c.pad]

    b_padded = bucket(with_pad, PLAIN_COLS)
    b_clean = bucket(without_pad, PLAIN_COLS)

    assert {k: [c.text for c in v] for k, v in b_padded.items()} == \
           {k: [c.text for c in v] for k, v in b_clean.items()}
    assert [c.text for c in b_padded["crit"]] == ["ลักษณะ X"]
    assert [c.text for c in b_padded["remark"]] == ["remark"]


def test_remark_r2_when_penultimate_cell_overlaps_y2548():
    """Two separate remark cells (2548 and 2564 both carry their own grid
    columns) -> r=2, both years captured."""
    row = [
        cell("A1", 0), cell("(A1.1)", 1), cell("ลักษณะ X", 2),
        cell("มี", 3), cell("ไม่มี", 4), cell("ได้", 5), cell("ไม่ได้", 6),
        cell("200", 7),   # sits inside y2548 interval (7, 8)
        cell("150", 8),   # sits inside y2564 interval (8, 9)
    ]
    b = bucket(row, YEAR_COLS)
    assert [c.text for c in b["y2548"]] == ["200"]
    assert [c.text for c in b["y2564"]] == ["150"]


def test_remark_r1_single_cell_spans_both_years():
    """A single remark cell covering both years -> r=1; the cell is
    reported under y2564 and y2548 is explicitly emptied (not omitted),
    per the 'a single remark cell spanning both years reports under both
    keys' comment in bucket()."""
    row = [
        cell("A1", 0), cell("(A1.1)", 1), cell("ลักษณะ X", 2),
        cell("มี", 3), cell("ไม่มี", 4), cell("ได้", 5), cell("ไม่ได้", 6),
        cell("only one remark value", 7),  # penultimate == nostd itself here
    ]
    b = bucket(row, YEAR_COLS)
    assert [c.text for c in b["y2564"]] == ["only one remark value"]
    assert b["y2548"] == []


def test_remark_r2_requires_strict_positive_overlap_not_just_ge():
    """Regression guard for hard-won knowledge note #2: the r=2 decision
    uses `ov(y2548) >= ov(nostd) and ov(y2548) > 0` — a bare `>` on the
    first comparison would lose ties and silently drop real 2548 values.
    Here the penultimate cell (the y2548 tail slot) straddles the nostd/
    y2548 boundary and overlaps BOTH equally (a tie), and must still be
    classified r=2, not fall back to r=1."""
    row = [
        cell("A1", 0), cell("(A1.1)", 1), cell("ลักษณะ X", 2),
        cell("มี", 3), cell("ไม่มี", 4), cell("ได้", 5), cell("ไม่ได้", 6),
        cell("200", 6, span=2),   # spans nostd(6,7) and y2548(7,8): tie, ov=1 each
        cell("150", 8),
    ]
    b = bucket(row, YEAR_COLS)
    assert [c.text for c in b["y2548"]] == ["200"]
    assert [c.text for c in b["y2564"]] == ["150"]
