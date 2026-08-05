/**
 * Dumps every ChecklistTemplate row's { mode, variantKey, version, definition } to a timestamped
 * JSON file, in exactly the shape restore-template-approvals.ts expects as its <backup.json> arg.
 *
 * WHY THIS EXISTS
 * ---------------
 * seed-templates.ts REBUILDS every template's `definition` from the pristine tools/checklist_json/
 * files, discarding anything admin-authored that isn't reproducible from a repo file — measurement
 * `confirmed` flags, and (2026-08-06) `imageKeys`/`guidance`. restore-template-approvals.ts replays
 * those edits back from a backup taken BEFORE the reseed — but it can only restore what the backup
 * actually captured. Run this immediately before every `seed-templates.ts` run against an
 * environment with real admin review work (i.e. Railway), never the other way around.
 *
 *   ts-node prisma/dump-template-backup.ts [outDir]
 *
 * outDir defaults to apps/api/backups/ (gitignored — see the confidentiality note in that
 * directory's sibling files). Read-only: does not write to the database.
 */
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const outDir = process.argv[2] ?? path.join(__dirname, '..', 'backups')
  fs.mkdirSync(outDir, { recursive: true })

  const url = process.env.DATABASE_URL ?? ''
  console.log(`SOURCE -> ${url.replace(/(:\/\/[^:]+:)[^@]+@/, '$1***@')}`)

  const rows = await prisma.checklistTemplate.findMany({
    select: { mode: true, variantKey: true, version: true, status: true, definition: true },
    orderBy: [{ mode: 'asc' }, { variantKey: 'asc' }, { version: 'asc' }],
  })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = path.join(outDir, `railway-templates-backup-${stamp}.json`)
  // restore-template-approvals.ts only reads mode/variantKey/version/definition — status rides
  // along in the file for human reference only, harmless extra field.
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), 'utf-8')

  console.log(`Wrote ${rows.length} template row(s) -> ${outPath}`)
  for (const r of rows) console.log(`  ${r.mode} ${r.variantKey} v${r.version} (${r.status})`)
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
