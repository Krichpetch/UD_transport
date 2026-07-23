"""Stage 3 — hierarchical scoped alignment of old_ir vs new_ir leaves.

Per checklist_migration_design.md §3: align top-down (group -> item -> leaf)
and only compare leaves within already-matched parents, so a leaf under
A1.1 is scored against ~6 candidates instead of the whole 480-leaf corpus.
Cross-scope matching happens only in a controlled final pass (§3.3).

Two corrections found during validation (see migration task brief):
  1. Fuzzy scoring runs on fuzz_key() (spaced), never labelKey (spaceless) —
     spaceless Thai makes rapidfuzz's token_set_ratio degenerate to a plain
     full-string ratio.
  2. A leaf with a `tierBlock` is compared via its flattened text (label +
     tier rows joined), because the old JSON already has the tier table
     flattened into labelRaw — this is the v2 A1.1-1 case and must land as
     MODIFIED, not REMOVED+ADDED.
"""
from collections import defaultdict
from dataclasses import asdict, dataclass, field

from rapidfuzz import fuzz

from normalize import extract_numbers, fuzz_key, label_key

AUTO_THRESHOLD = 0.92
REVIEW_THRESHOLD = 0.70
RESCUE_THRESHOLD = 0.95


# --------------------------------------------------------------------------
# comparison text/keys (tier-aware)
# --------------------------------------------------------------------------

def comparison_text(rec):
    txt = rec.get("labelRaw", "") or ""
    tier = rec.get("tierBlock")
    if tier:
        flat = " ".join(" ".join(cell for cell in row) for row in tier)
        txt = f"{txt} {flat}"
    return txt


def comparison_label_key(rec):
    return label_key(comparison_text(rec))


def comparison_fuzz_key(rec):
    return fuzz_key(comparison_text(rec))


def comparison_numbers(rec):
    return extract_numbers(comparison_text(rec))


# --------------------------------------------------------------------------
# scoring
# --------------------------------------------------------------------------

def numeric_jaccard(a, b):
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return 1.0
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def ordinal_proximity(a, b, spread=10.0):
    if a is None or b is None:
        return 0.0
    return max(0.0, 1.0 - abs(a - b) / spread)


def leaf_score(old, new):
    """score = 0.70*token_set_ratio + 0.20*numeric_jaccard + 0.10*ordinal_proximity"""
    text = fuzz.token_set_ratio(comparison_fuzz_key(old), comparison_fuzz_key(new)) / 100.0
    numeric = numeric_jaccard(comparison_numbers(old), comparison_numbers(new))
    ordp = ordinal_proximity(_ordinal_num(old), _ordinal_num(new))
    return 0.70 * text + 0.20 * numeric + 0.10 * ordp


def group_score(old, new):
    """Group/item level: label similarity dominant, code ordinal a minor
    tiebreak only — design doc gives no numeric-anchor term at this level
    (group/item labels rarely carry discriminating numbers)."""
    text = fuzz.token_set_ratio(fuzz_key(old["label"]), fuzz_key(new["label"])) / 100.0
    ordp = ordinal_proximity(old.get("ordinal"), new.get("ordinal"), spread=5.0)
    return 0.85 * text + 0.15 * ordp


def item_score(old, new):
    text = fuzz.token_set_ratio(fuzz_key(old["label"]), fuzz_key(new["label"])) / 100.0
    ordp = ordinal_proximity(old.get("ordinal"), new.get("ordinal"), spread=8.0)
    return 0.85 * text + 0.15 * ordp


def rescue_score(old, new):
    """Pass 3: stricter, text-only (no numeric/ordinal terms — old and new
    items/positions are unrelated by construction at this point)."""
    return fuzz.token_set_ratio(comparison_fuzz_key(old), comparison_fuzz_key(new)) / 100.0


def _ordinal_num(rec):
    o = rec.get("ordinal")
    return float(o) if o is not None else None


def _position(rec):
    """Same-slot detector for the exact-key pass: prefer numeric ordinal
    (present on group/item dicts and on non-dot leaves); fall back to the
    literal `num` string for dot-numbered sub-criteria, which never carry
    an ordinal of their own (see flatten_old._walk_criteria /
    docx_parser.container_pass)."""
    if rec.get("ordinal") is not None:
        return ("ordinal", rec["ordinal"])
    return ("num", rec.get("num"))


# --------------------------------------------------------------------------
# matching
# --------------------------------------------------------------------------

def make_match(old, new, status, score, rationale):
    return {
        "old_code": old["code"] if old else None,
        "new_code": new["code"] if new else None,
        "old_label": (old.get("labelRaw") or old.get("label")) if old else None,
        "new_label": (new.get("labelRaw") or new.get("label")) if new else None,
        "status": status,
        "score": score,
        "rationale": rationale,
        "decision": None if status == "REVIEW" else "auto",
        # full record echoes — used by report.py (suspicious-signal
        # detection needs grayedHalf/numSource) and merger.py (needs meta).
        "old": old,
        "new": new,
    }


def two_pass_match(old_list, new_list, key_fn, score_fn):
    """Pass 1: exact key_fn match -> UNCHANGED (same slot) / MOVED_WITHIN
    (different slot). Pass 2: fuzzy, assignment-constrained via score_fn
    (greedy-by-score mutual-best: highest-scoring pairs claim first, so no
    old item claims two new items and vice versa) -> MODIFIED (>=AUTO) or
    REVIEW (AUTO > score >= REVIEW_THRESHOLD).

    Used for groups, items, and (pass1+2 only) leaves.
    """
    matches = []
    used_old, used_new = set(), set()

    new_by_key = defaultdict(list)
    for n in new_list:
        new_by_key[key_fn(n)].append(n)
    for o in old_list:
        cands = [n for n in new_by_key.get(key_fn(o), []) if id(n) not in used_new]
        if cands:
            n = cands[0]
            used_old.add(id(o))
            used_new.add(id(n))
            status = "UNCHANGED" if _position(o) == _position(n) else "MOVED_WITHIN"
            matches.append(make_match(o, n, status, 1.0, "exact labelKey match"))

    remaining_old = [o for o in old_list if id(o) not in used_old]
    remaining_new = [n for n in new_list if id(n) not in used_new]
    candidates = []
    for o in remaining_old:
        for n in remaining_new:
            s = score_fn(o, n)
            if s >= REVIEW_THRESHOLD:
                candidates.append((s, o, n))
    candidates.sort(key=lambda t: -t[0])
    for s, o, n in candidates:
        if id(o) in used_old or id(n) in used_new:
            continue
        used_old.add(id(o))
        used_new.add(id(n))
        status = "MODIFIED" if s >= AUTO_THRESHOLD else "REVIEW"
        matches.append(make_match(o, n, status, s, f"fuzzy score={s:.3f}"))

    unmatched_old = [o for o in old_list if id(o) not in used_old]
    unmatched_new = [n for n in new_list if id(n) not in used_new]
    return matches, unmatched_old, unmatched_new


def cross_scope_rescue(pool_old, pool_new):
    """Pass 3: pool ALL still-unmatched old/new leaves across the whole
    template, rerun at the stricter RESCUE_THRESHOLD, text-only. Hits are
    MOVED_ACROSS (e.g. water's A2 items absorbed into A1)."""
    candidates = []
    for o in pool_old:
        for n in pool_new:
            s = rescue_score(o, n)
            if s >= RESCUE_THRESHOLD:
                candidates.append((s, o, n))
    candidates.sort(key=lambda t: -t[0])
    used_old, used_new = set(), set()
    matches = []
    for s, o, n in candidates:
        if id(o) in used_old or id(n) in used_new:
            continue
        used_old.add(id(o))
        used_new.add(id(n))
        matches.append(make_match(o, n, "MOVED_ACROSS", s, "cross-scope rescue pass"))
    leftover_old = [o for o in pool_old if id(o) not in used_old]
    leftover_new = [n for n in pool_new if id(n) not in used_new]
    return matches, leftover_old, leftover_new


# --------------------------------------------------------------------------
# hierarchy collection
# --------------------------------------------------------------------------

def _collect_groups(records):
    seen, order = {}, []
    for r in records:
        g = r.get("group")
        if g and g["code"] not in seen:
            seen[g["code"]] = dict(g)
            order.append(g["code"])
    for i, code in enumerate(order, start=1):
        seen[code]["ordinal"] = i
    return [seen[c] for c in order]


def _collect_items(records, group_code):
    seen, order = {}, []
    for r in records:
        g, it = r.get("group"), r.get("item")
        if g and g["code"] == group_code and it and it["code"] not in seen:
            seen[it["code"]] = dict(it)
            order.append(it["code"])
    for i, code in enumerate(order, start=1):
        seen[code]["ordinal"] = i
    return [seen[c] for c in order]


def _leaves_in_item(records, item_code):
    return [r for r in records
            if r.get("isLeaf") and r.get("item") and r["item"]["code"] == item_code]


def _leaves_in_group(records, group_code):
    return [r for r in records
            if r.get("isLeaf") and r.get("group") and r["group"]["code"] == group_code]


# --------------------------------------------------------------------------
# result + entry point
# --------------------------------------------------------------------------

@dataclass
class AlignResult:
    group_matches: list = field(default_factory=list)
    group_removed: list = field(default_factory=list)
    group_added: list = field(default_factory=list)
    item_matches: list = field(default_factory=list)
    item_removed: list = field(default_factory=list)
    item_added: list = field(default_factory=list)
    leaf_matches: list = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


def align(old_records, new_records):
    old_groups = _collect_groups(old_records)
    new_groups = _collect_groups(new_records)
    group_matches, group_removed, group_added = two_pass_match(
        old_groups, new_groups, lambda g: label_key(g["label"]), group_score)

    item_matches, item_removed, item_added = [], [], []
    leaf_matches = []
    pool_old, pool_new = [], []

    for gm in group_matches:
        old_gcode, new_gcode = gm["old_code"], gm["new_code"]
        old_items = _collect_items(old_records, old_gcode)
        new_items = _collect_items(new_records, new_gcode)
        im, ir, ia = two_pass_match(
            old_items, new_items, lambda it: label_key(it["label"]), item_score)
        item_matches += im
        item_removed += ir
        item_added += ia

        for m in im:
            old_leaves = _leaves_in_item(old_records, m["old_code"])
            new_leaves = _leaves_in_item(new_records, m["new_code"])
            lm, u_old, u_new = two_pass_match(
                old_leaves, new_leaves, comparison_label_key, leaf_score)
            leaf_matches += lm
            pool_old += u_old
            pool_new += u_new
        for it in ir:
            pool_old += _leaves_in_item(old_records, it["code"])
        for it in ia:
            pool_new += _leaves_in_item(new_records, it["code"])

    for g in group_removed:
        pool_old += _leaves_in_group(old_records, g["code"])
    for g in group_added:
        pool_new += _leaves_in_group(new_records, g["code"])

    rescued, leftover_old, leftover_new = cross_scope_rescue(pool_old, pool_new)
    leaf_matches += rescued
    leaf_matches += [make_match(o, None, "REMOVED", None, "unmatched after rescue pass")
                      for o in leftover_old]
    leaf_matches += [make_match(None, n, "ADDED", None, "unmatched after rescue pass")
                      for n in leftover_new]

    return AlignResult(
        group_matches=group_matches, group_removed=group_removed, group_added=group_added,
        item_matches=item_matches, item_removed=item_removed, item_added=item_added,
        leaf_matches=leaf_matches,
    )
