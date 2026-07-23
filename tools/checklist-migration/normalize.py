"""Shared text normalization + numeric extraction for checklist migration.

Single source of truth: both the DOCX parser (new side) and the old-JSON
flattener must import from here so labelKey computation is identical.
"""
import re
import unicodedata

THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")

# Numbering prefixes like "1. ", "2.1 ", "(2.3) ", "๓."
NUM_PREFIX_RE = re.compile(r"^\s*\(?\d+(?:\.\d+)?\)?[\.\s]\s*")
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


def extract_numbers(text: str):
    """Ordered list of numeric literals (commas stripped, Thai digits ok).

    Ratios like '1 : 12' contribute both 1 and 12 — fine, they anchor equally.
    """
    t = (text or "").translate(THAI_DIGITS)
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", t)]


def literal_num_prefix(text: str):
    """Return ('2.1', rest) if the text starts with a literal number prefix."""
    t = clean_ws(text).translate(THAI_DIGITS)
    m = re.match(r"^(\d+(?:\.\d+)?)[\.\s]\s*(.*)$", t)
    if m and not re.match(r"^\d+\s*[-–]\s*\d", t):  # avoid '10-50 คัน' ranges
        return m.group(1).rstrip("."), m.group(2)
    return None, t
