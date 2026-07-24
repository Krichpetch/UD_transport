"""Orchestrator: run <mode> --docx <file> --old <template.json> [--outdir DIR]

Runs Stage 1 (docx_parser) + Stage 2 (flatten_old) + Stage 3 (aligner) and
writes migration_report_{mode}.md + migration_review_{mode}.csv (Stage 4).
Stage 5 (merger) is a separate, explicit step — it refuses to run while any
review row is undecided, so it is not chained here automatically.

Outputs are namespaced by input DOCX: everything lands in
<outdir>/<docx stem>/, not directly in <outdir>. This keeps reruns against
a different or revised DOCX for the same mode (e.g. a fuller rail export,
or rail_metro vs rail_train) from overwriting each other's artifacts.
"""
import argparse
import json
from pathlib import Path

from aligner import align
from docx_parser import main as parse_docx
from flatten_old import flatten_old
from report import write_report, write_review_csv


def run(mode, docx_path, old_path, outdir):
    outdir = Path(outdir) / Path(docx_path).stem
    outdir.mkdir(parents=True, exist_ok=True)
    old_path = str(Path(old_path).resolve())

    parse_docx(docx_path, str(outdir))
    new_records = json.loads((outdir / "new_ir.json").read_text(encoding="utf-8"))

    old_records = flatten_old(json.loads(Path(old_path).read_text(encoding="utf-8")))
    (outdir / "old_ir.json").write_text(
        json.dumps(old_records, ensure_ascii=False, indent=1),
        encoding="utf8", newline="\n")

    result = align(old_records, new_records)
    matches = result.to_dict()
    # breadcrumbs merger.py needs to build template_{mode}_v3.json without
    # the caller having to re-pass them on the Stage 5 invocation.
    matches["_old_template_path"] = old_path
    matches["_source_docx"] = Path(docx_path).name
    (outdir / "matches.json").write_text(
        json.dumps(matches, ensure_ascii=False, indent=1),
        encoding="utf8", newline="\n")

    remarks_path = outdir / "remarks_raw.json"
    remarks = json.loads(remarks_path.read_text(encoding="utf-8")) if remarks_path.exists() else None

    write_report(mode, result, outdir / f"migration_report_{mode}.md")
    write_review_csv(mode, result, outdir / f"migration_review_{mode}.csv", remarks=remarks)
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("mode", help="e.g. rail, land, air, water")
    ap.add_argument("--docx", required=True, help="revised checklist DOCX")
    ap.add_argument("--old", required=True, help="template_{mode}_v2.json")
    ap.add_argument("--outdir", default=None,
                     help="default: ./output/<mode> (gitignored — see .gitignore); "
                          "the DOCX filename stem is always appended as a subfolder")
    args = ap.parse_args()
    outdir = args.outdir or f"./output/{args.mode}"
    run(args.mode, args.docx, args.old, outdir)
    print(f"-> {Path(outdir) / Path(args.docx).stem}")


if __name__ == "__main__":
    main()
