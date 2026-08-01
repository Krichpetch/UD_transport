"""Synthetic-fixture tests for convert_masterlist.py -- no real station data, per this project's
confidentiality convention (real สนข./masterlist content never lands in a committed test
fixture). The known UTM pair below is back-computed with pyproj for an arbitrary Bangkok-area
coordinate, not taken from the real workbook.
"""
import math

import pandas as pd
import pytest

from convert_masterlist import (
    build_station_record,
    convert,
    derive_rail_subtype,
    in_thailand_bbox,
    repair_comma_float,
    utm47n_to_wgs84,
)

# Back-computed via pyproj for lat=13.75, lng=100.50 (see convert_masterlist docstring convention).
KNOWN_UTM_EASTING = 662176.290477137
KNOWN_UTM_NORTHING = 1520582.4943602537
KNOWN_LAT = 13.75
KNOWN_LNG = 100.50


def make_row(**overrides) -> pd.Series:
    base = {
        "ลำดับ": 1,
        "ประเภทการเดินทาง": "ทางบก",
        "ประเภทสถานี": "สถานีขนส่งผู้โดยสาร",
        "ชื่อสถานี": "สถานีทดสอบ",
        "จังหวัด": "ทดสอบ",
        "หน่วยงานรับผิดชอบ": "กรมการขนส่งทางบก (ขบ.)",
        "สาย/เส้นทาง": None,
        "ละติจูด": None,
        "ลองจิจูด": None,
        "Matched_Name_File2": None,
        "X_File2": None,
        "Y_File2": None,
        "Match_Status": None,
    }
    base.update(overrides)
    return pd.Series(base)


class TestRailSubtypeDerivation:
    def test_metro_station_type_maps_to_rot_fai_fah(self):
        assert derive_rail_subtype("ทางราง", "สถานีรถไฟฟ้า") == "รถไฟฟ้า"

    def test_generic_and_junction_station_types_map_to_rot_fai(self):
        assert derive_rail_subtype("ทางราง", "สถานี") == "รถไฟ"
        assert derive_rail_subtype("ทางราง", "สถานีชุมทาง") == "รถไฟ"

    def test_non_rail_mode_has_no_subtype(self):
        assert derive_rail_subtype("ทางบก", "สถานีขนส่งผู้โดยสาร") is None


class TestCommaRepair:
    def test_strips_leading_comma(self):
        assert repair_comma_float(",99.7215186") == pytest.approx(99.7215186)

    def test_strips_trailing_comma(self):
        assert repair_comma_float("99.620446,") == pytest.approx(99.620446)

    def test_plain_numeric_string_unaffected(self):
        assert repair_comma_float("13.297854") == pytest.approx(13.297854)

    def test_native_float_passthrough(self):
        assert repair_comma_float(13.5) == 13.5

    def test_missing_value_is_none(self):
        assert repair_comma_float(None) is None
        assert repair_comma_float(float("nan")) is None

    def test_unparsable_value_is_none(self):
        assert repair_comma_float("not-a-number") is None


class TestUtmConversionAndBbox:
    def test_known_utm_pair_converts_to_expected_latlng(self):
        lat, lng = utm47n_to_wgs84(KNOWN_UTM_EASTING, KNOWN_UTM_NORTHING)
        assert lat == pytest.approx(KNOWN_LAT, abs=1e-6)
        assert lng == pytest.approx(KNOWN_LNG, abs=1e-6)

    def test_bbox_accepts_known_good_point(self):
        assert in_thailand_bbox(KNOWN_LAT, KNOWN_LNG) is True

    def test_bbox_rejects_point_outside_thailand(self):
        assert in_thailand_bbox(35.0, 139.0) is False  # Tokyo-ish, nowhere near Thailand


class TestResolveCoordsViaBuildRecord:
    def test_native_coords_take_priority(self):
        row = make_row(ละติจูด=13.75, ลองจิจูด=100.50, X_File2="999", Y_File2=999)
        record, anomaly = build_station_record(row)
        assert record["lat"] == 13.75
        assert record["lng"] == 100.50
        assert record["coordSource"] == "NATIVE"
        assert record["coordStatus"] == "OK"
        assert anomaly is None

    def test_file2_direct_wgs84_pair(self):
        row = make_row(X_File2="100.548656", Y_File2=13.813195)
        record, anomaly = build_station_record(row)
        assert record["lat"] == pytest.approx(13.813195)
        assert record["lng"] == pytest.approx(100.548656)
        assert record["coordSource"] == "FILE2"
        assert anomaly is None

    def test_file2_comma_repaired_is_flagged_as_anomaly(self):
        row = make_row(X_File2=",99.7215186", Y_File2=13.297854)
        record, anomaly = build_station_record(row)
        assert record["lng"] == pytest.approx(99.7215186)
        assert anomaly is not None
        assert anomaly["anomalyType"] == "COMMA_REPAIRED"

    def test_file2_utm_pair_converts_and_flags_anomaly(self):
        row = make_row(X_File2=KNOWN_UTM_EASTING, Y_File2=KNOWN_UTM_NORTHING)
        record, anomaly = build_station_record(row)
        assert record["coordSource"] == "FILE2_UTM"
        assert record["coordStatus"] == "OK"
        assert record["lat"] == pytest.approx(KNOWN_LAT, abs=1e-6)
        assert record["lng"] == pytest.approx(KNOWN_LNG, abs=1e-6)
        assert anomaly is not None
        assert anomaly["anomalyType"] == "UTM_CONVERTED"

    def test_utm_conversion_landing_outside_bbox_is_rejected_not_seeded(self):
        # A tiny, clearly-bogus "northing" (>90 triggers the UTM branch) that converts to
        # somewhere nowhere near Thailand -- must be rejected to the anomaly report, never
        # written into the DB as a fabricated location.
        row = make_row(X_File2=100.0, Y_File2=100.0)
        record, anomaly = build_station_record(row)
        assert record["lat"] is None
        assert record["lng"] is None
        assert record["coordStatus"] == "PENDING_COORDS"
        assert record["coordSource"] == "NONE"
        assert anomaly["anomalyType"] == "UTM_OUT_OF_BBOX"

    def test_no_coords_at_all_passes_through_as_pending(self):
        row = make_row()
        record, anomaly = build_station_record(row)
        assert record["lat"] is None
        assert record["lng"] is None
        assert record["coordStatus"] == "PENDING_COORDS"
        assert record["coordSource"] == "NONE"
        assert anomaly["anomalyType"] == "NO_COORDS"


class TestFieldMapping:
    def test_water_mode_kept_as_canonical_value(self):
        row = make_row(ประเภทการเดินทาง="ทางน้ำ", ประเภทสถานี="ท่าเรือโดยสาร")
        record, _ = build_station_record(row)
        assert record["mode"] == "ทางน้ำ"

    def test_null_line_becomes_empty_string(self):
        row = make_row(**{"สาย/เส้นทาง": None})
        record, _ = build_station_record(row)
        assert record["line"] == ""

    def test_present_line_is_kept(self):
        row = make_row(**{"สาย/เส้นทาง": "สายสีเขียว"})
        record, _ = build_station_record(row)
        assert record["line"] == "สายสีเขียว"

    def test_null_province_stays_null(self):
        row = make_row(จังหวัด=None)
        record, _ = build_station_record(row)
        assert record["province"] is None

    def test_provenance_fields_kept(self):
        row = make_row(Matched_Name_File2="ชื่อจากไฟล์2", Match_Status="Exact Match")
        record, _ = build_station_record(row)
        assert record["matchedNameFile2"] == "ชื่อจากไฟล์2"
        assert record["coordMatchStatus"] == "Exact Match"


class TestDuplicateNameDifferentLineOrMode:
    def test_same_name_different_line_same_mode_produces_two_stations(self):
        df = pd.DataFrame([
            make_row(ลำดับ=1, ประเภทการเดินทาง="ทางราง", ชื่อสถานี="กรุงธนบุรี", **{"สาย/เส้นทาง": "สายสีเขียว"}),
            make_row(ลำดับ=2, ประเภทการเดินทาง="ทางราง", ชื่อสถานี="กรุงธนบุรี", **{"สาย/เส้นทาง": "สายสีทอง"}),
        ])
        records, anomalies = convert(df)
        assert len(records) == 2
        lines = {r["line"] for r in records}
        assert lines == {"สายสีเขียว", "สายสีทอง"}

    def test_same_name_different_mode_produces_two_stations_no_cross_mode_bleed(self):
        # ท่าช้าง: a pier AND a rail station sharing a name.
        df = pd.DataFrame([
            make_row(ลำดับ=1, ประเภทการเดินทาง="ทางน้ำ", ประเภทสถานี="ท่าเรือโดยสาร", ชื่อสถานี="ท่าช้าง"),
            make_row(ลำดับ=2, ประเภทการเดินทาง="ทางราง", ประเภทสถานี="สถานี", ชื่อสถานี="ท่าช้าง"),
        ])
        records, anomalies = convert(df)
        assert len(records) == 2
        modes = {r["mode"] for r in records}
        assert modes == {"ทางน้ำ", "ทางราง"}

    def test_true_identity_collision_raises(self):
        df = pd.DataFrame([
            make_row(ลำดับ=1, ชื่อสถานี="ซ้ำกัน"),
            make_row(ลำดับ=2, ชื่อสถานี="ซ้ำกัน"),
        ])
        with pytest.raises(ValueError, match="duplicate"):
            convert(df)


class TestConvertDeterminism:
    def test_convert_is_idempotent_on_repeated_calls(self):
        df = pd.DataFrame([
            make_row(ลำดับ=1, ชื่อสถานี="สถานีเอ"),
            make_row(ลำดับ=2, ชื่อสถานี="สถานีบี", X_File2="100.1", Y_File2=13.1),
        ])
        records1, anomalies1 = convert(df)
        records2, anomalies2 = convert(df)
        assert records1 == records2
        assert anomalies1 == anomalies2
