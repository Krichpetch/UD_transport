// Station masterlist cutover, import hardening (Task B3) — the review-CSV workflow, same shape
// as the checklist-migration tool's migration_review_{mode}.csv (tools/checklist-migration/
// report.py): one row per incoming record, a blank `decision` column a human fills in, and a
// separate --apply-review pass that consumes filled-in decisions. Reusing that shape
// deliberately so an admin learns one review workflow, not two.
import * as fs from 'fs'
import * as path from 'path'

export interface ReconciliationRow {
  index: number
  nameTh: string
  mode: string
  line: string
  tier: string | null
  status: 'MATCHED' | 'MATCHED_FUZZY' | 'REVIEW' | 'NOT_ON_MASTERLIST'
  matchedStationId: string | null
  score: number
}

const CSV_COLUMNS = ['index', 'nameTh', 'mode', 'line', 'tier', 'status', 'matchedStationId', 'score', 'decision'] as const

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function reconciliationToCsv(rows: ReconciliationRow[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of rows) {
    const fields = [
      String(r.index),
      escapeCsvField(r.nameTh),
      escapeCsvField(r.mode),
      escapeCsvField(r.line),
      r.tier ?? '',
      r.status,
      r.matchedStationId ?? '',
      String(r.score),
      '', // decision -- blank for a human to fill in
    ]
    lines.push(fields.join(','))
  }
  return lines.join('\n') + '\n'
}

export function reconciliationFilename(source: string, date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10)
  return `import_reconciliation_${source}_${dateStr}.csv`
}

export function writeReconciliationCsv(source: string, rows: ReconciliationRow[], dir: string, date?: Date): string {
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, reconciliationFilename(source, date))
  fs.writeFileSync(filePath, reconciliationToCsv(rows))
  return filePath
}

export interface ReviewDecision {
  index: number
  decision: 'accept' | { mapToStationId: string }
}

/**
 * REVIEW/NOT_ON_MASTERLIST rows are skipped at import time, but a human's later decision (this
 * CSV's `decision` column) needs the row's ORIGINAL payload (items/score/lastInspected) to
 * actually apply anything -- the reconciliation CSV only carries match metadata, not checklist
 * data. This sidecar is that payload cache, written alongside the CSV, consumed only by
 * prisma/apply-import-review.ts.
 */
export function pendingPayloadsFilename(source: string, date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10)
  return `import_pending_${source}_${dateStr}.json`
}

export function writePendingPayloads(
  source: string,
  payloads: Array<{ index: number; row: unknown }>,
  dir: string,
  date?: Date,
): string {
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, pendingPayloadsFilename(source, date))
  fs.writeFileSync(filePath, JSON.stringify(payloads, null, 2))
  return filePath
}

export function readPendingPayloads(filePath: string): Array<{ index: number; row: unknown }> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false }
      else { cur += ch }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

/** Parses a filled-in reconciliation CSV, returning only rows with a non-empty decision. */
export function parseReviewDecisions(csvContent: string): ReviewDecision[] {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const header = splitCsvLine(lines[0]!)
  const idx = (name: string) => header.indexOf(name)
  const decisions: ReviewDecision[] = []
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line)
    const decisionRaw = (fields[idx('decision')] ?? '').trim()
    if (!decisionRaw) continue
    const index = Number(fields[idx('index')])
    if (decisionRaw === 'accept') {
      decisions.push({ index, decision: 'accept' })
    } else if (decisionRaw.startsWith('map_to:')) {
      decisions.push({ index, decision: { mapToStationId: decisionRaw.slice('map_to:'.length).trim() } })
    }
    // Any other value is an unrecognized decision and is ignored -- same "don't guess" stance
    // as an unmatched row: a human must write exactly 'accept' or 'map_to:<id>'.
  }
  return decisions
}
