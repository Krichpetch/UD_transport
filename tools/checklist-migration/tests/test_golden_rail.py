"""Golden test for the real rail DOCX — runs only when a local copy is
present in input/. The DOCX and everything docx_parser.py extracts from it
is real สนข. checklist content, so it is gitignored (see .gitignore) and
never checked in as a fixture. This test therefore can't compare against a
committed "golden" JSON; instead it checks the two properties that don't
require checking real label text into git:

  1. idempotency — running the parser twice on the same input agrees with
     itself (checklist_migration_design.md §5's "byte-identical reruns"
     contract, applied to Stage 1 alone)
  2. the validated structural counts from the migration task brief (leaf/
     container counts, zero warnings) — plain integers, not checklist text

If you have the real file, drop it at:
    tools/checklist-migration/input/Rail_Checklist_Example.docx
(that path is gitignored — nothing here gets committed).
"""
import json
from pathlib import Path

import pytest

from docx_parser import main as parse_main

TOOL_DIR = Path(__file__).resolve().parents[1]
DOCX = TOOL_DIR / "input" / "Rail_Checklist_Example.docx"

pytestmark = pytest.mark.skipif(
    not DOCX.exists(),
    reason=f"real rail DOCX not present locally at {DOCX} (gitignored, not shipped in the repo)",
)


def test_rail_docx_parses_twice_identically(tmp_path):
    """Idempotency: two independent runs must agree byte-for-byte."""
    out1, out2 = tmp_path / "run1", tmp_path / "run2"
    parse_main(str(DOCX), str(out1))
    parse_main(str(DOCX), str(out2))
    assert (out1 / "new_ir.json").read_bytes() == (out2 / "new_ir.json").read_bytes()
    assert (out1 / "tree_preview.json").read_bytes() == (out2 / "tree_preview.json").read_bytes()
    assert (out1 / "remarks_raw.json").read_bytes() == (out2 / "remarks_raw.json").read_bytes()


def test_rail_docx_coverage_is_clean(tmp_path):
    """Regression guard on the validated coverage numbers from the task
    brief: zero warnings, zero unclassified rows, 70 leaves / 7 containers
    for the covered items (A1.1-A2.3)."""
    parse_main(str(DOCX), str(tmp_path))
    records = json.loads((tmp_path / "new_ir.json").read_text(encoding="utf-8"))
    report = (tmp_path / "parse_report.md").read_text(encoding="utf-8")

    assert report.rstrip().endswith("- none")
    assert "rows_unclassified" not in report

    leaves = [r for r in records if r["isLeaf"]]
    containers = [r for r in records if not r["isLeaf"]]
    assert len(leaves) == 70
    assert len(containers) == 7
