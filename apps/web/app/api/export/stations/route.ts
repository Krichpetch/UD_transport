import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import {
  buildTypeMatrixSheet,
  getStationTypeLabel,
  getTemplateForMode,
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

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  const headers: Record<string, string> = auth ? { Authorization: auth } : {}
  const res = await fetch(`${API_URL}/stations/export/checklists`, { headers })
  if (!res.ok) {
    return NextResponse.json({ error: 'ไม่สามารถดึงข้อมูลสถานีได้' }, { status: res.status })
  }
  const checklistRows = (await res.json()) as ExportChecklistRow[]

  // Group real (station, auditYear) rows by the 5 official station types.
  const byType = new Map<string, ExportRow[]>()
  for (const t of STATION_TYPES) byType.set(t.label, [])
  for (const cl of checklistRows) {
    const typeLabel = getStationTypeLabel(cl.station)
    byType.get(typeLabel)?.push({
      station:   cl.station,
      groups:    cl.items,
      auditYear: toBuddhistYear(cl.submittedAt),
    })
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'UD Transport — สนข.'
  wb.created = new Date()

  // One sheet per transport type; skip types with no submitted assessments.
  for (const typeConfig of STATION_TYPES) {
    const rows = byType.get(typeConfig.label) ?? []
    if (rows.length === 0) continue

    const ws = wb.addWorksheet(sanitizeSheetName(typeConfig.label))
    const templateGroups = getTemplateForMode(typeConfig.mode)
    buildTypeMatrixSheet(ws, typeConfig.label, rows, templateGroups)
  }

  const buffer = await wb.xlsx.writeBuffer()
  const today = new Date().toISOString().slice(0, 10)
  const filename = `stations_export_${today}.xlsx`

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
