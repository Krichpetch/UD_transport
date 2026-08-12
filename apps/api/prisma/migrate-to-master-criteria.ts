/**
 * Session S5, Part G — DRY-RUN migration tooling: computes which SHARED canonical items (facility-
 * grouping.core.ts's engine, the same one behind the facility-grouped editor) are conflict-free
 * and eligible to become a MasterCriterion, and which are blocked, for a target facility type (or
 * both Phase-1 defaults). Never writes without --confirm; even with --confirm, this only migrates
 * conflict-free items — anything still disputed must go through the existing conflict-resolution
 * flow (facility-groups.service.ts / the grouped editor's conflict queue) first.
 *
 * Per this project's DB-write-caution convention (same discipline as restore-template-approvals.ts):
 * dry-run by default, pause for explicit human sign-off before ANY real run, staging included. This
 * script has NOT been executed against any database as part of building it — see
 * apps/api/src/admin/templates/__tests__/master-migration-dry-run.spec.ts for the dry-run numbers,
 * computed instead against the real committed tools/checklist_json/*_v3.json files directly.
 *
 *   ts-node prisma/migrate-to-master-criteria.ts [--facility=ramp|tactile|all] [--confirm]
 */
import { randomUUID } from 'crypto'
import { PrismaClient, Prisma } from '@prisma/client'
import type { ChecklistTemplateDefinition, TransportMode } from '@repo/types'
import { type FacilityLoadedTemplate, type TemplateRowStatus } from '../src/admin/templates/facility-grouping.core'
import { PHASE1_FACILITIES, computeDryRun, type EligibleMigrationItem } from '../src/admin/templates/master-migration.core'
import { pushMasterToInstance, type MasterCriterionPayload } from '../src/admin/templates/master-criteria.core'
import { TEMPLATE_MASTER_MIGRATE } from '../src/admin/templates/master-criteria.service'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const confirm = args.includes('--confirm')
  const facilityArg = args.find((a) => a.startsWith('--facility='))?.split('=')[1] ?? 'all'
  const needles = facilityArg === 'all' ? Object.values(PHASE1_FACILITIES).flat() : (PHASE1_FACILITIES[facilityArg] ?? [facilityArg])

  console.log(`MODE   -> ${confirm ? 'WRITE (--confirm given)' : 'DRY RUN (no writes; pass --confirm to apply)'}`)
  console.log(`TARGET -> facility="${facilityArg}" (matches: ${needles.join(', ')})\n`)

  const rows = await prisma.checklistTemplate.findMany({ where: { version: 3 } })
  if (rows.length === 0) {
    console.error('no v3 ChecklistTemplate rows found — nothing to migrate')
    process.exitCode = 1
    return
  }
  const templates: FacilityLoadedTemplate[] = rows.map((r) => ({
    templateId: r.id,
    mode: r.mode as TransportMode,
    variantKey: r.variantKey,
    version: r.version,
    status: r.status as TemplateRowStatus,
    definition: r.definition as unknown as ChecklistTemplateDefinition,
  }))

  const report = computeDryRun(templates, needles)
  if (report.matchedGroups.length === 0) {
    console.error(`no container group matched facility="${facilityArg}" — nothing to report`)
    process.exitCode = 1
    return
  }

  console.log(`Container groups matched: ${report.matchedGroups.join(', ')}\n`)
  console.log(`ELIGIBLE (would create a MasterCriterion): ${report.eligible.length}`)
  for (const e of report.eligible) {
    console.log(`  [${e.containerGroupLabel}] "${e.itemLabel}" — ${e.instanceCount} instance(s): ${e.instances.map((i) => `${i.mode}/${i.variantKey}:${i.nodeCode}`).join(', ')}`)
  }
  console.log(`\nBLOCKED (unresolved conflict or field divergence): ${report.blocked.length}`)
  for (const b of report.blocked) {
    console.log(`  [${b.containerGroupLabel}] "${b.itemLabel}" (${b.instanceCount} instances) — ${b.reason}`)
  }
  console.log(`\n${report.eligible.length} would be created, ${report.blocked.length} blocked, ${report.skippedSingleInstance} single-instance (skipped, nothing to synchronize)`)

  if (!confirm) {
    console.log('\nDry run only — pass --confirm to apply (creates MasterCriterion rows + sets masterId on every listed instance).')
    return
  }

  // ---- real run — never exercised this session; kept complete so a human can run it deliberately
  // later, exactly like restore-template-approvals.ts's own --confirm branch. ----
  for (const e of report.eligible) {
    await migrateOneItem(e)
  }
}

async function migrateOneItem(e: EligibleMigrationItem): Promise<void> {
  const first = e.instances[0]!
  const firstRow = await prisma.checklistTemplate.findUnique({ where: { id: first.templateId } })
  if (!firstRow) return
  const firstDef = firstRow.definition as unknown as ChecklistTemplateDefinition
  const sourceNode = [...indexAllNodes(firstDef).values()].find((n) => n.code === first.nodeCode)
  if (!sourceNode) return

  const created = await prisma.masterCriterion.create({
    data: {
      labelTh: e.itemLabel,
      answerType: sourceNode.answerType ?? null,
      measurements: (sourceNode.measurements as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      guidance: (sourceNode.guidance as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      imageKeys: sourceNode.imageKeys ?? [],
      lawRefs: sourceNode.lawRefs ?? [],
      cabinetResolution: sourceNode.cabinetResolution ?? null,
      beyondLaw: sourceNode.beyondLaw ?? null,
      facilityCode: sourceNode.facilityCode ?? null,
      updatedBy: 'migrate-to-master-criteria.ts',
    },
  })

  const payload: MasterCriterionPayload = {
    id: created.id,
    labelTh: created.labelTh,
    answerType: created.answerType as MasterCriterionPayload['answerType'],
    measurements: created.measurements as MasterCriterionPayload['measurements'],
    guidance: created.guidance as MasterCriterionPayload['guidance'],
    imageKeys: created.imageKeys,
    lawRefs: created.lawRefs,
    cabinetResolution: created.cabinetResolution,
    beyondLaw: created.beyondLaw,
    facilityCode: created.facilityCode,
  }

  const correlationId = randomUUID()
  for (const inst of e.instances) {
    const row = await prisma.checklistTemplate.findUnique({ where: { id: inst.templateId } })
    if (!row) continue
    const def = row.definition as unknown as ChecklistTemplateDefinition
    const pushResult = pushMasterToInstance(def, inst.nodeCode, payload, { setMasterId: true, clearDetached: true })
    await prisma.checklistTemplate.update({ where: { id: inst.templateId }, data: { definition: pushResult.definition as unknown as Prisma.InputJsonValue } })
    await prisma.auditLog.create({
      data: {
        userId: 'system:migrate-to-master-criteria',
        action: TEMPLATE_MASTER_MIGRATE,
        entityType: 'ChecklistTemplate',
        entityId: inst.templateId,
        before: { correlationId, nodeCode: inst.nodeCode, masterId: created.id } as unknown as Prisma.InputJsonValue,
        after: { correlationId, nodeCode: inst.nodeCode, masterId: created.id } as unknown as Prisma.InputJsonValue,
      },
    })
  }
  console.log(`  created master ${created.id} for "${e.itemLabel}" -> linked ${e.instances.length} instance(s)`)
}

// Local, minimal full-tree walk (containers + leaves, like @repo/types#indexTemplateNodesByCode) —
// avoids importing the whole @repo/types surface just for one lookup here.
function indexAllNodes(def: ChecklistTemplateDefinition) {
  const index = new Map<string, ChecklistTemplateDefinition['groups'][number]['items'][number]>()
  const visit = (node: ChecklistTemplateDefinition['groups'][number]['items'][number]) => {
    index.set(node.code, node)
    for (const child of node.subItems ?? []) visit(child)
  }
  for (const g of def.groups) for (const item of g.items) visit(item)
  return index
}

// Guarded (unlike seed-templates.ts) so this file can be imported for a compile-time smoke test
// without touching any database — see __tests__/master-migration-dry-run.spec.ts's doc for why
// that matters here specifically (this session must not run anything against a DB, dry or not).
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
