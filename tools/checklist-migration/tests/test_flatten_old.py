from flatten_old import flatten_old

SAMPLE = {
    "groups": [
        {"code": "A1", "labelTh": "ที่จอดรถ", "items": [
            {"code": "A1.1", "labelTh": "ที่จอดรถสำหรับคนพิการ", "subItems": [
                {"code": "A1.1-1", "num": "1",
                 "labelTh": "กว้างไม่น้อยกว่า 2,400 มิลลิเมตร",
                 "answerType": "presence_standard",
                 "measurements": [{"key": "m1", "operator": "gte",
                                    "value": 240.0, "unit": "cm",
                                    "confirmed": False}]},
                {"code": "A1.1-2", "num": "2",
                 "labelTh": "ป้ายสัญลักษณ์คนพิการ*",
                 "answerType": "presence"},
                {"code": "A1.1-3", "num": "3", "labelTh": "หัวข้อรวม",
                 "subItems": [
                     {"code": "A1.1-3.1", "num": "3.1",
                      "labelTh": "ข้อย่อยที่หนึ่ง",
                      "answerType": "presence_standard"},
                     {"code": "A1.1-3.2", "num": "3.2",
                      "labelTh": "ข้อย่อยที่สอง",
                      "answerType": "presence"},
                 ]},
            ]},
        ]},
    ],
}


def by_code(recs):
    return {r["code"]: r for r in recs}


def test_flattens_leaves_and_containers():
    recs = flatten_old(SAMPLE)
    codes = {r["code"] for r in recs}
    assert codes == {"A1.1-1", "A1.1-2", "A1.1-3", "A1.1-3.1", "A1.1-3.2"}

    b = by_code(recs)
    assert b["A1.1-3"]["isLeaf"] is False
    assert "answerType" not in b["A1.1-3"]
    assert b["A1.1-1"]["isLeaf"] is True
    assert b["A1.1-1"]["answerType"] == "presence_standard"


def test_ordinal_only_on_non_dot_records_parent_only_on_dot_records():
    b = by_code(flatten_old(SAMPLE))
    assert b["A1.1-1"]["ordinal"] == 1
    assert b["A1.1-2"]["ordinal"] == 2
    assert b["A1.1-3"]["ordinal"] == 3
    assert "parent" not in b["A1.1-1"]

    assert "ordinal" not in b["A1.1-3.1"]
    assert b["A1.1-3.1"]["parent"] == "3"
    assert b["A1.1-3.2"]["parent"] == "3"


def test_star_flag_and_key_strip_trailing_star():
    b = by_code(flatten_old(SAMPLE))
    rec = b["A1.1-2"]
    assert rec["star"] is True
    assert not rec["labelKey"].endswith("*")
    assert rec["meta"]["star"] is True


def test_meta_bag_carries_measurements_verbatim_and_absent_tags_are_none():
    b = by_code(flatten_old(SAMPLE))
    meta = b["A1.1-1"]["meta"]
    assert meta["measurements"][0]["confirmed"] is False
    assert meta["note"] is None
    assert meta["facilityCode"] is None
    assert meta["lawRefs"] is None


def test_path_carries_group_and_item_ancestry():
    b = by_code(flatten_old(SAMPLE))
    assert b["A1.1-1"]["path"] == ["A1", "A1.1"]
    assert b["A1.1-3.1"]["path"] == ["A1", "A1.1", "A1.1-3"]
    assert b["A1.1-1"]["group"] == {"code": "A1", "label": "ที่จอดรถ"}
    assert b["A1.1-1"]["item"] == {"code": "A1.1", "label": "ที่จอดรถสำหรับคนพิการ"}


def test_labelkey_and_numbers_use_shared_normalize_module():
    b = by_code(flatten_old(SAMPLE))
    assert b["A1.1-1"]["numbers"] == [2400.0]
    assert "2400" in b["A1.1-1"]["labelKey"]
