// Part F (W2-S1) — standalone runner for the historical checklist reimport, same
// plain-PrismaClient style as prisma/seed.ts (not routed through Nest DI). Reads the real
// pre-cutover export from docs/legacy-export/ (gitignored — dropped there separately, never
// committed; see the confidential-data-not-committed convention this project already follows
// for real สนข. inspection data). Defaults to --dry-run; pass --write to actually import.
//
// Usage: pnpm --filter api exec ts-node prisma/reimport-legacy-checklists.ts [--write] [--admin=<userId>] [file]
import * as fs from 'fs'
import * as path from 'path'
import { PrismaClient } from '@prisma/client'
import { runLegacyReimport } from '../src/admin/reimport/reimport.core'
import type { LegacyChecklistExportRow } from '../src/admin/reimport/legacy-checklist.types'

const LEGACY_EXPORT_DIR = path.resolve(__dirname, '..', 'docs', 'legacy-export')

async function main() {
  const args = process.argv.slice(2)
  const dryRun = !args.includes('--write')
  const adminArg = args.find((a) => a.startsWith('--admin='))
  const fileArg = args.find((a) => !a.startsWith('--'))

  const prisma = new PrismaClient()
  try {
    const adminId = adminArg
      ? adminArg.slice('--admin='.length)
      : (await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } }))?.id
    if (!adminId) {
      console.error('No ADMIN user found and --admin=<userId> was not provided.')
      process.exit(1)
    }

    const filePath = fileArg
      ? path.resolve(fileArg)
      : path.join(LEGACY_EXPORT_DIR, 'legacy-checklists.json')
    if (!fs.existsSync(filePath)) {
      console.error(`Legacy export file not found: ${filePath}`)
      console.error(`Drop the export at ${LEGACY_EXPORT_DIR}/legacy-checklists.json (gitignored) before running this without --write for a dry run, or point at a specific file as the last argument.`)
      process.exit(1)
    }

    const rows = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LegacyChecklistExportRow[]
    console.log(`Loaded ${rows.length} row(s) from ${filePath}. Mode: ${dryRun ? 'DRY RUN' : 'WRITE'}.`)

    const report = await runLegacyReimport(prisma, rows, { adminId, dryRun })

    const imported = report.results.filter((r) => r.imported).length
    const skipped = report.results.filter((r) => r.skipped)
    const errored = report.results.filter((r) => r.error).length
    console.log(`Imported: ${imported}, skipped: ${skipped.length}, errors: ${errored}`)
    for (const reason of ['REVIEW', 'NOT_ON_MASTERLIST', 'AUDITOR_NOT_FOUND', 'ALREADY_IMPORTED', 'NO_ACTIVE_TEMPLATE'] as const) {
      const count = skipped.filter((r) => r.skipped?.reason === reason).length
      if (count > 0) console.log(`  ${reason}: ${count}`)
    }
    if (report.reconciliationCsvPath) console.log(`Reconciliation CSV: ${report.reconciliationCsvPath}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
