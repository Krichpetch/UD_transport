"""T-INV — the load-bearing invariant of the merger redesign (see the task
that revoked the code-stability contract): the merged output's codes,
positions, and record existence must come ENTIRELY from the new document.
The old JSON may only ever influence metadata (measurements/note/
facilityCode/lawRefs), never identity or structure.

Verified by building two trees with the SAME real new_ir.json:
  - "pure": merge() called with empty old_records/leaf_matches — nothing
    for the old side to influence, so this is a straight transcription of
    the new document alone.
  - "real": merge() called with the real old_ir.json + matches.json for
    this rail run.
After stripping metadata fields, these must be byte-identical. If old data
ever changes a code, a position, or which records appear, this fails.

Skips cleanly (like test_golden_rail.py) when the real rail files aren't
present locally — they're real สนข. content, gitignored, never committed.
"""
import json
from pathlib import Path

import pytest

from merger import merge

TOOL_DIR = Path(__file__).resolve().parents[1]
OUTDIR = TOOL_DIR / "output" / "rail" / "Rail_Checklist_v2"

pytestmark = pytest.mark.skipif(
    not (OUTDIR / "new_ir.json").exists(),
    reason=f"real rail Stage 1-3 output not present locally at {OUTDIR} "
           "(gitignored, not shipped in the repo)",
)

METADATA_FIELDS = ("measurements", "note", "facilityCode", "lawRefs")


def _strip_metadata(node):
    stripped = {k: v for k, v in node.items() if k not in METADATA_FIELDS}
    if "subItems" in stripped:
        stripped["subItems"] = [_strip_metadata(c) for c in stripped["subItems"]]
    return stripped


def _strip_groups(groups):
    return [
        {**g, "items": [
            {**it, "subItems": [_strip_metadata(s) for s in it["subItems"]]}
            for it in g["items"]
        ]}
        for g in groups
    ]


def test_merged_codes_and_structure_match_a_pure_new_doc_transcription():
    new_records = json.loads((OUTDIR / "new_ir.json").read_text(encoding="utf-8"))
    old_records = json.loads((OUTDIR / "old_ir.json").read_text(encoding="utf-8"))
    matches = json.loads((OUTDIR / "matches.json").read_text(encoding="utf-8"))
    old_definition = json.loads(
        Path(matches["_old_template_path"]).read_text(encoding="utf-8"))

    # "pure": no old data at all to influence anything.
    pure = merge("rail", old_definition, [], new_records, [], "doc.docx")

    # "real": the actual old_ir/leaf_matches for this rail run. Every REVIEW
    # row must already be decided (accept/reject/map_to) for this to run
    # against real leaf_matches as-is — matches.json's leaf_matches carry
    # the raw alignment, pre-decision, so REVIEW-status rows are resolved
    # here as "accept" (their proposed old code becomes the metadata
    # source) purely to exercise the invariant; this test doesn't depend
    # on which decision was made, only that codes/structure never change
    # because of it.
    real_leaf_matches = [
        {**m, "status": "MODIFIED"} if m["status"] == "REVIEW" else m
        for m in matches["leaf_matches"]
    ]
    real = merge("rail", old_definition, old_records, new_records,
                  real_leaf_matches, "doc.docx")

    pure_groups = _strip_groups(pure["definition"]["groups"])
    real_groups = _strip_groups(real["definition"]["groups"])
    assert pure_groups == real_groups
