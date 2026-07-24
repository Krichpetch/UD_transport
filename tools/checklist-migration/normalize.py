"""Shared text normalization + numeric extraction for checklist migration.

Single source of truth: both the DOCX parser (new side) and the old-JSON
flattener must import from here so labelKey computation is identical.
"""
import re
import unicodedata

THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")

# Numbering prefixes like "1. ", "2.1 ", "2.2.1 ", "(2.3) ", "๓."
NUM_PREFIX_RE = re.compile(r"^\s*\(?\d+(?:\.\d+)*\)?[\.\s]\s*")
# Item code prefixes like "(A1.1)"
ITEM_CODE_RE = re.compile(r"^\s*\(([A-Z]\d+\.\d+)\)\s*")
# Group prefixes like "A1)"
GROUP_CODE_RE = re.compile(r"^\s*([A-Z]\d+)\)\s*")


def clean_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def strip_group_note(label: str) -> str:
    """Group cells embed 'หมายเหตุ : * ข้อเสนอแนะเพิ่มเติม' — strip it."""
    return clean_ws(re.split(r"หมายเหตุ\s*:", label)[0])


def label_key(text: str) -> str:
    """Deterministic matching key.

    - NFC normalize, Thai digits -> Arabic
    - strip leading numbering prefix (1., 2.1, (3) ...)
    - strip trailing star flag
    - drop thousands separators inside numbers
    - unify punctuation noise (stray parens around 'Wheelchair', dashes)
    - remove ALL whitespace (Thai has no word spacing; spacing is the most
      volatile artifact of extraction)
    """
    t = unicodedata.normalize("NFC", text or "")
    t = t.translate(THAI_DIGITS)
    t = NUM_PREFIX_RE.sub("", t)
    t = t.rstrip("*").strip()
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)          # 2,400 -> 2400
    t = re.sub(r"[()\[\]\u201c\u201d\"'`]", "", t)   # paren/quote noise
    t = re.sub(r"[–—\-]+", "-", t)
    t = re.sub(r"\s+", "", t)
    return t


def fuzz_key(text: str) -> str:
    """Matching key for fuzzy scoring only — same normalization as
    label_key(), but whitespace is collapsed to single spaces rather than
    stripped entirely.

    label_key() removes ALL whitespace, which is correct for exact
    equality (spacing is the most volatile artifact of DOCX/xlsx
    extraction) but wrong for rapidfuzz's token_set_ratio: spaceless Thai
    has no token boundaries, so token_set_ratio degenerates to a plain
    full-string ratio and loses its word-overlap behavior. Keeping single
    spaces preserves tokens for the fuzzy pass.
    """
    t = unicodedata.normalize("NFC", text or "")
    t = t.translate(THAI_DIGITS)
    t = NUM_PREFIX_RE.sub("", t)
    t = t.rstrip("*").strip()
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)
    t = re.sub(r"[()\[\]“”\"'`]", "", t)
    t = re.sub(r"[–—\-]+", "-", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def extract_numbers(text: str):
    """Ordered list of numeric literals (commas stripped, Thai digits ok).

    Ratios like '1 : 12' contribute both 1 and 12 — fine, they anchor equally.
    """
    t = (text or "").translate(THAI_DIGITS)
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", t)]


def parse_remark_numbers(text):
    """Remark cells (2548/2564 columns) may pack more than one threshold as
    comma-separated numbers when a leaf has multiple measurements (e.g.
    "50,120" for a leaf with a wall-gap gte and a height gte). Unlike label
    text, these cells are always mm/cm-scale checklist thresholds, never a
    real thousands-grouped number, so every comma here is a value separator
    — contrast extract_numbers(), which strips genuine thousands commas.
    """
    if text is None:
        return []
    out = []
    for part in str(text).translate(THAI_DIGITS).split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(float(part))
        except ValueError:
            pass
    return out


def literal_num_prefix(text: str):
    """Return ('2.2.1', rest) if the text starts with a literal number
    prefix — any nesting depth, not just 1-2 levels. A 2-level-only pattern
    would stop at "2.2" for a "2.2.1 ..." row (a case block's internally
    restarted sub-numbering), stranding the "1" as leading label text and
    leaving every sibling row (2.2.1, 2.2.2, ...) truncated to the same
    "2.2" num — a code collision, not just a cosmetic label glitch."""
    t = clean_ws(text).translate(THAI_DIGITS)
    m = re.match(r"^(\d+(?:\.\d+)*)[\.\s]\s*(.*)$", t)
    if m and not re.match(r"^\d+\s*[-–]\s*\d", t):  # avoid '10-50 คัน' ranges
        return m.group(1).rstrip("."), m.group(2)
    return None, t
