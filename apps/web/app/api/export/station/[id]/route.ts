import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import {
  buildTypeMatrixSheet,
  getStationTypeLabel,
  getTemplateForMode,
  sanitizeFilename,
  sanitizeSheetName,
  toBuddhistYear,
  STATION_TYPES,
  type ExportRow,
} from '@/lib/excel-export'
import type { Station, ChecklistGroup } from '@repo/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface ExportChecklistRow {
  items: ChecklistGroup[]
  submittedAt: string | null
  station: Station
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = request.headers.get('authorization')
  const headers: Record<string, string> = auth ? { Authorization: auth } : {}

  const [stationRes, checklistsRes] = await Promise.all([
    fetch(`${API_URL}/stations/${id}`, { headers }),
    fetch(`${API_URL}/stations/export/checklists/${id}`, { headers }),
  ])
  if (!stationRes.ok) {
    return NextResponse.json({ error: 'ไม่พบสถานี' }, { status: stationRes.status })
  }
  const station = (await stationRes.json()) as Station
  const checklistRows: ExportChecklistRow[] = checklistsRes.ok ? await checklistsRes.json() : []

  const typeName = getStationTypeLabel(station)
  const typeConfig = STATION_TYPES.find(t => t.label === typeName)!
  const templateGroups = getTemplateForMode(typeConfig.mode)

  const rows: ExportRow[] = checklistRows
    .map(cl => ({ station, groups: cl.items, auditYear: toBuddhistYear(cl.submittedAt) }))
    .sort((a, b) => a.auditYear - b.auditYear)

  // No approved assessment yet — still produce a valid (blank) template row
  // rather than an empty workbook.
  if (rows.length === 0) {
    rows.push({ station, groups: templateGroups, auditYear: toBuddhistYear(null) })
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'UD Transport — สนข.'
  wb.created = new Date()

  const ws = wb.addWorksheet(sanitizeSheetName(typeName))
  buildTypeMatrixSheet(ws, typeName, rows, templateGroups)

  const buffer = await wb.xlsx.writeBuffer()
  const today = new Date().toISOString().slice(0, 10)
  const filename = `${sanitizeFilename(station.nameTh)}_${today}.xlsx`

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
