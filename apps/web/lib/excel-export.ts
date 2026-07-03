// Server-side only — imported exclusively by API route handlers
import ExcelJS from 'exceljs'
import type { Station, ChecklistGroup, ChecklistSubItem, TransportMode } from '@repo/types'
import { checklistTemplates } from '@/lib/constants'

type StationTypeConfig = {
  label: string
  mode: TransportMode
  railSubtype?: string
}

export const STATION_TYPES: StationTypeConfig[] = [
  { label: 'สถานีขนส่งผู้โดยสาร', mode: 'ทางบก' },
  { label: 'สถานีรถไฟ',           mode: 'ทางราง', railSubtype: 'รถไฟ' },
  { label: 'สถานีรถไฟฟ้า',        mode: 'ทางราง', railSubtype: 'รถไฟฟ้า' },
  { label: 'ท่าเรือโดยสาร',        mode: 'ทางเรือ' },
  { label: 'ท่าอากาศยาน',          mode: 'ทางอากาศ' },
]

export function getStationTypeLabel(station: Station): string {
  if (station.mode === 'ทางราง') {
    return station.railSubtype === 'รถไฟฟ้า' ? 'สถานีรถไฟฟ้า' : 'สถานีรถไฟ'
  }
  return STATION_TYPES.find(t => t.mode === station.mode && !t.railSubtype)?.label
    ?? 'สถานีขนส่งผู้โดยสาร'
}

export function getTemplateForMode(mode: TransportMode): ChecklistGroup[] {
  return checklistTemplates[mode]
}

export function sanitizeSheetName(name: string): string {
  return name.replace(/[:\\/\?*[\]]/g, '').slice(0, 31)
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim()
}

const CATEGORY_LABELS: Record<string, string> = {
  A: 'A การเข้าถึงสถานี',
  B: 'B การให้บริการภายในสถานี',
  C: 'C บุคลากรผู้ให้บริการ',
}

const IDENTITY_COLS = 5

export function toBuddhistYear(dateStr: string | null | undefined): number {
  const year = dateStr ? new Date(dateStr).getFullYear() : new Date().getFullYear()
  return year + 543
}

function formatValue(item: ChecklistSubItem): string {
  if (item.value === null) return ''
  if (item.value === 'N/A') return 'ไม่เกี่ยวข้อง'
  if (item.value === 'ไม่มี') return 'ไม่มี'
  if (item.value === 'มี' && item.meetsStandard) return 'มี, ได้มาตรฐาน'
  return 'มี, ไม่ได้มาตรฐาน'
}

// One export row = one real (station, auditYear) assessment — never a placeholder.
export interface ExportRow {
  station: Station
  groups: ChecklistGroup[]
  auditYear: number // Buddhist year
}

/**
 * Populates a single worksheet with the matrix layout for one station type.
 * Row 1: category band (A / B / C) merged across their item columns.
 * Row 2: bold header row — ลำดับ | ปี | <typeName> | หน่วยงาน | ด้าน | (A1.1) …
 * Rows 3+: one data row per (station, auditYear), sorted by province, nameTh, year.
 */
export function buildTypeMatrixSheet(
  ws: ExcelJS.Worksheet,
  typeName: string,
  rows: ExportRow[],
  templateGroups: ChecklistGroup[],
): void {
  const allTemplateItems = templateGroups.flatMap(g => g.items)
  const totalCols = IDENTITY_COLS + allTemplateItems.length

  // ── Column widths ──────────────────────────────────────────────────────────
  ws.getColumn(1).width = 8
  ws.getColumn(2).width = 8
  ws.getColumn(3).width = 32
  ws.getColumn(4).width = 12
  ws.getColumn(5).width = 22
  for (let c = 6; c <= totalCols; c++) ws.getColumn(c).width = 9

  // ── Row 1: category band ───────────────────────────────────────────────────
  type CatSpan = { cat: string; start: number; end: number }
  const catSpans: CatSpan[] = []
  allTemplateItems.forEach((item, idx) => {
    const cat = item.id[0] ?? 'A'
    const colIdx = IDENTITY_COLS + 1 + idx // 1-based
    const last = catSpans[catSpans.length - 1]
    if (last && last.cat === cat) {
      last.end = colIdx
    } else {
      catSpans.push({ cat, start: colIdx, end: colIdx })
    }
  })

  ws.mergeCells(1, 1, 1, IDENTITY_COLS)
  ws.getRow(1).getCell(1).value = ''

  for (const span of catSpans) {
    if (span.start !== span.end) ws.mergeCells(1, span.start, 1, span.end)
    const cell = ws.getRow(1).getCell(span.start)
    cell.value = CATEGORY_LABELS[span.cat] ?? span.cat
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
  }
  ws.getRow(1).height = 20

  // ── Row 2: column header ───────────────────────────────────────────────────
  const hdrFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
  const hdrFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }

  const identityHeaders = ['ลำดับ', 'ปี', typeName, 'หน่วยงาน', 'ด้าน']
  identityHeaders.forEach((h, i) => {
    const cell = ws.getRow(2).getCell(i + 1)
    cell.value = h
    cell.font = hdrFont
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.fill = hdrFill
  })

  allTemplateItems.forEach((item, idx) => {
    const cell = ws.getRow(2).getCell(IDENTITY_COLS + 1 + idx)
    cell.value = `(${item.id})`
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 }
    cell.fill = hdrFill
  })
  ws.getRow(2).height = 80

  // ── Freeze top 2 rows + first 5 identity columns ───────────────────────────
  ws.views = [{ state: 'frozen', xSplit: IDENTITY_COLS, ySplit: 2 }]

  // ── Data rows — sorted by province, nameTh, then auditYear ─────────────────
  const sorted = [...rows].sort(
    (a, b) =>
      a.station.province.localeCompare(b.station.province, 'th') ||
      a.station.nameTh.localeCompare(b.station.nameTh, 'th') ||
      a.auditYear - b.auditYear,
  )

  const evenFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
  const oddFill: ExcelJS.Fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }

  sorted.forEach((entry, rowIdx) => {
    const itemMap = new Map<string, ChecklistSubItem>()
    entry.groups.flatMap(g => g.items).forEach(item => itemMap.set(item.id, item))

    const row = ws.getRow(3 + rowIdx)
    row.getCell(1).value = rowIdx + 1
    row.getCell(2).value = entry.auditYear
    row.getCell(3).value = entry.station.nameTh
    row.getCell(4).value = entry.station.responsibleAgency
    row.getCell(5).value = typeName

    allTemplateItems.forEach((templateItem, idx) => {
      const actual = itemMap.get(templateItem.id)
      row.getCell(IDENTITY_COLS + 1 + idx).value = actual ? formatValue(actual) : ''
    })

    const rowFill = rowIdx % 2 === 1 ? evenFill : oddFill
    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = rowFill
      cell.alignment = { vertical: 'middle', wrapText: false }
      cell.font = { size: 10 }
    })
    row.height = 18
  })
}
