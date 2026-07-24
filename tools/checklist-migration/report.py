"""Stage 4 — migration_report_{mode}.md + migration_review_{mode}.csv

Per checklist_migration_design.md §4: the report is the sign-off evidence
for สนข.; the review CSV is Stage 5's required input — the merger refuses
to run while any row's `decision` column is blank.
"""
import csv
from collections import Counter
from pathlib import Path

from normalize import parse_remark_numbers

STATUS_ORDER = ["UNCHANGED", "MOVED_WITHIN", "MOVED_ACROSS", "MODIFIED",
                "REVIEW", "ADDED", "REMOVED"]

REVIEW_CSV_HEADER = ["old_code", "new_code", "status", "score", "reasons",
                      "old_label", "new_label", "decision"]


def _fmt_score(score):
    return f"{score:.3f}" if isinstance(score, (int, float)) else ""


def _row(old_code, new_code, old_label, new_label, status, score):
    old_txt = f"{old_code or '—'} {old_label or ''}".strip()
    new_txt = f"{new_code or '—'} {new_label or ''}".strip()
    return f"| {old_txt} | {new_txt} | {status} | {_fmt_score(score)} |"


def write_report(mode, result, path):
    lines = [f"# Migration report — {mode}", ""]

    counts = Counter(m["status"] for m in result.leaf_matches)
    lines += ["## Headline counts (leaves)", "", "| Status | Count |", "|---|---|"]
    for s in STATUS_ORDER:
        lines.append(f"| {s} | {counts.get(s, 0)} |")
    lines.append(f"| **Total** | **{len(result.leaf_matches)}** |")
    lines.append("")

    lines += ["## Group alignment", "", "| Old | New | Status | Score |", "|---|---|---|---|"]
    for m in result.group_matches:
        lines.append(_row(m["old_code"], m["new_code"], m["old_label"],
                           m["new_label"], m["status"], m["score"]))
    for g in result.group_removed:
        lines.append(_row(g["code"], None, g["label"], None, "REMOVED", None))
    for g in result.group_added:
        lines.append(_row(None, g["code"], None, g["label"], "ADDED", None))
    lines.append("")

    lines += ["## Item alignment", "", "| Old | New | Status | Score |", "|---|---|---|---|"]
    for m in result.item_matches:
        lines.append(_row(m["old_code"], m["new_code"], m["old_label"],
                           m["new_label"], m["status"], m["score"]))
    for it in result.item_removed:
        lines.append(_row(it["code"], None, it["label"], None, "REMOVED", None))
    for it in result.item_added:
        lines.append(_row(None, it["code"], None, it["label"], "ADDED", None))
    lines.append("")

    lines += ["## Leaf-level changes (non-UNCHANGED)", ""]
    non_unchanged = [m for m in result.leaf_matches if m["status"] != "UNCHANGED"]
    if not non_unchanged:
        lines.append("_none_")
    for m in non_unchanged:
        lines.append(f"### {m['status']} — {m['old_code'] or '(none)'} → {m['new_code'] or '(none)'}")
        lines.append(f"- score: {_fmt_score(m['score']) or 'n/a'}")
        lines.append(f"- rationale: {m['rationale']}")
        lines.append(f"- old: {m['old_label'] or '(none)'}")
        lines.append(f"- new: {m['new_label'] or '(none)'}")
        lines.append("")

    Path(path).write_text("\n".join(lines), encoding="utf8", newline="\n")


def _suspicious_signals(m):
    """Signals worth a human look even on an already auto-classified leaf:
    asymmetric graying, positional-only numbering on a MODIFIED leaf."""
    signals = []
    new = m.get("new")
    if new and new.get("grayedHalf"):
        signals.append("asymmetric graying on new leaf")
    if new and m["status"] == "MODIFIED" and new.get("numSource") == "positional":
        signals.append("positional-only numbering on a MODIFIED leaf")
    return signals


def _fmt_num(v):
    return str(int(v)) if float(v).is_integer() else str(v)


def _remark_disagreement(m, remarks_by_labelkey):
    """Compares each threshold in the 2564 remark against the new label's
    own numbers. Remark cells may hold more than one threshold, comma-
    separated (see parse_remark_numbers) — a leaf with two gte thresholds
    ("50,120") must have BOTH values checked individually, not the whole
    cell parsed as one number."""
    new = m.get("new")
    if not new:
        return None
    remark = remarks_by_labelkey.get(new.get("labelKey"))
    if not remark:
        return None
    r64_values = parse_remark_numbers(remark.get("2564"))
    if not r64_values:
        return None
    label_numbers = new.get("numbers") or []
    mismatched = [v for v in r64_values if v not in label_numbers]
    if mismatched:
        vals = ", ".join(_fmt_num(v) for v in mismatched)
        return f"remark 2564 value(s) ({vals}) disagree with new label's own numbers"
    return None


def write_review_csv(mode, result, path, remarks=None):
    remarks_by_labelkey = {r["labelKey"]: r for r in (remarks or []) if r.get("labelKey")}

    rows = []
    for m in result.leaf_matches:
        reasons = []
        if m["status"] == "REVIEW":
            reasons.append("fuzzy score in review band")
        reasons += _suspicious_signals(m)
        disagreement = _remark_disagreement(m, remarks_by_labelkey)
        if disagreement:
            reasons.append(disagreement)
        if not reasons:
            continue
        rows.append([
            m["old_code"] or "", m["new_code"] or "", m["status"],
            _fmt_score(m["score"]), "; ".join(reasons),
            m["old_label"] or "", m["new_label"] or "",
            "",  # decision — blank until a human fills it in
        ])

    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(REVIEW_CSV_HEADER)
        w.writerows(rows)
    return rows
