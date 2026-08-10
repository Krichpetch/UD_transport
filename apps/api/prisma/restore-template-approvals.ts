/**
 * Restore admin template-editor edits that a `seed-templates.ts` re-run overwrote.
 *
 * WHY THIS EXISTS
 * ---------------
 * seed-templates.ts rebuilds every ChecklistTemplate.definition from the pristine workbook /
 * migration-pipeline JSON in tools/checklist_json/. That is correct for template CONTENT, but it
 * also discards everything an admin did in the in-app template editor — most importantly the
 * per-measurement `confirmed: true` review flags, which represent real human review time and are
 * not reproducible from any file in the repo.
 *
 * This script replays those edits from a pre-seed backup (the JSON written by the Railway sync
 * runbook before seeding) onto the CURRENT definition, so the newly-seeded content is kept and
 * only the human-authored bits are restored.
 *
 * THE MERGE RULE — measurements
 * ------------------------------
 * Base is the CURRENT (freshly seeded) definition, so anything new from the seed survives.
 * Per measurement slot, keyed by `${leaf.code}::${measurement.key}`:
 *
 *   - `confirmed` is always taken from the backup (that IS the reviewer's signal).
 *   - The threshold fields (value/value2/operator/unit/sourceText/note) are taken from the backup
 *     ONLY when the seed did not just introduce a `byLaw` map on that slot. A slot that gained
 *     byLaw was rewritten on purpose by the era-override pass (Session F3, Part G) and its values
 *     now come from the law tables — replaying an older hand-edited scalar over that would
 *     silently undo the override.
 *   - `byLaw` itself is never taken from the backup, for the same reason.
 *
 * THE MERGE RULE — node-level fields (2026-08-06, extended 2026-08-11 for `standalone`)
 * -------------------------------------------------
 * `imageKeys` (admin-attached reference photos, W2-S3a), `guidance` (คู่มือการตรวจประเมิน text), and
 * `standalone` (Session S4b-fix, Fix 4 — detach-to-standalone) all live on the NODE, not a
 * measurement, and — unlike threshold scalars — are NEVER set by seed-templates.ts at all (grep
 * confirms zero references for any of the three). There is no seed-vs-admin conflict to resolve:
 * any value found on a node in the backup is purely admin-authored and always safe to replay onto
 * the same node code in the current tree. Keyed by leaf `code` alone (not a measurement key).
 * `labelTh`/`num` renames, admin-added `lawRefs`/`beyondLaw`, and `conflictSplitAcknowledged` are a
 * KNOWN, NOT-YET-COVERED gap in the same family — those overlap with content the seed itself can
 * legitimately change (a JSON source typo fix, the byLaw→lawRefs union fix, or a genuine re-tagging),
 * so blindly replaying an old backup value risks undoing a real, intentional content fix.
 * `standalone` carries no such risk (the seed never touches it, same as imageKeys/guidance), which
 * is why it joins those two rather than the left-alone list. Left alone deliberately rather than
 * guessed at; flag to a human before extending this further.
 *
 * Slots/nodes present in only one side are reported and skipped, never guessed at.
 *
 * Dry-run by default. Pass --confirm to write.
 *
 *   ts-node prisma/restore-template-approvals.ts <backup.json> [--variant=rail_metro] [--version=3] [--confirm]
 */
import { PrismaClient, Prisma } from '@prisma/client'
import * as fs from 'fs'

const prisma = new PrismaClient()

// Fields the admin editor can change that are NOT derived from the law tables.
const EDITABLE_SCALARS = ['value', 'value2', 'operator', 'unit', 'sourceText', 'note'] as const

interface MeasurementLike {
  key?: string
  confirmed?: boolean
  byLaw?: unknown
  [k: string]: unknown
}

/** Indexes every measurement in a definition by `${leafCode}::${measurementKey}`. */
function indexMeasurements(def: unknown): Map<string, MeasurementLike> {
  const out = new Map<string, MeasurementLike>()
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n && typeof n === 'object') {
      const node = n as { code?: unknown; measurements?: unknown }
      if (typeof node.code === 'string' && Array.isArray(node.measurements)) {
        for (const m of node.measurements as MeasurementLike[]) {
          if (m && typeof m.key === 'string') out.set(`${node.code}::${m.key}`, m)
        }
      }
      Object.values(n).forEach(walk)
    }
  }
  walk(def)
  return out
}

interface NodeLike {
  code?: string
  imageKeys?: string[]
  guidance?: { text?: string; reference?: string }
  standalone?: boolean
  [k: string]: unknown
}

/** Indexes every node (container or leaf) in a definition by its `code`. */
function indexNodes(def: unknown): Map<string, NodeLike> {
  const out = new Map<string, NodeLike>()
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n && typeof n === 'object') {
      const node = n as NodeLike
      if (typeof node.code === 'string') out.set(node.code, node)
      Object.values(n).forEach(walk)
    }
  }
  walk(def)
  return out
}

interface MergeStats {
  confirmedRestored: number
  scalarsRestored: number
  byLawPreserved: number
  imageKeysRestored: number
  guidanceRestored: number
  standaloneRestored: number
  onlyInBackup: string[]
  onlyInCurrent: string[]
}

/**
 * Returns a deep clone of `currentDef` with the backup's human edits replayed onto it.
 * Mutates nothing the caller owns. Exported for ad-hoc verification (no jest harness exists for
 * prisma/ scripts) — not imported anywhere in the app itself.
 */
export function mergeEdits(currentDef: unknown, backupDef: unknown): { merged: unknown; stats: MergeStats } {
  const merged = JSON.parse(JSON.stringify(currentDef)) as unknown
  const cur = indexMeasurements(merged)
  const old = indexMeasurements(backupDef)

  const stats: MergeStats = {
    confirmedRestored: 0,
    scalarsRestored: 0,
    byLawPreserved: 0,
    imageKeysRestored: 0,
    guidanceRestored: 0,
    standaloneRestored: 0,
    onlyInBackup: [],
    onlyInCurrent: [],
  }

  for (const [key, oldM] of old) {
    const curM = cur.get(key)
    if (!curM) {
      stats.onlyInBackup.push(key)
      continue
    }

    if (oldM.confirmed === true && curM.confirmed !== true) {
      curM.confirmed = true
      stats.confirmedRestored++
    }

    // A slot the era-override pass just populated is owned by the law tables now.
    const seedIntroducedByLaw = oldM.byLaw === undefined && curM.byLaw !== undefined
    if (seedIntroducedByLaw) {
      stats.byLawPreserved++
      continue
    }

    for (const f of EDITABLE_SCALARS) {
      if (JSON.stringify(oldM[f]) !== JSON.stringify(curM[f])) {
        curM[f] = oldM[f]
        stats.scalarsRestored++
      }
    }
  }

  for (const key of cur.keys()) if (!old.has(key)) stats.onlyInCurrent.push(key)

  // Node-level admin-authored fields (imageKeys, guidance) — never seed-owned, so any value found
  // in the backup is unconditionally safe to replay onto the same node code. Codes present only in
  // the backup (a node the seed removed/renamed) are silently skipped, not reported: unlike a
  // measurement slot, a missing node here is expected background noise (most nodes carry neither
  // field), not a signal worth surfacing in the report.
  const curNodes = indexNodes(merged)
  const oldNodes = indexNodes(backupDef)
  for (const [code, oldNode] of oldNodes) {
    const curNode = curNodes.get(code)
    if (!curNode) continue

    if (Array.isArray(oldNode.imageKeys) && oldNode.imageKeys.length > 0) {
      if (JSON.stringify(curNode.imageKeys) !== JSON.stringify(oldNode.imageKeys)) {
        curNode.imageKeys = oldNode.imageKeys
        stats.imageKeysRestored++
      }
    }
    if (oldNode.guidance && (oldNode.guidance.text || oldNode.guidance.reference)) {
      if (JSON.stringify(curNode.guidance) !== JSON.stringify(oldNode.guidance)) {
        curNode.guidance = oldNode.guidance
        stats.guidanceRestored++
      }
    }
    if (oldNode.standalone === true && curNode.standalone !== true) {
      curNode.standalone = true
      stats.standaloneRestored++
    }
  }

  return { merged, stats }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const backupPath = args.find((a) => !a.startsWith('--'))
  const confirm = args.includes('--confirm')
  const variantArg = args.find((a) => a.startsWith('--variant='))?.split('=')[1]
  const versionArg = args.find((a) => a.startsWith('--version='))?.split('=')[1]

  if (!backupPath) {
    console.error('usage: ts-node prisma/restore-template-approvals.ts <backup.json> [--variant=X] [--version=N] [--confirm]')
    process.exit(1)
  }
  if (!fs.existsSync(backupPath)) {
    console.error(`backup file not found: ${backupPath}`)
    process.exit(1)
  }

  const url = process.env.DATABASE_URL ?? ''
  console.log(`TARGET -> ${url.replace(/(:\/\/[^:]+:)[^@]+@/, '$1***@')}`)
  console.log(confirm ? 'MODE   -> WRITE (--confirm given)\n' : 'MODE   -> DRY RUN (no writes; pass --confirm to apply)\n')

  const backupRows = JSON.parse(fs.readFileSync(backupPath, 'utf-8')) as Array<{
    mode: string
    variantKey: string
    version: number
    definition: unknown
  }>

  const targets = backupRows.filter(
    (r) => (!variantArg || r.variantKey === variantArg) && (!versionArg || r.version === Number(versionArg)),
  )
  if (targets.length === 0) {
    console.error('no templates in the backup matched the given --variant/--version filter')
    process.exit(1)
  }

  let totalConfirmed = 0
  let wrote = 0

  for (const b of targets) {
    const current = await prisma.checklistTemplate.findFirst({
      where: { mode: b.mode, variantKey: b.variantKey, version: b.version },
    })
    const label = `${b.mode} ${b.variantKey} v${b.version}`
    if (!current) {
      console.log(`${label.padEnd(32)} | SKIPPED — no matching row in the target DB`)
      continue
    }

    const { merged, stats } = mergeEdits(current.definition, b.definition)
    totalConfirmed += stats.confirmedRestored

    const parts = [
      `confirmed+${stats.confirmedRestored}`,
      `fields+${stats.scalarsRestored}`,
      `byLawKept=${stats.byLawPreserved}`,
      `imageKeys+${stats.imageKeysRestored}`,
      `guidance+${stats.guidanceRestored}`,
      `standalone+${stats.standaloneRestored}`,
    ]
    if (stats.onlyInBackup.length) parts.push(`backupOnly=${stats.onlyInBackup.length}`)
    if (stats.onlyInCurrent.length) parts.push(`currentOnly=${stats.onlyInCurrent.length}`)
    console.log(`${label.padEnd(32)} | ${parts.join('  ')}`)

    if (stats.onlyInBackup.length) {
      console.log(`    note: ${stats.onlyInBackup.length} slot(s) exist only in the backup and were skipped: ${stats.onlyInBackup.slice(0, 5).join(', ')}${stats.onlyInBackup.length > 5 ? ' …' : ''}`)
    }

    if (
      confirm &&
      (stats.confirmedRestored > 0 ||
        stats.scalarsRestored > 0 ||
        stats.imageKeysRestored > 0 ||
        stats.guidanceRestored > 0 ||
        stats.standaloneRestored > 0)
    ) {
      await prisma.checklistTemplate.update({
        where: { id: current.id },
        data: { definition: merged as Prisma.InputJsonValue },
      })
      wrote++
    }
  }

  console.log(`\n${confirm ? 'Wrote' : 'Would write'} ${confirm ? wrote : targets.length} template row(s); ${totalConfirmed} confirmed flag(s) restored.`)
  if (!confirm) console.log('Re-run with --confirm to apply.')
}

// Guarded so `mergeEdits` can be imported for ad-hoc verification without also running `main()`.
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
