# Checklist Revision Migration — Architecture Design

**Project:** UD Transport Assessment System
**Scope:** Migrating `template_{mode}_v2.json` seed files to revised สนข. checklist documents (DOCX), with a reusable pipeline for all future revisions.
**Status:** Design proposal, grounded in inspection of `Rail_Checklist_Example.docx` (7 tables, mixed 7/9/12/17-column grids, 498 gridSpan / 371 vMerge cells, shading-encoded graying).

---

## 0. The central design decision: diff IR against IR, never Word against JSON

The request framed the problem as "compare the new checklist document against the existing JSON." Doing that directly couples two hard problems — DOCX parsing and semantic alignment — into one fragile step. The reliable architecture separates them completely:

```
                 STAGE 1                      STAGE 2
new DOCX ──▶ docx_parser.py ──▶ new_ir.json ──┐
                                              ├──▶ aligner.py ──▶ report + review CSV
old template JSON ──▶ flatten ──▶ old_ir.json ┘         │
                                                        ▼ (after human review)
                                              STAGE 3: merger.py ──▶ template_{mode}_v3.json
                                                                 ──▶ remarks_{mode}.json
```

Both sides are normalized into the **same canonical intermediate representation (IR)**: a flat list of leaf records, each carrying its hierarchy path, ordinal, raw text, and a normalized matching key. The differ then operates on two lists of identical shape. This buys you:

- The parser is testable in isolation ("did we extract every row?") without any diffing logic.
- The aligner is testable in isolation with synthetic fixtures (renumber a leaf, reword one, delete one — assert the classification).
- Future revisions reuse everything: next time สนข. revises the forms, only the parser's table-layout assumptions might need touching, and even those are data-driven (see §1.2).
- Your existing `convert_checklists.py` conceptually *is* Stage 1 for the xlsx era. This design gives it a DOCX sibling with the same output contract.

### IR record shape

```json
{
  "path":       ["A1", "A1.1"],
  "ordinal":    4,
  "num":        "4",
  "numSource":  "literal | numpr | positional",
  "code":       "A1.1-4",
  "labelRaw":   "<example criterion text, e.g. a dimension requirement>",
  "labelKey":   "<same text, normalized: numbering stripped, whitespace removed>",
  "numbers":    [2400, 6000],
  "isLeaf":     true,
  "answerType": "presence_standard",
  "grayed":     false,
  "tierBlock":  null,
  "remarks":    { "2548": null, "2564": null },
  "star":       false
}
```

`labelKey` is the deterministic matching key: whitespace collapsed, Thai/Arabic digits canonicalized, thousands separators stripped, punctuation variants unified (the source has typos like a dropped opening paren before `Wheelchair)`), leading numbering prefix stripped, trailing `*` stripped into the `star` flag. `numbers` is the ordered list of every numeric literal in the text — the single most discriminating feature for these legal boilerplate rows.

---

## 1. Stage 1 — DOCX parser

### 1.1 Why python-docx over pandoc/extract-text

Text extraction flattens the tables and destroys exactly the information this migration needs: gridSpan/vMerge structure (which encodes the group→item→criterion hierarchy), cell shading (which encodes `presence` vs `presence_standard`), and the split remark header (2548/2564). The parser must work at the OOXML level via `python-docx`, reading `w:tc`, `w:tcPr/w:gridSpan`, `w:tcPr/w:vMerge`, and `w:tcPr/w:shd` directly.

### 1.2 Grid resolution — the one genuinely fiddly part

The detail tables in the example file have grid widths of 9, 12, and 17 columns for the *same eight logical columns*, because Word re-splits the grid whenever a nested structure (the tiered parking mini-table) forces extra grid lines. Cell-index-based parsing is therefore guaranteed to break. The correct approach:

1. **Densify each table into an R×C grid matrix.** Walk each row's `w:tc` elements; expand horizontally by `gridSpan`; for `vMerge` continuation cells, inherit the value and origin coordinates of the cell above. Every logical cell then knows its grid-column start, span, text, shading fill, and whether it is a merge origin.
2. **Map grid columns to logical columns per table, from that table's own header.** Row 0 of every table repeats the header (`กลุ่ม | รายการตรวจสอบ | [ลักษณะ] | มี | ไม่มี | ได้มาตรฐาน | ไม่ได้มาตรฐาน | หมายเหตุ...`). Match header cell text to a fixed signature list and record each logical column's grid-column interval *for this table*. Row 1 of detail tables carries the `2548 | 2564` sub-headers — record those two grid intervals inside the remark interval. All subsequent cell-to-column assignment is by grid-interval overlap, never by index.
3. **Classify tables.** Header contains ลักษณะ → detail table (source of leaves). No ลักษณะ → overview table (source of the item inventory). Parse both.

This makes the parser layout-driven rather than assumption-driven: if the next revision of the water form uses a 14-column grid, nothing changes.

### 1.3 Row classification state machine

Within a densified detail table, classify each row:

| Row type | Signal |
|---|---|
| Header repeat | Cell texts match the header signature (tables repeat headers mid-document) — skip |
| Sub-header | `2548`/`2564` cells — record remark column intervals, skip |
| Section banner | Single cell spanning the full grid, text `^[A-C]\s` — set current section |
| Group start | กลุ่ม column cell is a vMerge *restart* matching `^[A-Z]\d+\)` — set current group |
| Item start | รายการตรวจสอบ column cell is a restart matching `^\([A-Z]\d+\.\d+\)` — set current item |
| Tier row | Content confined to the ลักษณะ grid interval with the `N–M คัน / อย่างน้อย k` shape — append to the open `tierBlock` of the preceding criterion |
| Criterion row | Non-empty ลักษณะ cell otherwise — emit a leaf/container record under current item |

Group and item context forward-fill through vMerge continuations — exactly what the merge structure encodes, so no heuristics needed.

**Sub-criterion nesting** (2.1, 2.2 under 2) is detected the same way your xlsx converter already handles it: a literal `^\d+\.\d+\s` prefix on the ลักษณะ text. A criterion followed by such rows becomes a container (no answerType); the numbered children become the leaves.

### 1.4 Numbering: three sources, tagged by trust

The example file mixes literal numbering in text (28 occurrences of `N.M` in runs), Word auto-numbering (46 `w:numPr` elements), and rows with no visible number at all. Resolve in priority order — literal prefix → `numPr` (resolve against `numbering.xml` counters, resetting per list instance) → positional ordinal within parent — and stamp `numSource` on the record. The aligner must treat `positional` numbers as untrusted: they are the ones that silently shift when a row is inserted, which is precisely the renumbering trap the migration exists to survive.

### 1.5 answerType from shading, not from the old JSON

The grayed ได้มาตรฐาน/ไม่ได้มาตรฐาน cells carry `w:shd fill="BEBEBE"` (and `A6A6A6`; treat any non-nil, non-white fill as grayed). Rule: both standards cells grayed → `presence`; otherwise `presence_standard`. This is a major reliability win — the new document is self-describing for answer model, so a leaf whose graying *changed* between revisions is correctly picked up as a modification rather than silently inheriting a stale answerType. Log a warning for asymmetric graying (only one of the two cells) and queue it for review.

### 1.6 The remark columns (หมายเหตุ/ปัญหา/ข้อเสนอแนะ → 2548/2564)

Per the requirement, these never enter the template definition. The parser emits them into a **separate sidecar**, keyed by the leaf's final code (post-alignment — see §3.4), one file per mode:

```json
// remarks_rail.json
{
  "A1.3-1": { "2548": "200", "2564": "150", "labelSnippet": "<matched criterion text snippet>" },
  "A1.1-1": { "2548": "<2548 tier values>", "2564": "<2564 tier values>" }
}
```

Two downstream consumers, both already in your plan:

- **Era overrides.** Rows where 2548 and 2564 carry *different numeric values* are exactly the criteria that need a `byLaw` wrapper. A small post-processing script can convert numeric remark pairs into `era_overrides_{mode}.json` skeletons (values pre-filled, `confirmed: false`), turning what was going to be manual era research into a review task. Non-numeric remarks (free-text ข้อเสนอแนะ) stay as annotations only.
- **Threshold review.** Where a remark value disagrees with the number embedded in the ลักษณะ text (the A1.3 200-vs-150 case), flag it in the review CSV — the label text may still say the 2548 value while the 2564 column carries the new law's threshold.

### 1.7 Built-in consistency checks (free, do not skip)

- **2.1 vs 2.2 cross-check:** the item set parsed from the overview tables must equal the item set encountered in the detail tables. Any asymmetry is either a source-document gap (the air B4/B5 problem) or a parser bug — both things you want to know before diffing.
- **Coverage counters:** rows consumed vs rows classified vs rows skipped, per table. Skipped-but-nonempty rows are printed verbatim. On an ~80-page document this is the only way to trust "nothing fell through."
- **Grid sanity:** every densified row must resolve to exactly the logical column set; a row that doesn't is dumped with its grid intervals for inspection.

---

## 2. Stage 2 — flatten the old JSON

Mechanical: walk `groups[].items[].subItems[](.subItems[])` and emit the same IR records, carrying along a `meta` bag of everything that must survive migration — `measurements[]` (with `confirmed` state), `note`, `facilityCode`/`lawRefs` tags, `star`. Compute `labelKey` and `numbers` with the *identical* normalization function as Stage 1 (share the module; do not reimplement).

---

## 3. Stage 3 — hierarchical scoped alignment

### 3.1 Why scoping is the false-match defense

A flat 480×480 leaf comparison invites false matches because the corpus is highly repetitive — a handful of near-identical tactile-warning-surface criteria recur near-verbatim under a dozen items. The fix is structural: align top-down, and only compare leaves *within already-matched parents*. A leaf under A1.1 is compared against ~6 candidates, not 480. Cross-scope matching happens only as a controlled last pass (§3.3).

**Group alignment:** by normalized label similarity, with code ordinal as tiebreaker only. Group labels are the most stable text in the document. An unmatched old group (water's vanished A2) surfaces immediately at the top of the report rather than as 30 confusing leaf deletions.

**Item alignment within matched groups:** exact `labelKey` match first (catches pure renumbering — A1.4 becoming A1.5 with identical text is a MOVE, not delete+add), then fuzzy with mutual-best assignment as below.

### 3.2 Leaf alignment within a matched item — three passes

**Pass 1 — exact.** `labelKey` equality → `UNCHANGED` (same ordinal) or `MOVED_WITHIN` (different ordinal). This alone will resolve the large majority of the 480 rail leaves, and it is immune to renumbering by construction because numbering is stripped from the key.

**Pass 2 — fuzzy, assignment-constrained.** For the leftovers, build a similarity matrix over old×new candidates:

```
score = 0.70 · token_set_ratio(labelKey_old, labelKey_new)        # rapidfuzz, 0–1
      + 0.20 · numeric_anchor(numbers_old, numbers_new)
      + 0.10 · ordinal_proximity(ordinal_old, ordinal_new)
```

`numeric_anchor` is Jaccard overlap of the numeric-literal sets — two rows sharing `{2400, 6000}` are almost certainly the same criterion however the prose shifted, and a row whose skeleton matches but whose numbers differ is the classic *threshold changed by the new law* case (classify `MODIFIED`, and force re-extraction of measurements — §4). Solve the matrix with mutual-best-match (or `scipy.optimize.linear_sum_assignment` for exact optimality; at ≤15 candidates per item either is instant) so no old leaf claims two new leaves — the second false-match defense.

Thresholds: **≥ 0.92 → auto `MODIFIED`**; **0.70–0.92 → `REVIEW` queue** (proposed pairing shown, human decides); **< 0.70 → unmatched**. Tune on the rail mode first — run the pipeline, read the review queue, adjust, then apply to the other three modes.

**Pass 3 — cross-scope rescue.** Pool all still-unmatched old and new leaves across the whole template and rerun matching at a *stricter* threshold (≥ 0.95 on text alone). Hits are `MOVED_ACROSS` — this is what correctly handles reorganizations like water's A2 items being absorbed into A1, without opening the door to false matches between the repetitive tactile-block criteria (those get resolved inside their scoped items in passes 1–2 before this pool ever forms). Whatever remains is `ADDED` (new only) / `REMOVED` (old only).

### 3.3 Edited vs deleted-and-recreated

Operationally these differ in exactly one way: whether old metadata is carried forward. So the rule is pragmatic, not philosophical: a pairing that clears the fuzzy threshold under assignment constraints is an edit; everything else is remove+add; the 0.70–0.92 band is the human's call via the review queue. Do not build extra machinery to "detect intent" — the review CSV *is* that machinery, and the same accept/reject workflow you already run for `threshold_review.csv` applies unchanged.

### 3.4 Code stability

The data dictionary guarantees codes are "stable across template versions of the same mode" — the aligner is what makes that true. Matched leaves keep their old `code` regardless of new position or numbering. `ADDED` leaves mint the next free suffix under their item (`A1.1-7`, or `-7.1` for new sub-criteria). Codes of `REMOVED` leaves are retired and never reused. This keeps every downstream reference — remarks sidecar, era overrides, review CSVs, any future answer-level analytics — stable across revisions.

### 3.5 On embeddings: recommended *not* in v1

Embeddings (bge-m3 / multilingual-e5 handle Thai well) solve one problem: matching true paraphrases where token overlap collapses. In this corpus that case is rare — regulatory text gets renumbered, gets threshold-swapped, gets rows inserted, but is seldom rewritten from scratch — and when it does happen, the pairing lands in the review queue, where a human resolves it in seconds. Against that marginal gain: a model dependency, slower runs, non-deterministic tuning, and *harder-to-explain* false positives (an embedding happily scores two different tactile-block rows at 0.93 because they are semantically near-identical — the exact failure mode the numeric anchor and scoping exist to prevent). Structure the scorer as a pluggable interface (`score(old_leaf, new_leaf) -> float`) so an embedding term can be added later if a real corpus shows rapidfuzz missing paraphrases. Measure first.

---

## 4. Stage 4 — report and review loop

Emit per mode:

**`migration_report_{mode}.md`** — headline counts (unchanged / modified / moved / added / removed / review), the group-level and item-level alignment table, then every non-UNCHANGED leaf with old text, new text, score, and classification rationale. This doubles as the evidence artifact for สนข. sign-off on what changed between form versions — worth more to the handoff than the code itself.

**`migration_review_{mode}.csv`** — one row per REVIEW-band pairing and per suspicious signal (asymmetric graying, remark-vs-label numeric disagreement, positional-only numbering on a MODIFIED leaf), with a `decision` column (`accept` / `reject` / `map_to:<code>`). This file is an *input* to Stage 5: the merger refuses to run while undecided rows remain. Same human-in-the-loop contract as your threshold review.

---

## 5. Stage 5 — merge and emit

The **new document is the source of truth for structure, ordering, text, and answerType**; the **old JSON is the source of truth for accumulated metadata**. For each new-IR leaf:

| Situation | Rule |
|---|---|
| Matched, numbers unchanged | Carry `measurements[]` verbatim, **including `confirmed: true`** — review work survives the migration |
| Matched, numbers changed | Re-run threshold extraction on the new text; reset `confirmed: false`; add the row to the threshold-review CSV with the old value alongside for comparison |
| Matched | Carry `note`, `facilityCode`/`lawRefs` tags, old `code` |
| Added | Fresh extraction, fresh code, `confirmed: false` |
| Removed | Absent from output; listed in report; code retired |

Output: `template_{mode}_v3.json` (`schemaVersion` unchanged, `version: 3`, `status: DRAFT`, `provisional: true`, `source` pointing at the DOCX filename), plus `remarks_{mode}.json`, plus the era-override skeleton for numeric remark pairs. Per the existing seeding contract, v3 lands as DRAFT and nothing touches checklists stamped to earlier templates.

**Idempotency requirement:** running the pipeline twice on the same inputs and the same review decisions must produce byte-identical output (stable sort keys, no timestamps inside the JSON). This is what makes the pipeline safely re-runnable when สนข. sends the *next* correction of the same document — you re-run, and the diff of the diff shows only their new edits.

---

## 6. Repository layout and reuse

```
tools/checklist-migration/
  normalize.py        # shared text normalization + numeric extraction (single source)
  docx_parser.py      # Stage 1: DOCX → new_ir.json (+ raw remarks stream)
  flatten_old.py      # Stage 2: template JSON → old_ir.json
  aligner.py          # Stage 3: IR×IR → matches.json + review CSV
  report.py           # Stage 4
  merger.py           # Stage 5: matches + review decisions → v3 JSON + sidecars
  run.py              # orchestrator: run <mode> --docx <file> --old <template.json>
  fixtures/           # synthetic mini-checklists for aligner unit tests
```

Suggested build order (fits the TDD discipline you're already running): `normalize` + fixtures → `docx_parser` against the rail example with the §1.7 coverage checks as the acceptance test → `flatten_old` → `aligner` against synthetic fixtures (one test per change class: renumber, reword, threshold swap, insert, delete, cross-item move) → merger. Rail first end-to-end, then the other three modes are configuration, not code.

## 7. Known risks

1. **Word grid pathology.** Some future document may merge cells in ways that defeat interval mapping (a cell spanning ลักษณะ *and* มี). The dense-grid + coverage-counter design surfaces these loudly rather than mis-parsing silently; budget for a per-table override hook (`column_map_overrides` in a config file) rather than trying to anticipate every layout.
2. **numPr numbering across list restarts.** Word list counters restart per `numId` instance; getting this wrong shifts `num` values. Mitigated because matching never trusts numbers — but verify reconstructed numbering against the 28 literal-text numbers in the rail file as a self-test.
3. **The tiered mini-table shape varies per mode.** The parking tier block and the wheelchair-seating block (B3.2) may render differently in the land/air/water documents. Keep tier detection as an isolated function with per-mode fixtures.
4. **OCR-grade typos in the source** (the dropped paren before `Wheelchair)`, single-character Thai typos elsewhere). Normalization absorbs most; the ones it doesn't land in the review band, which is where they belong — a typo fixed between versions *is* a modification.
