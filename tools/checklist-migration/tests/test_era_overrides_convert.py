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
    build_measurement,
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
