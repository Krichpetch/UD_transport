# UD Transport — Checklist Data Dictionary v2 (E-form Redesign)

**Status:** PROVISIONAL — derived from the 4 completed "ฉบับปรับปรุง" checklist workbooks (Rail/Water/Air/Land), 2026-07. Numbering follows the revised สนข. forms, NOT the old OTP data dictionary (2566-04). Expect revisions from สนข.

**Machine-readable seeds:** `template_rail_v2.json`, `template_water_v2.json`, `template_air_v2.json`, `template_land_v2.json` — these files ARE the source of truth; this document describes them.

---

## 1. Hierarchy

Four levels, three of them stored as nested `subItems`:

| Level | Example code | Example | Stored as |
|---|---|---|---|
| Group (กลุ่ม) | `A1` | ที่จอดรถ | `groups[]` |
| Item (รายการตรวจสอบ) | `A1.1` | ที่จอดรถสำหรับคนพิการ | `groups[].items[]` |
| Criterion (ลักษณะ ระดับ 1) | `A1.1-1` | 1. กรณีทางลาดที่ความยาวไม่เกิน 2,500 มม. | `items[].subItems[]` |
| Sub-criterion (ลักษณะ ระดับ 2) | `A1.1-1.1` | 1.1 มีทางลาดในบริเวณพื้นที่ต่างระดับ… | `subItems[].subItems[]` |

- Criterion codes are `"{itemCode}-{n}"`, sub-criteria `"{itemCode}-{n.m}"` — globally unique within a template, stable across template versions of the same mode.
- Sub-criteria are optional: a criterion with no children is itself the answerable leaf.
- The **item (A1.1) level is what the current system scores today** (one ผ่าน/พอใช้/ควรปรับปรุง per item). In v2 the auditor answers at the **leaf** level; the item-level grade becomes a rollup (rule to be fixed in Session E1 Part E and confirmed with สนข.).

## 2. Answer model (the actual สนข. paper form)

Each leaf row on the paper form has four checkboxes: มี / ไม่มี / ได้มาตรฐาน / ไม่ได้มาตรฐาน. Some rows have the two standards boxes grayed out (no standards assessment applies). This produces exactly two leaf `answerType` values:

| answerType | Auditor answers | Source-form signal |
|---|---|---|
| `presence_standard` | มี/ไม่มี, then ได้มาตรฐาน/ไม่ได้มาตรฐาน (standards answer only meaningful when มี) | normal row |
| `presence` | มี/ไม่มี only | ได้มาตรฐาน/ไม่ได้มาตรฐาน cells grayed |

Relationship to the E1 schema's `answerType: 'choice' | 'boolean' | 'measured'`: **these two replace `choice` for v2 templates.** `presence` ≈ `boolean`; `presence_standard` is a dependent two-part answer (new).

### Measurements (DECIDED: measured-value capture is IN)

Any leaf whose criterion involves a physical dimension carries a `measurements[]` array — the measurement is a **criterion of the item, stored as editable template data** (admin back-office can change thresholds without code or migration):

```json
"measurements": [
  { "key": "m1", "operator": "gte" | "lte" | "range",
    "value": 90, "value2": null,
    "unit": "cm",
    "sourceText": "ไม่น้อยกว่า 900 มิลลิเมตร",
    "autoGrade": true,
    "extracted": true, "confirmed": false } ]
```

- **Canonical unit is CENTIMETERS.** Source forms use มิลลิเมตร; all values were converted (900 มม. → 90). The auditor E-form renders one numeric input (cm) per measurement.
- `autoGrade: true` → ได้มาตรฐาน/ไม่ได้มาตรฐาน is **derived** by comparing the auditor's entered value against the threshold (gte / lte / range inclusive); the auditor enters numbers, not the standards verdict, for these leaves. Presence (มี/ไม่มี) stays manual.
- **Slopes are the one non-cm unit**: `unit: "ratio_1_x"` (e.g. ความลาดชันไม่เกิน 1:12 → auditor inputs the X of 1:X; X ≥ 12 passes). Confirm this input convention with สนข. — degrees are the alternative.
- `extracted: true, confirmed: false` marks machine-extracted thresholds pending human review — see `threshold_review.csv` (803 rows). Review workflow: admin confirms/corrects values; `confirmed` flips true. Extraction coverage: 615 of 1,522 leaves (rail 181 / land 175 / air 173 / water 86).
- Auditor answer shape for measurement leaves: `{ present: boolean, values?: { m1: number, ... }, meetsStandard: derived }`.

### Era-dependent criteria (UPDATED 2026-07-19: year-built is AUDITOR INPUT)

Two mechanisms, both driven by the station's build year (Buddhist year, entered by the **auditor** in the E-form before answering — NOT master data from สนข.):

1. **Item applicability** — items exist/vanish per era, derived by filtering the template's `lawRefs` against the laws in force for the build year (already representable; no per-era template copies).
2. **Value variance** — the same criterion carries different threshold values per era. Modeled with an optional `byLaw` wrapper on any measurement:

```json
"measurements": [{
  "key": "m1", "operator": "tiered", "unit": "count",
  "inputs": [
    { "key": "basis",    "labelTh": "จำนวนที่จอดรถทั้งหมด (คัน)" },
    { "key": "provided", "labelTh": "จำนวนที่จอดรถสำหรับคนพิการ (ช่อง)" } ],
  "byLaw": {
    "MHT_2548": { "tiers": [
      { "min": 10,  "max": 50,            "required": 1 },
      { "min": 51,  "max": 100,           "required": 2 },
      { "min": 101, "required": 2, "incrementPer": 100, "incrementBy": 1 } ] },
    "MHT_2564": { "tiers": [ "…different table…" ] }
  },
  "extracted": false, "confirmed": false }]
```

- **`tiered` operator** (new, era-independent concept): the required value is a lookup on another auditor input. Auditor enters the basis (e.g. total parking) and the provided count; pass = `provided >= tierLookup(basis)`. Note the wheelchair-seating table (B3.2: 4–25 ที่นั่ง → 1 …) needs `tiered` even without era variance.
- **`byLaw`** may wrap values for ANY operator (gte/lte/range/tiered). Criteria without era variance keep flat values — no shape change for the ~95% that don't vary.
- **Resolution**: build year → for each `byLaw` group pick the latest law whose effective year ≤ year. Until สนข. supplies real enforcement dates, resolution uses `LawReference.effectiveYear ?? buddhistYear` and is flagged **provisional**. Build year < oldest law → apply oldest, flag `eraUnresolved`.
- **Stamping**: the resolved law keys are stamped on the checklist (`appliedLawRefs` + `appliedYearBuilt`) at creation, like template stamping — an audit is a record against the rules it was graded under. Correcting a station's year later affects new audits only.
- **Storage**: `Station.yearBuilt` (nullable int, Buddhist year). Auditor sets it at confirm-to-start; pre-filled and editable on later audits; every change audit-logged.
- **Maintenance path**: era-varying criteria live in per-mode `era_overrides_{mode}.json` files merged onto the base v2 seeds by script — the base workbooks/converter pipeline stays untouched, and สนข. revisions edit one small file.

Scoring note (for E1 Part E parity): the current v1 convention excludes bare `มี` answers from denominators; `presence` leaves are the structural descendants of that convention — the rollup design must state explicitly whether `presence` leaves count toward standards percentages (recommended: they count toward การจัดให้มีฯ but not การได้มาตรฐาน). Derived (auto-graded) standards verdicts count in การได้มาตรฐาน exactly like manual ones.

## 3. JSON shape (per template file)

```json
{
  "schemaVersion": 2,
  "mode": "ทางราง",
  "answerTypes": { "...documentation only..." },
  "source": "Checklist_Rail_Complete.xlsx",
  "provisional": true,
  "groups": [
    { "code": "A1", "labelTh": "ที่จอดรถ", "items": [
      { "code": "A1.1", "labelTh": "ที่จอดรถสำหรับคนพิการ", "subItems": [
        { "code": "A1.1-1", "num": "1", "labelTh": "…",
          "answerType": "presence_standard" },
        { "code": "A1.1-2", "num": "2", "labelTh": "…", "subItems": [
          { "code": "A1.1-2.1", "num": "2.1", "labelTh": "…",
            "answerType": "presence" } ] } ] } ] } ]
}
```

Criteria that have children carry **no** `answerType` (they are containers); leaves always carry one.

## 4. Per-mode inventory

| Mode | Groups | Items | Criteria (L1) | Answerable leaves | `presence`-only leaves |
|---|---|---|---|---|---|
| ทางราง (rail) | 11 | 70 | 349 | 480 | 252 |
| ทางบก (land) | 10 | 65 | 305 | 430 | 206 |
| ทางอากาศ (air) | 10 | 49 | 275 | 420 | 216 |
| ทางน้ำ (water) | 7 | 23 | 122 | 192 | 96 |
| **Total** | **38** | **207** | **1,051** | **1,522** | **770** |

Old system for comparison: 4 flat item lists (air 55 / land 65 / water 26 / rail 73), one answer per item. v2 multiplies answerable detail ~7×.

## 5. Known gaps & questions for สนข. (verify before ACTIVE)

1. **Air is missing groups B4 (ห้องน้ำ) and B5 (ลิฟต์)** — group numbering jumps B3 → B6 — and B3 stops at B3.7 (old taxonomy had through B3.12). Either the revised air form genuinely renumbered/removed these, or source pages are missing from the extraction. **Check the source PDF before seeding air as ACTIVE.**
2. Water has no A2 group (old taxonomy had A2.1–A2.6); its A1 now contains connection items (A1.6 หลังคาป้องกันแดดและฝน*). Plausibly a genuine merge in the revised form — confirm.
3. Rail item count 70 vs old 73; identify the 3 removed/merged items or confirm renumbering.
4. Starred items (`*` in labels, e.g. หลังคาป้องกันแดดและฝน*) mark beyond-law project additions — cross-reference with the `beyondLaw` flag in the law-registry addendum (Part A2) during facility tagging.
5. Item-level rollup rule from leaves (Section 2 note) — product decision, needs สนข. sign-off.
6. Slope input convention (`ratio_1_x` vs degrees) and any measurement the review CSV shows as a *condition* rather than a criterion (e.g. "ระดับต่างกันเกิน 200 มม." describes when the rule applies, not what to measure) — cull these during threshold review.

## 6. Mapping to the E1 Prisma schema

- Each JSON file seeds one `ChecklistTemplate` row: `mode` = Thai mode value, `variantKey = 'standard'`, `version = 2`, `status = DRAFT` (NOT ACTIVE — v1 flat templates stay ACTIVE until parity + UI land), `definition` = the file's contents verbatim.
- `facilityCode` / `lawRefs` / `cabinetResolution` tagging (Part A2.4) applies to v2 items the same as v1 — run the same best-effort name matching.
- Existing pilot checklists remain stamped to v1 templates; nothing here migrates old answers.
