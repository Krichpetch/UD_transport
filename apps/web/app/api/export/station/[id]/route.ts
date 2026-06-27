import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { mockStations } from '@/lib/mock-data'
import {
  buildTypeMatrixSheet,
  getStationTypeLabel,
  getTemplateForMode,
  sanitizeFilename,
  sanitizeSheetName,
  STATION_TYPES,
} from '@/lib/excel-export'
import type { ChecklistGroup } from '@repo/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const station = mockStations.find(s => s.id === id)
  if (!station) {
    return NextResponse.json({ error: 'Station not found' }, { status: 404 })
  }

  const body = await request.json() as { groups?: ChecklistGroup[] }
  const groups: ChecklistGroup[] = body.groups ?? getTemplateForMode(station.mode)

  const typeName = getStationTypeLabel(station)
  const typeConfig = STATION_TYPES.find(t => t.label === typeName)!
  const templateGroups = getTemplateForMode(typeConfig.mode)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'UD Transport — สนข.'
  wb.created = new Date()

  const ws = wb.addWorksheet(sanitizeSheetName(typeName))
  const checklistsMap = new Map<string, ChecklistGroup[]>([[station.id, groups]])
  buildTypeMatrixSheet(ws, typeName, [station], checklistsMap, templateGroups)

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
