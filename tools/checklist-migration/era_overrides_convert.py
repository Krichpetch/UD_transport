"""Session F3, Part G — convert this pipeline's era-override CANDIDATE files into the
`era_overrides_{mode}.json` shape that @repo/types#applyEraOverrides actually consumes.

Why this exists
---------------
Two different file shapes were being conflated, which is the whole reason "era overrides don't
work":

  candidate shape (what merger.py emits, keyed by leaf code, one flat dict per leaf)
      { "A2.2-1": { "MHT_2548": 2500.0, "MHT_2564": 1800.0,
                    "confirmed": false, "labelHint": "..." }, ... }

  applyEraOverrides shape (what the seed script merges onto a template)
      { "overrides": { "A2.2-1": { "measurements": [
            { "key": "m1", "operator": "lte", "unit": "mm", "autoGrade": true,
              "byLaw": { "MHT_2548": { "value": 2500.0 },
                         "MHT_2564": { "value": 1800.0 } } } ] } } }

applyEraOverrides REPLACES a leaf's `measurements` array wholesale, so the conversion cannot be
done from the candidate file alone: the candidates carry only per-law NUMBERS, never the
operator/unit/key that make a measurement well-formed. Those come from the leaf as it already
exists in the target template, which is why `convert()` takes both.

What is deliberately NOT converted
----------------------------------
Three candidate kinds are skipped, each reported by reason rather than dropped silently:

  * `needs_manual_review` — the per-law values are unparsed strings (a multi-bracket capacity
    table like "10-50 51-100 101 (2 ที่จอด)"), not thresholds. merger.py already flags these
    with needsManualReview; inventing a number here would fabricate a legal threshold.
  * `existence_override` — `exists_2548`/`exists_2564` say whether the criterion APPLIES at all
    under each era. That is item-level applicability (lawRefs / redaction), a different mechanism
    from byLaw measurement VALUES — see era-resolution.ts. Converting it into a measurement would
    put it through the wrong machinery entirely.
  * `no_target_measurement` — the leaf code isn't in the template, or is but carries no
    measurements to attach a byLaw to. Fails loudly in the report instead of guessing.

Ambiguity rule
--------------
A candidate supplies ONE value per law, so it can only be attached unambiguously to a leaf with
exactly ONE measurement. A leaf with two or more (e.g. a width AND a length threshold) is skipped
as `ambiguous_multi_measurement`: there is no way to know which one the candidate's number refers
to, and picking the first would silently mis-assign a legal threshold.

Confidentiality
---------------
The real candidate files are gitignored สนข. data and must never enter git or the test suite.
Every test for this module builds its own synthetic fixture (see tests/test_era_overrides_convert.py).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

# LawReference codes era resolution understands (see @repo/types#LAW_REFERENCE_SEED). Anything
# else in a candidate entry is metadata (confirmed/labelHint/needsManualReview/exists_*), not a law.
LAW_CODES = ("MHT_2548", "PSD_2555", "MOT_2556", "MHT_2564", "PROJECT")

SKIP_NEEDS_REVIEW = "needs_manual_review"
SKIP_EXISTENCE = "existence_override"
SKIP_NO_TARGET = "no_target_measurement"
SKIP_AMBIGUOUS = "ambiguous_multi_measurement"
SKIP_SINGLE_LAW = "single_law_no_variance"


def iter_leaves(node: dict) -> Iterable[dict]:
    """Yields the node itself and every descendant, matching applyEraOverrides' own index (which
    keys EVERY node by code, containers included — a 'กรณี…' band header legitimately carries
    measurements in this corpus)."""
    yield node
    for child in node.get("subItems") or []:
        yield from iter_leaves(child)


def index_template_nodes(template: dict) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for group in template.get("groups") or []:
        for item in group.get("items") or []:
            for node in iter_leaves(item):
                code = node.get("code")
                if code:
                    index[code] = node
    return index


def _law_values(entry: dict) -> dict[str, Any]:
    return {k: v for k, v in entry.items() if k in LAW_CODES}


def classify(code: str, entry: dict, node: dict | None) -> tuple[str | None, str]:
    """Returns (skip_reason, detail). skip_reason None means the entry is convertible."""
    if any(k.startswith("exists_") for k in entry):
        return SKIP_EXISTENCE, "per-era existence flags belong to lawRefs/redaction, not byLaw"

    law_values = _law_values(entry)
    if not law_values:
        return SKIP_NEEDS_REVIEW, "no per-law values present"

    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in law_values.values()):
        return SKIP_NEEDS_REVIEW, "per-law values are unparsed text, not thresholds"

    if len(law_values) < 2:
        return SKIP_SINGLE_LAW, "only one law-specific value — nothing varies by era"

    if node is None:
        return SKIP_NO_TARGET, "leaf code not present in the target template"

    measurements = node.get("measurements") or []
    if not measurements:
        return SKIP_NO_TARGET, "target leaf carries no measurements to attach byLaw to"
    if len(measurements) > 1:
        return SKIP_AMBIGUOUS, f"target leaf has {len(measurements)} measurements; candidate supplies one value per law"

    return None, ""


def build_measurement(base: dict, law_values: dict[str, Any], confirmed: bool) -> dict:
    """Rewrites ONE existing measurement into its byLaw form.

    The operator/unit/key/inputs are carried over verbatim from the template — this conversion
    only changes WHERE the number comes from, never what kind of comparison it is. The flat
    `value`/`value2` are dropped: once byLaw supplies the value, a leftover flat one would be a
    second, contradictory source of truth (era-resolution.ts resolves byLaw first).

    `confirmed` rides through from the candidate — these thresholds are extracted, not reviewed,
    and every downstream surface keys the "ยังไม่ยืนยัน" indicator off this flag.
    """
    out = {k: v for k, v in base.items() if k not in ("value", "value2", "tiers", "byLaw")}
    out["byLaw"] = {law: {"value": value} for law, value in sorted(law_values.items())}
    out["confirmed"] = bool(confirmed)
    return out


def convert(candidates: dict, template: dict) -> tuple[dict, dict]:
    """Converts a candidates dict against its target template.

    Returns (overrides_file, report) where overrides_file is ready for applyEraOverrides and
    report explains every conversion and every skip, by reason.
    """
    nodes = index_template_nodes(template)
    overrides: dict[str, dict] = {}
    skipped: dict[str, list[dict]] = {}

    for code in sorted(candidates):
        entry = candidates[code]
        if not isinstance(entry, dict):
            skipped.setdefault(SKIP_NEEDS_REVIEW, []).append({"code": code, "detail": "entry is not an object"})
            continue

        node = nodes.get(code)
        reason, detail = classify(code, entry, node)
        if reason is not None:
            skipped.setdefault(reason, []).append({"code": code, "detail": detail})
            continue

        assert node is not None  # classify() guarantees this when reason is None
        base = (node.get("measurements") or [])[0]
        measurement = build_measurement(base, _law_values(entry), entry.get("confirmed", False))
        override: dict[str, Any] = {"measurements": [measurement]}
        if entry.get("labelHint"):
            override["labelHint"] = entry["labelHint"]
        overrides[code] = override

    report = {
        "candidates": len(candidates),
        "converted": len(overrides),
        "skipped": {reason: len(rows) for reason, rows in sorted(skipped.items())},
        "skippedDetail": skipped,
    }
    out = {
        "_generated": "tools/checklist-migration/era_overrides_convert.py — do not hand-edit; "
                      "regenerate from the candidate file instead",
        "mode": template.get("mode"),
        "overrides": overrides,
    }
    return out, report


def convert_files(candidates_path: Path, template_path: Path, out_path: Path) -> dict:
    candidates = json.loads(candidates_path.read_text(encoding="utf-8"))
    template = json.loads(template_path.read_text(encoding="utf-8"))
    out, report = convert(candidates, template)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("candidates", type=Path, help="era_overrides_*_candidates.json from merger.py")
    parser.add_argument("template", type=Path, help="the template JSON these overrides target")
    parser.add_argument("out", type=Path, help="destination era_overrides_{mode}.json")
    args = parser.parse_args(argv)

    report = convert_files(args.candidates, args.template, args.out)
    print(json.dumps({k: v for k, v in report.items() if k != "skippedDetail"}, ensure_ascii=False, indent=2))
    for reason, rows in sorted(report["skippedDetail"].items()):
        print(f"\n{reason} ({len(rows)}):")
        for row in rows[:20]:
            print(f"  {row['code']}: {row['detail']}")
        if len(rows) > 20:
            print(f"  ... and {len(rows) - 20} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
