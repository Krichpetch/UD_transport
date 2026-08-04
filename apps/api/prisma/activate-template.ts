/**
 * Flip a ChecklistTemplate from DRAFT to ACTIVE — i.e. make auditors actually use it.
 *
 * There is deliberately no API/UI route for this (see apps/api/src/admin/templates/), because
 * activation is not an editing action: it changes which form every auditor in the country sees on
 * their next audit. This script is the controlled path, with the three guardrails a bare
 * `UPDATE ... SET status='ACTIVE'` would miss.
 *
 * GUARDRAIL 1 — retire the template being superseded.
 *   ChecklistTemplate has no partial unique index on (mode, variantKey) WHERE status='ACTIVE', and
 *   checklists.service.ts#getActiveTemplate resolves with `findFirst`. Two ACTIVE rows for the same
 *   (mode, variantKey) therefore resolve NON-DETERMINISTICALLY — auditors would get v1 or v3
 *   depending on row order. So activating a template RETIREs any other ACTIVE row for the same
 *   (mode, variantKey), in the same transaction.
 *
 * GUARDRAIL 2 — in-progress drafts.
 *   getTemplateForAudit() resolves the ACTIVE template by (mode, variantKey), NOT by the draft's
 *   own templateId. An auditor part-way through a v1 audit would, on their next open, be handed
 *   the v3 form while their stored answers are keyed to v1 node codes — they would appear to have
 *   lost their work. This script refuses to run while any affected DRAFT checklist exists, unless
 *   --force is given. Get those drafts submitted (or deleted) first.
 *
 * GUARDRAIL 3 — audit trail.
 *   Root CLAUDE.md requires every data mutation to write an AuditLog row. Both the activation and
 *   the retirement are logged, with before/after status, against the acting user.
 *
 * Dry-run by default.
 *
 *   ts-node prisma/activate-template.ts --user=<username> --variant=rail_metro --version=3 [--mode=ทางราง] [--confirm] [--force]
 *
 * Omit --variant to activate that version across EVERY variant of every mode that has one (the
 * "activate all v3" case) — read the dry-run output carefully before confirming that.
 */
import { PrismaClient, Prisma } from '@prisma/client'
import { resolveVariantKey, type TransportMode } from '@repo/types'

const prisma = new PrismaClient()

export const TEMPLATE_ACTIVATE = 'TEMPLATE_ACTIVATE'
export const TEMPLATE_RETIRE = 'TEMPLATE_RETIRE'

interface Args {
  user?: string
  variant?: string
  mode?: string
  version?: number
  confirm: boolean
  force: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=')
  const versionRaw = get('version')
  return {
    user: get('user'),
    variant: get('variant'),
    mode: get('mode'),
    version: versionRaw !== undefined ? Number(versionRaw) : undefined,
    confirm: argv.includes('--confirm'),
    force: argv.includes('--force'),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (!args.user) {
    console.error('--user=<username> is required: activation is audit-logged against a real account.')
    process.exit(1)
  }
  if (args.version === undefined || !Number.isInteger(args.version)) {
    console.error('--version=<n> is required (e.g. --version=3).')
    process.exit(1)
  }

  console.log(`TARGET -> ${(process.env.DATABASE_URL ?? '').replace(/(:\/\/[^:]+:)[^@]+@/, '$1***@')}`)
  console.log(args.confirm ? 'MODE   -> WRITE (--confirm given)\n' : 'MODE   -> DRY RUN (no writes; pass --confirm to apply)\n')

  const actor = await prisma.user.findUnique({ where: { username: args.user } })
  if (!actor) {
    console.error(`no user with username "${args.user}" — activation must be attributable.`)
    process.exit(1)
  }

  const targets = await prisma.checklistTemplate.findMany({
    where: {
      version: args.version,
      ...(args.variant ? { variantKey: args.variant } : {}),
      ...(args.mode ? { mode: args.mode } : {}),
    },
    orderBy: [{ mode: 'asc' }, { variantKey: 'asc' }],
  })

  if (targets.length === 0) {
    console.error('no templates matched --version/--variant/--mode.')
    process.exit(1)
  }

  // ---- Guardrail 2: in-progress drafts that would be re-rendered against a different template --
  const affected = new Set(targets.map((t) => `${t.mode}::${t.variantKey}`))
  const drafts = await prisma.checklist.findMany({
    where: { status: 'DRAFT' },
    select: { id: true, templateId: true, station: { select: { nameTh: true, mode: true, railSubtype: true } } },
  })
  const atRisk = drafts.filter((d) => {
    if (!d.station) return false
    const { variantKey } = resolveVariantKey(d.station.mode as TransportMode, d.station.railSubtype)
    if (!affected.has(`${d.station.mode}::${variantKey}`)) return false
    // A draft already on the target template is fine — it is only a mismatch that hurts.
    return !targets.some((t) => t.id === d.templateId)
  })

  if (atRisk.length > 0) {
    console.log(`⚠  ${atRisk.length} in-progress DRAFT checklist(s) are on a different template for an affected variant:`)
    for (const d of atRisk.slice(0, 10)) console.log(`     ${d.station?.nameTh} (${d.station?.mode}${d.station?.railSubtype ? '/' + d.station.railSubtype : ''})`)
    console.log('   Activating now would hand these auditors the new form with their old answers unhydrated.')
    if (!args.force) {
      console.log('\n   Refusing to proceed. Have these submitted or deleted, or re-run with --force.')
      process.exit(1)
    }
    console.log('   --force given; proceeding anyway.\n')
  }

  // ---- Plan ------------------------------------------------------------------------------------
  let activations = 0
  for (const t of targets) {
    const superseded = await prisma.checklistTemplate.findMany({
      where: { mode: t.mode, variantKey: t.variantKey, status: 'ACTIVE', id: { not: t.id } },
    })
    const label = `${t.mode} ${t.variantKey} v${t.version}`

    if (t.status === 'ACTIVE') {
      console.log(`${label.padEnd(32)} | already ACTIVE — nothing to do`)
      continue
    }
    if (t.status === 'RETIRED') {
      console.log(`${label.padEnd(32)} | RETIRED — skipped (re-activating a retired template is not this script's job)`)
      continue
    }

    const retireNote = superseded.length
      ? `retires ${superseded.map((s) => 'v' + s.version).join(', ')}`
      : 'no currently-ACTIVE template for this variant'
    console.log(`${label.padEnd(32)} | DRAFT -> ACTIVE   (${retireNote})`)
    activations++

    if (!args.confirm) continue

    await prisma.$transaction(async (tx) => {
      for (const s of superseded) {
        await tx.checklistTemplate.update({ where: { id: s.id }, data: { status: 'RETIRED' } })
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: TEMPLATE_RETIRE,
            entityType: 'ChecklistTemplate',
            entityId: s.id,
            before: { status: s.status } as Prisma.InputJsonValue,
            after: { status: 'RETIRED', supersededBy: t.id, supersededByVersion: t.version } as Prisma.InputJsonValue,
          },
        })
      }
      await tx.checklistTemplate.update({ where: { id: t.id }, data: { status: 'ACTIVE' } })
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: TEMPLATE_ACTIVATE,
          entityType: 'ChecklistTemplate',
          entityId: t.id,
          before: { status: t.status } as Prisma.InputJsonValue,
          after: { status: 'ACTIVE', mode: t.mode, variantKey: t.variantKey, version: t.version } as Prisma.InputJsonValue,
        },
      })
    })
  }

  console.log(`\n${args.confirm ? 'Activated' : 'Would activate'} ${activations} template(s).`)
  if (!args.confirm && activations > 0) console.log('Re-run with --confirm to apply.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
