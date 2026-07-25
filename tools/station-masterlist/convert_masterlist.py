"""One-time Excel -> JSON conversion for the station masterlist cutover.

Merged_Station_Coordinates_V2.xlsx (823 rows, human-owned source, gitignored under input/) is
the ONLY source of station master data going forward. This script is deterministic/idempotent:
running it twice on the same input produces byte-identical output.

Identity is (mode, name, line) — never name alone. Null line is treated as "" for the identity
key (see build_station_record) since 30+ legitimately distinct stations share a name across
lines/modes (e.g. กรุงธนบุรี on two metro lines, ท่าช้าง as both a pier and a rail station).

Coordinate resolution priority per row:
  1. Native ละติจูด/ลองจิจูด when both present -> coordSource NATIVE.
  2. Else File2 (X_File2=longitude, Y_File2=latitude), after repairing stray commas:
     - if Y_File2 > 90, the pair is UTM 47N (EPSG:32647) easting/northing, not WGS84 -> convert,
       coordSource FILE2_UTM. Converted coords are sanity-asserted inside Thailand's bbox; a
       failure is an anomaly, not a DB row.
     - else the pair is already WGS84 -> coordSource FILE2.
  3. Else -> no coordinates; coordStatus PENDING_COORDS, coordSource NONE. Real stations that
     cannot pass the proximity gate until coords are supplied -- never fabricate a fallback.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

import pandas as pd
from pyproj import Transformer

# Same data-quality fix seed-templates.ts already applies to checklist templates: the source
# workbook's own term for water transport is "ทางน้ำ", not this project's canonical
# TransportMode "ทางเรือ" (CLAUDE.md taxonomy).
def normalize_mode(raw: str) -> str:
    return "ทางเรือ" if raw == "ทางน้ำ" else raw


# ครม.-taxonomy station types (CLAUDE.md) map onto the raw ประเภทสถานี values in this workbook.
# "สถานี" / "สถานีชุมทาง" are the RFT's generic/junction terms for a รถไฟ (train, not metro) stop.
RAIL_SUBTYPE_BY_STATION_TYPE = {
    "สถานีรถไฟฟ้า": "รถไฟฟ้า",
    "สถานี": "รถไฟ",
    "สถานีชุมทาง": "รถไฟ",
}

THAILAND_BBOX = {"lat_min": 5.5, "lat_max": 20.6, "lng_min": 97.3, "lng_max": 105.7}

_UTM47N_TO_WGS84 = Transformer.from_crs("EPSG:32647", "EPSG:4326", always_xy=True)


def in_thailand_bbox(lat: float, lng: float) -> bool:
    return (
        THAILAND_BBOX["lat_min"] <= lat <= THAILAND_BBOX["lat_max"]
        and THAILAND_BBOX["lng_min"] <= lng <= THAILAND_BBOX["lng_max"]
    )


def repair_comma_float(raw: Any) -> float | None:
    """Parse a File2 X/Y cell that may carry stray thousands-style commas
    (e.g. ',99.7215186' or '99.620446,') or already be numeric. Returns None
    for missing/unparsable values -- caller decides how to treat that."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip().replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def utm47n_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    """Returns (lat, lng). pyproj's always_xy Transformer takes/returns (x, y) = (lng-ish, lat-ish)
    order for geographic CRS, i.e. (lng, lat) out -- flipped here to this project's (lat, lng)
    convention (see Station.lat / Station.lng)."""
    lng, lat = _UTM47N_TO_WGS84.transform(easting, northing)
    return lat, lng


def derive_rail_subtype(mode: str, station_type: str) -> str | None:
    if mode != "ทางราง":
        return None
    return RAIL_SUBTYPE_BY_STATION_TYPE.get(station_type)


def resolve_coords(row: pd.Series) -> dict[str, Any]:
    """Returns lat, lng, coordSource, coordStatus, and an optional anomaly dict (None if the
    row's coordinates resolved cleanly with nothing worth flagging)."""
    native_lat, native_lng = row.get("ละติจูด"), row.get("ลองจิจูด")
    if pd.notna(native_lat) and pd.notna(native_lng):
        return {
            "lat": float(native_lat), "lng": float(native_lng),
            "coordSource": "NATIVE", "coordStatus": "OK", "anomaly": None,
        }

    raw_x, raw_y = row.get("X_File2"), row.get("Y_File2")
    x = repair_comma_float(raw_x)
    y = repair_comma_float(raw_y)
    comma_repaired = isinstance(raw_x, str) and "," in raw_x or isinstance(raw_y, str) and "," in raw_y

    if x is None or y is None:
        return {
            "lat": None, "lng": None, "coordSource": "NONE", "coordStatus": "PENDING_COORDS",
            "anomaly": {"type": "NO_COORDS", "detail": f"raw X_File2={raw_x!r} Y_File2={raw_y!r}"},
        }

    if y > 90:
        lat, lng = utm47n_to_wgs84(x, y)
        if not in_thailand_bbox(lat, lng):
            return {
                "lat": None, "lng": None, "coordSource": "NONE", "coordStatus": "PENDING_COORDS",
                "anomaly": {
                    "type": "UTM_OUT_OF_BBOX",
                    "detail": f"UTM(easting={x}, northing={y}) -> (lat={lat}, lng={lng}) outside Thailand bbox",
                },
            }
        anomaly = {"type": "UTM_CONVERTED", "detail": f"UTM(easting={x}, northing={y}) -> (lat={lat}, lng={lng})"}
        if comma_repaired:
            anomaly["detail"] += f" | comma-repaired from raw X={raw_x!r} Y={raw_y!r}"
        return {"lat": lat, "lng": lng, "coordSource": "FILE2_UTM", "coordStatus": "OK", "anomaly": anomaly}

    # Direct WGS84 pair: X_File2 is longitude, Y_File2 is latitude.
    anomaly = None
    if comma_repaired:
        anomaly = {"type": "COMMA_REPAIRED", "detail": f"raw X={raw_x!r} Y={raw_y!r} -> lng={x}, lat={y}"}
    return {"lat": y, "lng": x, "coordSource": "FILE2", "coordStatus": "OK", "anomaly": anomaly}


def build_station_record(row: pd.Series) -> tuple[dict[str, Any], dict[str, Any] | None]:
    mode = normalize_mode(row["ประเภทการเดินทาง"])
    name = row["ชื่อสถานี"]
    line = row.get("สาย/เส้นทาง")
    line = "" if pd.isna(line) else str(line).strip()
    province = row.get("จังหวัด")
    province = None if pd.isna(province) else str(province).strip()
    station_type = row["ประเภทสถานี"]

    coords = resolve_coords(row)
    matched_name = row.get("Matched_Name_File2")
    matched_name = None if pd.isna(matched_name) else str(matched_name)
    match_status = row.get("Match_Status")
    match_status = None if pd.isna(match_status) else str(match_status)

    record = {
        "sourceRow": int(row["ลำดับ"]),
        "mode": mode,
        "name": name,
        "nameTh": name,
        "line": line,
        "stationType": station_type,
        "railSubtype": derive_rail_subtype(mode, station_type),
        "province": province,
        "region": None,  # derived downstream (region-lookup is app-side, not this script's job)
        "responsibleAgency": row["หน่วยงานรับผิดชอบ"],
        "lat": coords["lat"],
        "lng": coords["lng"],
        "coordSource": coords["coordSource"],
        "coordStatus": coords["coordStatus"],
        "coordMatchStatus": match_status,
        "matchedNameFile2": matched_name,
    }

    anomaly_row = None
    if coords["anomaly"] is not None:
        anomaly_row = {
            "sourceRow": record["sourceRow"],
            "name": name,
            "mode": mode,
            "line": line,
            "anomalyType": coords["anomaly"]["type"],
            "detail": coords["anomaly"]["detail"],
        }
    return record, anomaly_row


def convert(df: pd.DataFrame) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    anomalies: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        record, anomaly = build_station_record(row)
        records.append(record)
        if anomaly is not None:
            anomalies.append(anomaly)

    seen: dict[tuple[str, str, str], int] = {}
    for i, r in enumerate(records):
        key = (r["mode"], r["name"], r["line"])
        if key in seen:
            raise ValueError(
                f"duplicate (mode, name, line) identity at rows {seen[key]} and {i}: {key!r}"
            )
        seen[key] = i

    return records, anomalies


def write_outputs(records: list[dict[str, Any]], anomalies: list[dict[str, Any]], json_path: Path, csv_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    csv_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["sourceRow", "name", "mode", "line", "anomalyType", "detail"]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in anomalies:
            writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="input/Merged_Station_Coordinates_V2.xlsx")
    parser.add_argument("--output-json", default="output/stations_master_v2.json")
    parser.add_argument("--output-anomalies", default="output/masterlist_anomalies.csv")
    args = parser.parse_args()

    df = pd.read_excel(args.input)
    records, anomalies = convert(df)
    write_outputs(records, anomalies, Path(args.output_json), Path(args.output_anomalies))
    print(f"{len(records)} station records -> {args.output_json}")
    print(f"{len(anomalies)} anomalies -> {args.output_anomalies}")


if __name__ == "__main__":
    main()
