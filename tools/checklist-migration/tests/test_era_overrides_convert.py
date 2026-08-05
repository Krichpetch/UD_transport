"""Session F3, Part G — tests for the candidate -> applyEraOverrides converter.

Every fixture here is SYNTHETIC and built inline. The real candidate files under output/ are
gitignored สนข. data and must never enter git or a test — see the module docstring of
era_overrides_convert.py.
"""

import json

import pytest

from era_overrides_convert import (
    SKIP_AMBIGUOUS,
    SKIP_EXISTENCE,
    SKIP_NEEDS_REVIEW,
    SKIP_NO_TARGET,
    SKIP_SINGLE_LAW,
    _label_variants,
    _label_variants_range,
    _parse_pair_text,
    _parse_range_text,
    _substitute_number,
    build_measurement,
    classify_pair,
    classify_range,
    convert,
    convert_files,
    index_template_nodes,
)


def template(measurements=None, code="A1.1-1"):
    """A minimal template whose single leaf carries whatever measurements the test needs."""
    leaf = {"code": code, "labelTh": "criterion", "answerType": "presence_standard"}
    if measurements is not None:
        leaf["measurements"] = measurements
    return {
        "schemaVersion": 2,
        "mode": "ทางบก",
        "groups": [{"code": "A1", "labelTh": "group", "items": [{"code": "A1.1", "labelTh": "container", "subItems": [leaf]}]}],
    }


ONE_MEASUREMENT = [{"key": "m1", "operator": "lte", "unit": "mm", "value": 2500, "autoGrade": True, "confirmed": False}]


# ── The happy path ────────────────────────────────────────────────────────────────────────────


def test_converts_a_two_law_numeric_candidate():
    candidates = {"A1.1-1": {"MHT_2548": 2500.0, "MHT_2564": 1800.0, "confirmed": False, "labelHint": "ramp"}}
    out, report = convert(candidates, template(ONE_MEASUREMENT))

    assert report["converted"] == 1
    assert out["mode"] == "ทางบก"
    measurement = out["overrides"]["A1.1-1"]["measurements"][0]
    assert measurement["byLaw"] == {"MHT_2548": {"value": 2500.0}, "MHT_2564": {"value": 1800.0}}


def test_carries_operator_unit_and_key_over_from_the_template():
    """The candidate supplies only numbers — what KIND of comparison this is must come from the
    template, or the converted measurement would be meaningless."""
    candidates = {"A1.1-1": {"MHT_2548": 10, "MHT_2564": 20, "confirmed": False}}
    out, _ = convert(candidates, template(ONE_MEASUREMENT))

    measurement = out["overrides"]["A1.1-1"]["measurements"][0]
    assert measurement["key"] == "m1"
    assert measurement["operator"] == "lte"
    assert measurement["unit"] == "mm"
    assert measurement["autoGrade"] is True


def test_drops_the_flat_value_once_bylaw_supplies_it():
    """A leftover flat `value` would be a second, contradictory source of truth."""
    candidates = {"A1.1-1": {"MHT_2548": 10, "MHT_2564": 20, "confirmed": False}}
    out, _ = convert(candidates, template(ONE_MEASUREMENT))

    measurement = out["overrides"]["A1.1-1"]["measurements"][0]
    assert "value" not in measurement
    assert "value2" not in measurement


def test_confirmed_rides_through_from_the_candidate():
    for flag in (True, False):
        candidates = {"A1.1-1": {"MHT_2548": 1, "MHT_2564": 2, "confirmed": flag}}
        out, _ = convert(candidates, template(ONE_MEASUREMENT))
        assert out["overrides"]["A1.1-1"]["measurements"][0]["confirmed"] is flag


def test_bylaw_keys_are_sorted_so_output_is_deterministic():
    candidates = {"A1.1-1": {"MHT_2564": 20, "MHT_2548": 10, "confirmed": False}}
    out, _ = convert(candidates, template(ONE_MEASUREMENT))
    assert list(out["overrides"]["A1.1-1"]["measurements"][0]["byLaw"]) == ["MHT_2548", "MHT_2564"]


def test_output_is_idempotent_reconverting_the_same_input():
    candidates = {"A1.1-1": {"MHT_2548": 10, "MHT_2564": 20, "confirmed": False}}
    first, _ = convert(candidates, template(ONE_MEASUREMENT))
    second, _ = convert(candidates, template(ONE_MEASUREMENT))
    assert first == second


# ── Everything that must be skipped, by reason ────────────────────────────────────────────────


def test_skips_unparsed_string_thresholds_as_needing_manual_review():
    candidates = {"A1.1-1": {"MHT_2548": "10-50 51-100 101", "MHT_2564": "<25 26-50", "needsManualReview": True}}
    out, report = convert(candidates, template(ONE_MEASUREMENT))

    assert out["overrides"] == {}
    assert report["skipped"][SKIP_NEEDS_REVIEW] == 1


def test_skips_existence_overrides_as_a_different_mechanism():
    """exists_* is item applicability (lawRefs / redaction), never a byLaw measurement value."""
    candidates = {"A1.1-1": {"exists_2548": False, "exists_2564": True, "confirmed": False}}
    out, report = convert(candidates, template(ONE_MEASUREMENT))

    assert out["overrides"] == {}
    assert report["skipped"][SKIP_EXISTENCE] == 1


def test_skips_a_candidate_whose_leaf_is_not_in_the_template():
    candidates = {"Z9.9-9": {"MHT_2548": 10, "MHT_2564": 20, "confirmed": False}}
    out, report = convert(candidates, template(ONE_MEASUREMENT))

    assert out["overrides"] == {}
    assert report["skipped"][SKIP_NO_TARGET] == 1


def test_skips_a_leaf_with_no_measurements_to_attach_to():
    candidates = {"A1.1-1": {"MHT_2548": 10, "MHT_2564": 20, "confirmed": False}}
    out, report = convert(candidates, template(measurements=None))

    assert out["overrides"] == {}
    assert report["skipped"][SKIP_NO_TARGET] == 1


def test_skips_a_leaf_with_several_measurements_as_ambiguous():
    """One value per law cannot be assigned to a width AND a length threshold; guessing would
    silently mis-assign a legal threshold."""
    two = ONE_MEASUREMENT + [{"key": "m2", "operator": "gte", "unit": "mm", "value": 900, "autoGrade": True}]
    candidates = {"A1.1-1": {"MHT_2548": 10, "MHT_2564": 20, "confirmed": False}}
    out, report = convert(candidates, template(two))

    assert out["overrides"] == {}
    assert report["skipped"][SKIP_AMBIGUOUS] == 1


def test_skips_a_single_law_candidate_as_no_variance():
    candidates = {"A1.1-1": {"MHT_2548": 10, "confirmed": False}}
    out, report = convert(candidates, template(ONE_MEASUREMENT))

    assert out["overrides"] == {}
    assert report["skipped"][SKIP_SINGLE_LAW] == 1


def test_booleans_are_not_mistaken_for_numeric_thresholds():
    """bool is a subclass of int in Python — a naive isinstance check would convert these."""
    candidates = {"A1.1-1": {"MHT_2548": True, "MHT_2564": False, "confirmed": False}}
    out, report = convert(candidates, template(ONE_MEASUREMENT))

    assert out["overrides"] == {}
    assert report["skipped"][SKIP_NEEDS_REVIEW] == 1


def test_a_mixed_batch_converts_the_good_and_reports_each_skip_reason():
    candidates = {
        "A1.1-1": {"MHT_2548": 2500.0, "MHT_2564": 1800.0, "confirmed": False},
        "A1.1-2": {"MHT_2548": "10-50 51-100", "MHT_2564": "<25", "needsManualReview": True},
        "A1.1-3": {"exists_2548": False, "exists_2564": True},
        "Z9.9-9": {"MHT_2548": 1, "MHT_2564": 2},
    }
    tmpl = template(ONE_MEASUREMENT)
    # Give A1.1-2 / A1.1-3 real homes so their skip reason is their KIND, not a missing target.
    container = tmpl["groups"][0]["items"][0]
    for code in ("A1.1-2", "A1.1-3"):
        container["subItems"].append(
            {"code": code, "labelTh": "c", "answerType": "presence_standard", "measurements": ONE_MEASUREMENT}
        )

    out, report = convert(candidates, tmpl)

    assert report["candidates"] == 4
    assert report["converted"] == 1
    assert list(out["overrides"]) == ["A1.1-1"]
    assert report["skipped"] == {SKIP_EXISTENCE: 1, SKIP_NEEDS_REVIEW: 1, SKIP_NO_TARGET: 1}


# ── Era-varying prose (sourceText/labelTh) — 2026-08-05 follow-up ────────────────────────────


def test_substitute_number_replaces_a_single_unambiguous_occurrence():
    assert _substitute_number("ไม่น้อยกว่า 50 มิลลิเมตร", 50, 100) == "ไม่น้อยกว่า 100 มิลลิเมตร"


def test_substitute_number_preserves_comma_thousands_formatting():
    assert _substitute_number("ไม่เกิน 2,500 มิลลิเมตร", 2500, 1800) == "ไม่เกิน 1,800 มิลลิเมตร"


def test_substitute_number_returns_none_when_the_number_is_absent():
    assert _substitute_number("ไม่น้อยกว่า 900 มิลลิเมตร", 50, 100) is None


def test_substitute_number_returns_none_when_the_number_appears_more_than_once():
    assert _substitute_number("50 ถึง 50 มิลลิเมตร", 50, 100) is None


def test_substitute_number_does_not_match_a_number_embedded_in_a_larger_number():
    # "150" must not be mistaken for a "50" occurrence.
    assert _substitute_number("ไม่น้อยกว่า 150 มิลลิเมตร", 50, 100) is None


def test_label_variants_skips_the_law_whose_value_equals_the_base():
    variants = _label_variants("ไม่น้อยกว่า 50 มิลลิเมตร", 50, {"MHT_2548": 50, "MHT_2564": 100})
    assert variants == {"MHT_2564": "ไม่น้อยกว่า 100 มิลลิเมตร"}


def test_label_variants_omits_a_law_it_cannot_unambiguously_substitute():
    variants = _label_variants("ราวกันตกทำด้วยวัสดุมั่นคง", 50, {"MHT_2548": 50, "MHT_2564": 100})
    assert variants == {}


def test_convert_attaches_era_specific_sourcetext_and_labelth_onto_the_differing_law():
    leaf = {
        "code": "A2.2-1.5",
        "labelTh": "ทางลาด...ไม่น้อยกว่า 50 มิลลิเมตร",
        "answerType": "presence_standard",
        "measurements": [
            {
                "key": "m1", "operator": "gte", "unit": "mm", "value": 50, "autoGrade": True,
                "sourceText": "ไม่น้อยกว่า 50 มิลลิเมตร", "confirmed": False,
            },
        ],
    }
    tmpl = {
        "schemaVersion": 2, "mode": "ทางราง",
        "groups": [{"code": "A2", "labelTh": "group", "items": [{"code": "A2.2", "labelTh": "container", "subItems": [leaf]}]}],
    }
    candidates = {"A2.2-1.5": {"MHT_2548": 50.0, "MHT_2564": 100.0, "confirmed": False}}

    out, _ = convert(candidates, tmpl)
    by_law = out["overrides"]["A2.2-1.5"]["measurements"][0]["byLaw"]

    # The base law (matches the template's existing 50mm text) gets no override — resolution
    # falls back to the template's own flat text, which is already correct for this law.
    assert "sourceText" not in by_law["MHT_2548"]
    assert "labelTh" not in by_law["MHT_2548"]

    # The differing law gets both texts rewritten to match its resolved 100mm value.
    assert by_law["MHT_2564"]["sourceText"] == "ไม่น้อยกว่า 100 มิลลิเมตร"
    assert by_law["MHT_2564"]["labelTh"] == "ทางลาด...ไม่น้อยกว่า 100 มิลลิเมตร"


def test_convert_leaves_text_alone_when_substitution_is_ambiguous():
    """No text override is attached rather than guessing — era-resolution.ts's fallback to the
    template's flat text is the correct (pre-fix) behavior in this case, not a bug."""
    leaf = {
        "code": "A1.1-1",
        "labelTh": "container without a number in the label",
        "answerType": "presence_standard",
        "measurements": [
            {"key": "m1", "operator": "gte", "unit": "mm", "value": 50, "autoGrade": True, "confirmed": False},
        ],
    }
    tmpl = {
        "schemaVersion": 2, "mode": "ทางบก",
        "groups": [{"code": "A1", "labelTh": "group", "items": [{"code": "A1.1", "labelTh": "container", "subItems": [leaf]}]}],
    }
    candidates = {"A1.1-1": {"MHT_2548": 50.0, "MHT_2564": 100.0, "confirmed": False}}

    out, _ = convert(candidates, tmpl)
    by_law = out["overrides"]["A1.1-1"]["measurements"][0]["byLaw"]
    assert by_law == {"MHT_2548": {"value": 50.0}, "MHT_2564": {"value": 100.0}}


# ── Range-shaped raw text ("800 -900") — 2026-08-06 follow-up ────────────────────────────────


def test_parse_range_text_handles_a_missing_space_before_the_dash():
    assert _parse_range_text("800 -900") == (800.0, 900.0)


def test_parse_range_text_handles_comma_thousands():
    assert _parse_range_text("2,500-1,800") == (2500.0, 1800.0)


def test_parse_range_text_rejects_a_single_number():
    assert _parse_range_text("800") is None


def test_parse_range_text_rejects_the_tiered_parking_table_shape():
    assert _parse_range_text("10-50 51-100 101 (2 ที่จอด)") is None


def test_parse_range_text_rejects_a_compressed_two_criteria_string():
    # "50 120" has no dash — this is NOT a range, it's two separate numbers with no separator at
    # all (a different, unrelated data problem — see the compressed-criteria finding).
    assert _parse_range_text("50 120") is None


RANGE_MEASUREMENT = [{"key": "m1", "operator": "range", "unit": "mm", "value": 800, "value2": 900, "autoGrade": True, "confirmed": False}]


def test_classify_range_converts_a_dash_range_against_a_range_operator_target():
    entry = {"MHT_2548": "800 -900", "MHT_2564": "750 -800", "confirmed": False}
    node = template(RANGE_MEASUREMENT, code="A1.1-1")["groups"][0]["items"][0]["subItems"][0]
    parsed, skip, _ = classify_range(entry, node)
    assert skip is None
    assert parsed == {"MHT_2548": (800.0, 900.0), "MHT_2564": (750.0, 800.0)}


def test_classify_range_declines_when_the_target_operator_is_not_range():
    entry = {"MHT_2548": "800 -900", "MHT_2564": "750 -800", "confirmed": False}
    node = template(ONE_MEASUREMENT, code="A1.1-1")["groups"][0]["items"][0]["subItems"][0]
    parsed, skip, _ = classify_range(entry, node)
    assert parsed is None
    assert skip is None  # falls through to the ordinary classify() path, not a range skip


def test_classify_range_declines_when_not_every_value_is_range_shaped():
    entry = {"MHT_2548": "800 -900", "MHT_2564": 750.0, "confirmed": False}
    node = template(RANGE_MEASUREMENT, code="A1.1-1")["groups"][0]["items"][0]["subItems"][0]
    parsed, skip, _ = classify_range(entry, node)
    assert parsed is None
    assert skip is None


def test_convert_end_to_end_converts_a_dash_range_candidate():
    candidates = {"A1.1-1": {"MHT_2548": "800 -900", "MHT_2564": "750 -800", "confirmed": False}}
    out, report = convert(candidates, template(RANGE_MEASUREMENT))
    assert report["converted"] == 1
    by_law = out["overrides"]["A1.1-1"]["measurements"][0]["byLaw"]
    assert by_law == {
        "MHT_2548": {"value": 800.0, "value2": 900.0},
        "MHT_2564": {"value": 750.0, "value2": 800.0},
    }


def test_label_variants_range_substitutes_both_numbers_independently():
    text = "สูงจากพื้นไม่น้อยกว่า 800 มิลลิเมตร แต่ไม่เกิน 900 มิลลิเมตร"
    variants = _label_variants_range(text, 800, 900, {"MHT_2548": (800.0, 900.0), "MHT_2564": (750.0, 800.0)})
    assert "MHT_2548" not in variants  # matches the base — no override needed
    assert variants["MHT_2564"] == "สูงจากพื้นไม่น้อยกว่า 750 มิลลิเมตร แต่ไม่เกิน 800 มิลลิเมตร"


def test_label_variants_range_omits_a_law_when_either_half_is_ambiguous():
    # "900" appears twice — can't safely substitute either occurrence.
    text = "ไม่น้อยกว่า 800 และไม่เกิน 900 (สูงสุด 900)"
    variants = _label_variants_range(text, 800, 900, {"MHT_2564": (750.0, 800.0)})
    assert variants == {}


def test_convert_leaves_compressed_two_number_text_as_needs_manual_review():
    """'50 120' has no dash — it's a different, unrelated data problem (two compressed criteria),
    not a range. Must still land in needs_manual_review, not be silently misread as a range."""
    candidates = {"A1.1-1": {"MHT_2548": "50 120", "MHT_2564": "40 100", "confirmed": False}}
    out, report = convert(candidates, template(RANGE_MEASUREMENT))
    assert out["overrides"] == {}
    assert report["skipped"][SKIP_NEEDS_REVIEW] == 1


# ── Whitespace-separated pairs ("50 120", no dash) — 2026-08-06 follow-up ────────────────────


def test_parse_pair_text_splits_two_whitespace_separated_numbers():
    assert _parse_pair_text("50 120") == (50.0, 120.0)


def test_parse_pair_text_rejects_a_dash_range():
    assert _parse_pair_text("800 -900") is None


def test_parse_pair_text_rejects_a_single_number():
    assert _parse_pair_text("50") is None


PAIR_MEASUREMENTS = [
    {"key": "m1", "operator": "gte", "unit": "mm", "value": 50, "autoGrade": True, "confirmed": False, "sourceText": "อย่างน้อย 50 มิลลิเมตร"},
    {"key": "m2", "operator": "gte", "unit": "mm", "value": 120, "autoGrade": True, "confirmed": False, "sourceText": "อย่างน้อย 120 มิลลิเมตร"},
]


def test_classify_pair_converts_against_a_leaf_with_exactly_two_gte_measurements():
    entry = {"MHT_2548": "50 120", "MHT_2564": "40 100", "confirmed": False}
    node = template(PAIR_MEASUREMENTS, code="A1.1-1")["groups"][0]["items"][0]["subItems"][0]
    parsed, skip, _ = classify_pair(entry, node)
    assert skip is None
    assert parsed == {"MHT_2548": (50.0, 120.0), "MHT_2564": (40.0, 100.0)}


def test_classify_pair_declines_when_the_leaf_does_not_have_exactly_two_measurements():
    entry = {"MHT_2548": "50 120", "MHT_2564": "40 100", "confirmed": False}
    node = template(ONE_MEASUREMENT, code="A1.1-1")["groups"][0]["items"][0]["subItems"][0]
    parsed, skip, _ = classify_pair(entry, node)
    assert parsed is None
    assert skip is None


def test_convert_end_to_end_splits_a_pair_positionally_onto_both_measurements():
    candidates = {"A1.1-1": {"MHT_2548": "50 120", "MHT_2564": "40 100", "confirmed": True}}
    tmpl = template(PAIR_MEASUREMENTS)
    tmpl["groups"][0]["items"][0]["subItems"][0]["labelTh"] = "ห่างจากผนัง ไม่น้อยกว่า 50 มิลลิเมตร สูงจากจุดยึด ไม่น้อยกว่า 120 มิลลิเมตร"
    out, report = convert(candidates, tmpl)
    assert report["converted"] == 1
    measurements = out["overrides"]["A1.1-1"]["measurements"]
    assert measurements[0]["key"] == "m1"
    assert measurements[0]["byLaw"]["MHT_2548"]["value"] == 50.0
    assert measurements[0]["byLaw"]["MHT_2564"]["value"] == 40.0
    assert measurements[1]["key"] == "m2"
    assert measurements[1]["byLaw"]["MHT_2548"]["value"] == 120.0
    assert measurements[1]["byLaw"]["MHT_2564"]["value"] == 100.0
    # era-specific sourceText follows each measurement's own number
    assert measurements[0]["byLaw"]["MHT_2564"]["sourceText"] == "อย่างน้อย 40 มิลลิเมตร"
    assert measurements[1]["byLaw"]["MHT_2564"]["sourceText"] == "อย่างน้อย 100 มิลลิเมตร"
    # the shared node labelTh follows both numbers together, attached to the first measurement
    assert measurements[0]["byLaw"]["MHT_2564"]["labelTh"] == "ห่างจากผนัง ไม่น้อยกว่า 40 มิลลิเมตร สูงจากจุดยึด ไม่น้อยกว่า 100 มิลลิเมตร"


def test_convert_still_reports_needs_manual_review_for_a_pair_against_a_range_target():
    """A pair-shaped string against a leaf that ISN'T the two-gte-measurement shape must not be
    guessed at — falls through to the ordinary path, same as before this function existed."""
    candidates = {"A1.1-1": {"MHT_2548": "50 120", "MHT_2564": "40 100", "confirmed": False}}
    out, report = convert(candidates, template(RANGE_MEASUREMENT))
    assert out["overrides"] == {}
    assert report["skipped"][SKIP_NEEDS_REVIEW] == 1


# ── Structural helpers ────────────────────────────────────────────────────────────────────────


def test_index_covers_containers_not_only_leaves():
    """applyEraOverrides indexes EVERY node by code, and 'กรณี…' band headers legitimately carry
    measurements in this corpus — the converter must see them too."""
    index = index_template_nodes(template(ONE_MEASUREMENT))
    assert set(index) == {"A1.1", "A1.1-1"}


def test_build_measurement_does_not_mutate_its_input():
    base = dict(ONE_MEASUREMENT[0])
    snapshot = dict(base)
    build_measurement(base, {"MHT_2548": 1, "MHT_2564": 2}, confirmed=True)
    assert base == snapshot


# ── Round-trip through the real file entrypoint ───────────────────────────────────────────────


def test_convert_files_round_trip(tmp_path):
    candidates_path = tmp_path / "candidates.json"
    template_path = tmp_path / "template.json"
    out_path = tmp_path / "era_overrides_land.json"

    candidates_path.write_text(
        json.dumps({"A1.1-1": {"MHT_2548": 2500.0, "MHT_2564": 1800.0, "confirmed": False}}), encoding="utf-8"
    )
    template_path.write_text(json.dumps(template(ONE_MEASUREMENT), ensure_ascii=False), encoding="utf-8")

    report = convert_files(candidates_path, template_path, out_path)

    assert report["converted"] == 1
    written = json.loads(out_path.read_text(encoding="utf-8"))
    assert written["overrides"]["A1.1-1"]["measurements"][0]["byLaw"]["MHT_2564"] == {"value": 1800.0}
    # Shape the seed script's applyEraOverrides expects: a top-level `overrides` map.
    assert set(written) >= {"overrides", "mode"}


def test_empty_candidates_produce_an_empty_but_valid_overrides_file():
    out, report = convert({}, template(ONE_MEASUREMENT))
    assert out["overrides"] == {}
    assert report["converted"] == 0
