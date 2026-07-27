import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { runLegacyReimport } from './reimport.core'
import type { LegacyChecklistExportRow, ReimportReport } from './legacy-checklist.types'

@Injectable()
export class ReimportService {
  constructor(private readonly prisma: PrismaService) {}

  async importRows(rows: LegacyChecklistExportRow[], adminId: string, dryRun: boolean): Promise<ReimportReport> {
    return runLegacyReimport(this.prisma, rows, { adminId, dryRun })
  }
}
