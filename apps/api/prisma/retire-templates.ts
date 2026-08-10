/**
 * Retire a v1/v2 ChecklistTemplate — flip ACTIVE -> RETIRED, never row-deleted.
 *
 * Session S4b, Part 5 — the mirror image of activate-template.ts: that script makes v3 the form
 * auditors see; this one is the LAST step of a mode's migration, retiring the v1/v2 form it
 * replaced. Same "no API/UI route, this is the controlled path" reasoning as activate-template.ts:
 * retiring the form real auditors are currently using is not an editing action, it is a decision
 * that changes what every auditor in the country sees next time they open the app.
 *
 * GUARDRAIL 1 — EVERY v3 variant of the SAME MODE must already be ACTIVE.
 *   Checked by MODE, not by (mode, variantKey): rail's v1 is a single row (variantKey 'standard',
 *   never split — see seed-templates.ts's "v1 is NOT split by variant" note) covering both รถไฟ
 *   and รถไฟฟ้า, while v3 rail splits into rail_train + rail_metro. A same-variantKey lookup would
 *   never find a v3 'standard' row for rail and would refuse forever even once migration is
 *   genuinely complete — requiring every v3 row of the mode to be ACTIVE is the correct
 *   generalization (reduces to an ordinary same-key check for land/water/air, which never split).
 *   Retiring a v1/v2 row whose replacement isn't fully live yet would strand auditors:
 *   getActiveTemplate (checklists.service.ts) resolves `findFirst({ status: 'ACTIVE' })` — with the
 *   v1/v2 row RETIRED and its v3 replacement(s) not all ACTIVE yet, that query returns nothing and
 *   NEW audits/drafts for the still-unmigrated variant break outright. This is refused with NO
 *   --force override (same "no force" stance as activate-template.ts's unconfirmed-thresholds
 *   guardrail) — there is no legitimate reason to retire ahead of the replacement being fully live.
 *
 * GUARDRAIL 2 — in-progress DRAFT checklists on the row being retired.
 *   A DRAFT checklist already stamped to the v1/v2 template (Checklist.templateId) is UNAFFECTED
 *   by retirement — templateId is a frozen FK, readable regardless of the referenced row's status
 *   (see the RETIRED-readability test in checklists/__tests__/). The risk is instead an auditor who
 *   has NOT yet started for this station: their next getTemplateForAudit() call resolves via
 *   getActiveTemplate (status-filtered), which — once v3 is ACTIVE — now correctly hands them the
 *   v3 form. That is the INTENDED effect of retirement, not a guardrail case. What this guardrail
 *   actually checks is narrower and mirrors activate-template.ts's own: any DRAFT checklist whose
 *   OWN templateId points at neither this row nor any of this mode's live v3 rows would mean
 *   retirement is happening out of order — caught upstream by Guardrail 1 (this scenario cannot
 *   arise if Guardrail 1 holds). Kept as a defensive double-check, not the primary protection.
 *
 * GUARDRAIL 3 — audit trail.
 *   Root CLAUDE.md requires every data mutation to write an AuditLog entry. TEMPLATE_RETIRE,
 *   the SAME action name activate-template.ts's own supersede-on-activate step already uses, so
 *   the audit history reads as one continuous trail regardless of which script performed a given
 *   retirement.
 *
 * Dry-run by default.
 *
 *   ts-node prisma/retire-templates.ts --user=<username> --mode=ทางบก --variant=standard --confirm
 *
 * Omit --variant/--mode to check every v1/v2 row across every mode/variant (the "how much of the
 * migration can proceed today" dry-run) — read the output carefully before scoping down to a
 * specific --confirm run. THIS SCRIPT HAS NOT BEEN RUN AGAINST ANY ENVIRONMENT (built and reviewed
 * only, per session S4b's explicit instruction not to execute it).
 */
import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()

export const TEMPLATE_RETIRE = 'TEMPLATE_RETIRE'

interface Args {
  user?: string
  mode?: string
  variant?: string
  confirm: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=')
  return {
    user: get('user'),
    mode: get('mode'),
    variant: get('variant'),
    confirm: argv.includes('--confirm'),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (!args.user) {
    console.error('--user=<username> is required: retirement is audit-logged against a real account.')
    process.exit(1)
  }

  console.log(`TARGET -> ${(process.env.DATABASE_URL ?? '').replace(/(:\/\/[^:]+:)[^@]+@/, '$1***@')}`)
  console.log(args.confirm ? 'MODE   -> WRITE (--confirm given)\n' : 'MODE   -> DRY RUN (no writes; pass --confirm to apply)\n')

  const actor = await prisma.user.findUnique({ where: { username: args.user } })
  if (!actor) {
    console.error(`no user with username "${args.user}" — retirement must be attributable.`)
    process.exit(1)
  }

  const candidates = await prisma.checklistTemplate.findMany({
    where: {
      status: 'ACTIVE',
      version: { lt: 3 },
      ...(args.mode ? { mode: args.mode } : {}),
      ...(args.variant ? { variantKey: args.variant } : {}),
    },
    orderBy: [{ mode: 'asc' }, { variantKey: 'asc' }],
  })

  if (candidates.length === 0) {
    console.log('No ACTIVE v1/v2 templates matched --mode/--variant (nothing eligible, or already retired).')
    return
  }

  let retirements = 0
  for (const row of candidates) {
    const label = `${row.mode} ${row.variantKey} v${row.version}`

    // Guardrail 1 — by MODE, not by (mode, variantKey): rail's v1 is a single row (variantKey
    // 'standard', never split — see seed-templates.ts's "v1 is NOT split by variant" note) that
    // covers BOTH รถไฟ and รถไฟฟ้า, while v3 rail splits into rail_train + rail_metro. A same-
    // variantKey lookup would never find a v3 'standard' row for rail and this guardrail would
    // refuse forever, even once migration is actually complete. Requiring EVERY v3 variant of
    // this mode to be ACTIVE is the correct generalization: for land/water/air (single variant
    // both sides) it reduces to the same same-key check; for rail it correctly waits for BOTH
    // rail_train AND rail_metro.
    const v3RowsForMode = await prisma.checklistTemplate.findMany({
      where: { mode: row.mode, version: 3 },
    })
    if (v3RowsForMode.length === 0) {
      console.log(`${label.padEnd(32)} | REFUSED — no v3 row exists yet for ${row.mode}; retiring now would strand auditors`)
      continue
    }
    const notYetActive = v3RowsForMode.filter((t) => t.status !== 'ACTIVE')
    if (notYetActive.length > 0) {
      console.log(
        `${label.padEnd(32)} | REFUSED — ${notYetActive.length}/${v3RowsForMode.length} v3 variant(s) of ${row.mode} not yet ACTIVE (${notYetActive.map((t) => t.variantKey).join(', ')}); retiring now would strand auditors`,
      )
      continue
    }
    const v3ActiveIds = v3RowsForMode.map((t) => t.id)

    // Guardrail 2 (defensive double-check — see header doc): a DRAFT checklist on a DIFFERENT,
    // now-stale template for this mode would mean retirement is somehow racing activation. Should
    // be unreachable if Guardrail 1 held, but checked rather than assumed.
    const staleDrafts = await prisma.checklist.count({
      where: { status: 'DRAFT', templateId: { notIn: [row.id, ...v3ActiveIds] }, station: { mode: row.mode } },
    })
    if (staleDrafts > 0) {
      console.log(`${label.padEnd(32)} | REFUSED — ${staleDrafts} DRAFT checklist(s) reference neither this row nor a live v3 row; investigate before retiring`)
      continue
    }

    console.log(`${label.padEnd(32)} | ACTIVE -> RETIRED   (all ${v3RowsForMode.length} v3 variant(s) of ${row.mode} confirmed ACTIVE)`)
    retirements++

    if (!args.confirm) continue

    await prisma.$transaction(async (tx) => {
      await tx.checklistTemplate.update({ where: { id: row.id }, data: { status: 'RETIRED' } })
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: TEMPLATE_RETIRE,
          entityType: 'ChecklistTemplate',
          entityId: row.id,
          before: { status: row.status } as Prisma.InputJsonValue,
          after: { status: 'RETIRED', supersededBy: v3RowsForMode.map((t) => ({ id: t.id, variantKey: t.variantKey })) } as Prisma.InputJsonValue,
        },
      })
    })
  }

  console.log(`\n${args.confirm ? 'Retired' : 'Would retire'} ${retirements} template(s).`)
  if (!args.confirm && retirements > 0) console.log('Re-run with --confirm to apply.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
