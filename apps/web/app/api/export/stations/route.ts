import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { mockStations } from '@/lib/mock-data'
import {
  buildTypeMatrixSheet,
  getStationTypeLabel,
  getTemplateForMode,
  sanitizeSheetName,
  STATION_TYPES,
} from '@/lib/excel-export'
import type { Station, ChecklistGroup } from '@repo/types'

export async function GET() {
  // Group stations by the 5 official station types
  const stationsByType = new Map<string, Station[]>()
  for (const t of STATION_TYPES) stationsByType.set(t.label, [])
  for (const station of mockStations) {
    const label = getStationTypeLabel(station)
    stationsByType.get(label)?.push(station)
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'UD Transport — สนข.'
  wb.created = new Date()

  // One sheet per transport type; skip types with no stations
  for (const typeConfig of STATION_TYPES) {
    const stations = stationsByType.get(typeConfig.label) ?? []
    if (stations.length === 0) continue

    const ws = wb.addWorksheet(sanitizeSheetName(typeConfig.label))
    const templateGroups = getTemplateForMode(typeConfig.mode)

    // Phase 2: replace with a single DB query that fetches all checklists at once
    const checklistsMap = new Map<string, ChecklistGroup[]>()

    buildTypeMatrixSheet(ws, typeConfig.label, stations, checklistsMap, templateGroups)
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
