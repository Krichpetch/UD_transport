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

Era-varying prose (2026-08-05 follow-up)
-----------------------------------------
The graded number isn't the only text that changes by era: the leaf's own question (`labelTh`) and
the measurement's `sourceText` both quote the same number in Thai prose (e.g. "...ไม่น้อยกว่า 50
มิลลิเมตร"). Before this fix, only the measurement's `value`/`value2`/`tiers` were resolved by law —
the surrounding prose kept quoting whichever number happened to be in the base template, silently
disagreeing with the value an auditor was actually asked to meet whenever a newer law applied.
`_label_variants()` derives per-law text by substituting the template's base number for each law's
resolved number, attached onto that law's `byLaw` entry as `sourceText`/`labelTh`
(TemplateMeasurementByLawEntry, era-resolution.ts). It only fires when the old number appears
EXACTLY ONCE in the text — an ambiguous or absent match is left alone rather than guessed, and
resolution falls back to the template's flat text in that case (see resolveMeasurement in
era-resolution.ts), which is exactly today's pre-fix behavior, not a regression.

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
import re
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


def _format_number(value: Any) -> str:
    """Thai checklist prose formats whole numbers with comma thousands separators (e.g. "2,500")
    and never shows decimals for values that are whole, matching how these documents are written."""
    if isinstance(value, bool):
        raise TypeError("bool is not a valid measurement number")
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, int):
        return f"{value:,}"
    text = f"{value:,.3f}".rstrip("0").rstrip(".")
    return text


def _substitute_number(text: str | None, old_value: Any, new_value: Any) -> str | None:
    """Replaces the single unambiguous occurrence of old_value's numeral inside `text` with
    new_value's, preserving comma-thousands style. Returns None — leave the text alone — when the
    old numeral doesn't appear exactly once: ambiguous or absent is a signal to fall back to the
    template's own flat text at resolution time (era-resolution.ts), not to guess and risk
    corrupting unrelated prose that happens to contain the same digits."""
    if not text or old_value is None or isinstance(old_value, bool) or not isinstance(old_value, (int, float)):
        return None
    candidates = [_format_number(old_value)]
    plain = str(int(old_value)) if float(old_value).is_integer() else str(old_value)
    if plain not in candidates:
        candidates.append(plain)

    for candidate in candidates:
        pattern = re.compile(r"(?<!\d)" + re.escape(candidate) + r"(?!\d)")
        if len(pattern.findall(text)) == 1:
            return pattern.sub(_format_number(new_value), text, count=1)
    return None


def _label_variants(text: str | None, base_value: Any, law_values: dict[str, Any]) -> dict[str, str]:
    """For every law whose value differs from the template's base flat value, tries to derive an
    era-specific rendering of `text` by substituting the embedded number. A law matching the base
    value, or one where substitution is ambiguous/impossible, is simply omitted from the result —
    resolveMeasurement/resolveNode (era-resolution.ts) fall back to the template's own flat
    sourceText/labelTh whenever a byLaw entry doesn't supply an override, so omitting here is a
    safe no-op, never a silent mistake."""
    variants: dict[str, str] = {}
    for law, new_value in law_values.items():
        if new_value == base_value:
            continue
        substituted = _substitute_number(text, base_value, new_value)
        if substituted is not None:
            variants[law] = substituted
    return variants


RANGE_TEXT_RE = re.compile(r"^\s*([\d,]+(?:\.\d+)?)\s*-\s*([\d,]+(?:\.\d+)?)\s*$")


def _parse_range_text(value: Any) -> tuple[float, float] | None:
    """Parses a raw 'NUM - NUM' candidate string (comma-thousands aware, e.g. '800 -900' or
    '2,500-1,800') into (lo, hi). Returns None for anything that isn't exactly this shape —
    including already-numeric values, which the ordinary scalar path already handles. Unlike the
    tiered parking table (genuinely ambiguous, needed a human), this shape is fully unambiguous: a
    dash-separated pair is not being interpreted, just reformatted."""
    if not isinstance(value, str):
        return None
    m = RANGE_TEXT_RE.match(value)
    if not m:
        return None
    return (float(m.group(1).replace(",", "")), float(m.group(2).replace(",", "")))


def classify_range(entry: dict, node: dict | None) -> tuple[dict[str, tuple[float, float]] | None, str | None, str]:
    """A second classification pass for `range`-operator items whose raw per-law text is a dash
    range that classify()'s scalar-only check would otherwise skip as unparsed. Returns
    (parsed_ranges, skip_reason, detail). `parsed_ranges` is None when this entry ISN'T a
    range-shaped candidate at all (not every value matches the pattern, or the target measurement
    isn't `range`) — the caller falls through to the ordinary classify()/build_measurement() path
    in that case, so this never changes behavior for anything it doesn't confidently recognize."""
    if any(k.startswith("exists_") for k in entry):
        return None, None, ""

    law_values = _law_values(entry)
    if not law_values:
        return None, None, ""
    parsed = {law: _parse_range_text(v) for law, v in law_values.items()}
    if any(p is None for p in parsed.values()):
        return None, None, ""

    if len(law_values) < 2:
        return None, SKIP_SINGLE_LAW, "only one law-specific value — nothing varies by era"
    if node is None:
        return None, SKIP_NO_TARGET, "leaf code not present in the target template"
    measurements = node.get("measurements") or []
    if not measurements:
        return None, SKIP_NO_TARGET, "target leaf carries no measurements to attach byLaw to"
    if len(measurements) > 1:
        return None, SKIP_AMBIGUOUS, f"target leaf has {len(measurements)} measurements; candidate supplies one value per law"
    if measurements[0].get("operator") != "range":
        # Range-SHAPED text but the target isn't a range measurement — don't guess what it means;
        # let the ordinary path flag it as needs_manual_review same as before this function existed.
        return None, None, ""

    return {law: r for law, r in parsed.items()}, None, ""


def build_range_measurement(base: dict, law_ranges: dict[str, tuple[float, float]], confirmed: bool) -> dict:
    """Like build_measurement, but for a range operator's (value, value2) pair per law."""
    out = {k: v for k, v in base.items() if k not in ("value", "value2", "tiers", "byLaw")}
    out["byLaw"] = {law: {"value": lo, "value2": hi} for law, (lo, hi) in sorted(law_ranges.items())}
    out["confirmed"] = bool(confirmed)
    return out


def _label_variants_range(text: str | None, base_lo: Any, base_hi: Any, law_ranges: dict[str, tuple[float, float]]) -> dict[str, str]:
    """Like _label_variants, but substitutes BOTH numbers of a range one at a time. Each
    substitution is independently required to be unambiguous (via _substitute_number's own
    exactly-once rule) — if either half can't be safely substituted, that law is omitted entirely
    rather than applying just one half of a two-number change."""
    if not isinstance(base_lo, (int, float)) or isinstance(base_lo, bool):
        return {}
    if not isinstance(base_hi, (int, float)) or isinstance(base_hi, bool):
        return {}
    variants: dict[str, str] = {}
    for law, (lo, hi) in law_ranges.items():
        if lo == base_lo and hi == base_hi:
            continue
        step: str | None = text
        if lo != base_lo:
            step = _substitute_number(step, base_lo, lo)
        if step is not None and hi != base_hi:
            step = _substitute_number(step, base_hi, hi)
        if step is not None:
            variants[law] = step
    return variants


PAIR_TEXT_RE = re.compile(r"^\s*([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$")


def _parse_pair_text(value: Any) -> tuple[float, float] | None:
    """Parses a raw 'NUM NUM' candidate string (whitespace-separated, NO dash -- distinct from
    _parse_range_text) into (first, second). This shape occurs when a leaf legitimately carries
    TWO separate gte/lte measurements (e.g. 'distance from wall' and 'height from mounting point')
    but the candidate format can only hold one flat value per law, so both numbers landed in the
    same string. Returns None for anything else, including a dash-range (handled separately)."""
    if not isinstance(value, str):
        return None
    m = PAIR_TEXT_RE.match(value)
    if not m:
        return None
    return (float(m.group(1).replace(",", "")), float(m.group(2).replace(",", "")))


def classify_pair(entry: dict, node: dict | None) -> tuple[dict[str, tuple[float, float]] | None, str | None, str]:
    """Third classification pass: a whitespace-separated two-number candidate against a leaf that
    carries EXACTLY two single-value (gte/lte) measurements — the two numbers map positionally,
    first candidate number to the first measurement, second to the second. Declines (returns None,
    None, "") for anything it isn't confident about: not every value pair-shaped, leaf doesn't have
    exactly two gte/lte measurements — those fall through to the ordinary classify() path, which
    already correctly reports them as needs_manual_review / ambiguous."""
    if any(k.startswith("exists_") for k in entry):
        return None, None, ""

    law_values = _law_values(entry)
    if not law_values:
        return None, None, ""
    parsed = {law: _parse_pair_text(v) for law, v in law_values.items()}
    if any(p is None for p in parsed.values()):
        return None, None, ""

    if len(law_values) < 2:
        return None, SKIP_SINGLE_LAW, "only one law-specific value — nothing varies by era"
    if node is None:
        return None, SKIP_NO_TARGET, "leaf code not present in the target template"
    measurements = node.get("measurements") or []
    if len(measurements) != 2:
        return None, None, ""  # not the two-measurement shape this path knows how to split
    if any(m.get("operator") not in ("gte", "lte") for m in measurements):
        return None, None, ""

    return {law: r for law, r in parsed.items()}, None, ""


def build_pair_measurements(measurements: list[dict], law_pairs: dict[str, tuple[float, float]], confirmed: bool) -> list[dict]:
    """Rewrites TWO existing measurements into their byLaw form, one number per measurement,
    assigned positionally (first candidate number -> measurements[0], second -> measurements[1])."""
    out = []
    for i, base in enumerate(measurements):
        m = {k: v for k, v in base.items() if k not in ("value", "value2", "tiers", "byLaw")}
        m["byLaw"] = {law: {"value": pair[i]} for law, pair in sorted(law_pairs.items())}
        m["confirmed"] = bool(confirmed)
        out.append(m)
    return out


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

        range_values, range_skip, range_detail = classify_range(entry, node)
        if range_values is not None:
            assert node is not None
            base = (node.get("measurements") or [])[0]
            measurement = build_range_measurement(base, range_values, entry.get("confirmed", False))
            source_variants = _label_variants_range(base.get("sourceText"), base.get("value"), base.get("value2"), range_values)
            label_variants = _label_variants_range(node.get("labelTh"), base.get("value"), base.get("value2"), range_values)
            for law in set(source_variants) | set(label_variants):
                law_entry = measurement["byLaw"].setdefault(law, {})
                if law in source_variants:
                    law_entry["sourceText"] = source_variants[law]
                if law in label_variants:
                    law_entry["labelTh"] = label_variants[law]
            override: dict[str, Any] = {"measurements": [measurement]}
            if entry.get("labelHint"):
                override["labelHint"] = entry["labelHint"]
            overrides[code] = override
            continue
        if range_skip is not None:
            skipped.setdefault(range_skip, []).append({"code": code, "detail": range_detail})
            continue

        pair_values, pair_skip, pair_detail = classify_pair(entry, node)
        if pair_values is not None:
            assert node is not None
            bases = (node.get("measurements") or [])[:2]
            new_measurements = build_pair_measurements(bases, pair_values, entry.get("confirmed", False))
            label_variants = _label_variants_range(
                node.get("labelTh"), bases[0].get("value"), bases[1].get("value"), pair_values,
            )
            for i, base in enumerate(bases):
                source_variants = _label_variants(base.get("sourceText"), base.get("value"), {law: pair[i] for law, pair in pair_values.items()})
                for law, text in source_variants.items():
                    new_measurements[i]["byLaw"].setdefault(law, {})["sourceText"] = text
            if label_variants:
                # labelTh lives on the NODE, not a specific measurement — attach to the first
                # measurement's byLaw entries, matching where resolveNode looks for it.
                for law, text in label_variants.items():
                    new_measurements[0]["byLaw"].setdefault(law, {})["labelTh"] = text
            override: dict[str, Any] = {"measurements": new_measurements}
            if entry.get("labelHint"):
                override["labelHint"] = entry["labelHint"]
            overrides[code] = override
            continue
        if pair_skip is not None:
            skipped.setdefault(pair_skip, []).append({"code": code, "detail": pair_detail})
            continue

        reason, detail = classify(code, entry, node)
        if reason is not None:
            skipped.setdefault(reason, []).append({"code": code, "detail": detail})
            continue

        assert node is not None  # classify() guarantees this when reason is None
        base = (node.get("measurements") or [])[0]
        law_values = _law_values(entry)
        measurement = build_measurement(base, law_values, entry.get("confirmed", False))

        # The graded number isn't the only text that varies by era — the leaf's own question
        # (labelTh) and the measurement's sourceText both embed the same number in Thai prose.
        # Derive per-law variants from the template's existing text rather than requiring the
        # candidate file to author them (it never carries prose, only per-law numbers).
        source_variants = _label_variants(base.get("sourceText"), base.get("value"), law_values)
        label_variants = _label_variants(node.get("labelTh"), base.get("value"), law_values)
        for law in set(source_variants) | set(label_variants):
            law_entry = measurement["byLaw"].setdefault(law, {})
            if law in source_variants:
                law_entry["sourceText"] = source_variants[law]
            if law in label_variants:
                law_entry["labelTh"] = label_variants[law]

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
