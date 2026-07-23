#!/usr/bin/env python3
"""
Enrich the v2 template JSONs with structured, admin-editable measurement
criteria extracted from leaf text. All linear units normalized to CM.

Adds to measurement-bearing leaves:
  "measurements": [
    { "key": "m1",
      "operator": "gte" | "lte" | "range",
      "value": <number, cm>, "value2": <number, cm — range only>,
      "unit": "cm" | "ratio_1_x",
      "sourceText": "<matched fragment>",
      "autoGrade": true,
      "extracted": true, "confirmed": false } ]

Auditor answer for such leaves gains numeric inputs (one per measurement).
`confirmed:false` = machine-extracted, pending admin review; thresholds
are template DATA and stay editable in the admin back-office.

Also writes threshold_review.csv listing every extraction for review.
"""
import csv
import json
import re
import sys
from pathlib import Path

NUM = r"(\d{1,3}(?:,\d{3})*(?:\.\d+)?)"
UNIT = r"(มิลลิเมตร|มม\.?|เซนติเมตร|ซม\.?|เมตร)"

def to_cm(num_str, unit):
    v = float(num_str.replace(",", ""))
    if unit and unit.startswith(("มิลลิเมตร", "มม")):
        v = v / 10.0
    elif unit and unit.startswith(("เซนติเมตร", "ซม")):
        pass
    elif unit == "เมตร":
        v = v * 100.0
    return round(v, 2)

# ordered, consuming patterns
PATTERNS = [
    # ไม่น้อยกว่า A (unit)? แต่ไม่เกิน B unit   -> range
    ("range",
     re.compile(rf"ไม่น้อยกว่า\s*{NUM}\s*{UNIT}?\s*(?:แต่)?\s*ไม่เกิน\s*{NUM}\s*{UNIT}")),
    # ระหว่าง/ตั้งแต่/สูงจากพื้น A-B unit        -> range
    ("range2",
     re.compile(rf"{NUM}\s*[-–]\s*{NUM}\s*{UNIT}")),
    # A x B unit                                  -> two gte dims
    ("dims",
     re.compile(rf"{NUM}\s*[xX×]\s*{NUM}\s*{UNIT}")),
    # ไม่น้อยกว่า/อย่างน้อย A unit                -> gte
    ("gte",
     re.compile(rf"(?:ไม่น้อยกว่า|อย่างน้อย)\s*{NUM}\s*{UNIT}")),
    # ไม่เกิน/เกิน A unit                          -> lte (เกิน = condition; still capture)
    ("lte",
     re.compile(rf"ไม่เกิน\s*{NUM}\s*{UNIT}")),
    # slope 1:N                                    -> ratio
    ("slope",
     re.compile(r"(?:ความลาดชัน[^0-9]{0,20})?1\s*:\s*(\d+)")),
]


def extract(text):
    out = []
    work = text
    idx = 0
    def snippet(m):
        s = max(0, m.start() - 18)
        return text[s:m.end() + 4].strip()

    # note: run on `work`, consume matches so later patterns don't re-hit
    for kind, rx in PATTERNS:
        while True:
            m = rx.search(work)
            if not m:
                break
            idx += 1
            g = m.groups()
            if kind == "range":
                a, ua, b, ub = g[0], g[1], g[2], g[3]
                unit = ua or ub
                out.append({"key": f"m{idx}", "operator": "range",
                            "value": to_cm(a, unit), "value2": to_cm(b, unit),
                            "unit": "cm", "sourceText": m.group(0).strip()})
            elif kind == "range2":
                a, b, unit = g[0], g[1], g[2]
                out.append({"key": f"m{idx}", "operator": "range",
                            "value": to_cm(a, unit), "value2": to_cm(b, unit),
                            "unit": "cm", "sourceText": m.group(0).strip()})
            elif kind == "dims":
                a, b, unit = g[0], g[1], g[2]
                out.append({"key": f"m{idx}", "operator": "gte",
                            "value": to_cm(a, unit), "unit": "cm",
                            "sourceText": m.group(0).strip() + " (กว้าง)"})
                idx += 1
                out.append({"key": f"m{idx}", "operator": "gte",
                            "value": to_cm(b, unit), "unit": "cm",
                            "sourceText": m.group(0).strip() + " (ยาว)"})
            elif kind == "gte":
                out.append({"key": f"m{idx}", "operator": "gte",
                            "value": to_cm(g[0], g[1]), "unit": "cm",
                            "sourceText": m.group(0).strip()})
            elif kind == "lte":
                out.append({"key": f"m{idx}", "operator": "lte",
                            "value": to_cm(g[0], g[1]), "unit": "cm",
                            "sourceText": m.group(0).strip()})
            elif kind == "slope":
                out.append({"key": f"m{idx}", "operator": "gte",
                            "value": float(g[0]), "unit": "ratio_1_x",
                            "sourceText": m.group(0).strip(),
                            "note": "slope 1:X — auditor inputs X; "
                                    "flatter (larger X) passes"})
            # consume
            work = work[:m.start()] + " §CONSUMED§ " + work[m.end():]
    for mm in out:
        mm["autoGrade"] = True
        mm["extracted"] = True
        mm["confirmed"] = False
    return out


def main(tdir):
    tdir = Path(tdir)
    review = []
    for key in ["rail", "water", "air", "land"]:
        p = tdir / f"template_{key}_v2.json"
        d = json.load(open(p, encoding="utf-8"))
        count = [0, 0]  # leaves-with-measurements, measurements

        def walk(nodes):
            for n in nodes:
                kids = n.get("subItems") or n.get("items")
                if kids:
                    walk(kids)
                elif "answerType" in n:
                    ms = extract(n["labelTh"])
                    if ms:
                        n["measurements"] = ms
                        count[0] += 1
                        count[1] += len(ms)
                        for mm in ms:
                            review.append([key, n["code"], mm["operator"],
                                           mm["value"], mm.get("value2", ""),
                                           mm["unit"], mm["sourceText"],
                                           n["labelTh"][:120]])
        walk(d["groups"])
        d["measurementUnit"] = "cm"
        with open(p, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        print(f"{key:6} {count[0]} leaves enriched, {count[1]} measurements")

    with open(tdir / "threshold_review.csv", "w", newline="",
              encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["mode", "leaf_code", "operator", "value_cm", "value2_cm",
                    "unit", "source_fragment", "leaf_text"])
        w.writerows(review)
    print(f"review file: {len(review)} rows -> threshold_review.csv")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "./templates")
