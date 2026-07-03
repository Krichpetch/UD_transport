'use strict'
// One-time defect cleanup, run 2026-07-03:
//   1. Deletes the 10 mock-seeded stations (Thai-name PKs from seed.ts) + their checklists.
//   2. Merges the 3 duplicate-station groups found by _find-duplicate-stations.cjs: keeps the
//      row with a real responsibleAgency (not the 'อื่นๆ' parsing fallback), reassigns the
//      other row's checklists onto it, then deletes the duplicate row.
//   3. Re-derives the merged keeper's score/status/lastInspected from its now-complete
//      checklist history (same "most recent by submittedAt" rule as findLatest()).
//   4. Writes one AuditLog entry per deletion/merge (action prefixed DEFECT_CLEANUP_*) so the
//      removal is traceable, per CLAUDE.md's audit-trail rule.
// Confirmed with the project owner before running. Not idempotent — do not re-run blindly.
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const MOCK_IDS = [
  'ท่าเรือสาทร', 'ท่าอากาศยานภูเก็ต', 'ท่าอากาศยานสุวรรณภูมิ', 'สถานีขนส่งขอนแก่น',
  'สถานีขนส่งนครราชสีมา', 'สถานีขนส่งหมอชิต', 'สถานีรถไฟเชียงใหม่', 'สถานีรถไฟฟ้าจตุจักร',
  'สถานีรถไฟฟ้าสยาม', 'สถานีรถไฟหัวลำโพง',
]

// [keep, remove, correctedAgency?] — correctedAgency only set when the keeper's
// own agency was itself the 'อื่นๆ' fallback and we know the real one.
const DUPLICATE_GROUPS = [
  { keep: 'cmr16iv4402k2t7lwart7b7ob', remove: 'ท่าอากาศยานภูเก็ต',          correctedAgency: 'ทอท.' },
  { keep: 'cmr16h2v1024yt7lwmuwqx002', remove: 'cmr16h2kl024mt7lwca3guwba', correctedAgency: null },
  { keep: 'cmr16gkp801ikt7lwbyrspnwu', remove: 'cmr16gpaq01oat7lwchojmh2n', correctedAgency: null },
]

function computeScoreFromItems(items) {
  if (!Array.isArray(items)) return 0
  const allItems = items.flatMap(g => (Array.isArray(g && g.items) ? g.items : []))
  const eligible = allItems.filter(it => it.value !== null && it.value !== 'N/A' && !(it.value === 'มี' && it.flagged === true))
  const standard = eligible.filter(it => it.value === 'มี' && it.meetsStandard === true)
  return eligible.length > 0 ? Math.round((standard.length / eligible.length) * 100) : 0
}
function scoreToStatus(score) {
  if (score >= 75) return 'ผ่านมาตรฐาน'
  if (score >= 50) return 'ต้องปรับปรุง'
  return 'ไม่ผ่าน'
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, username: true } })
  if (!admin) throw new Error('No ADMIN user found to attribute AuditLog entries to.')
  console.log(`Attributing cleanup to admin: ${admin.username} (${admin.id})\n`)

  // ── 1. Mock-seeded stations ────────────────────────────────────────────────
  console.log('── Deleting mock-seeded stations ──')
  for (const id of MOCK_IDS) {
    const station = await prisma.station.findUnique({ where: { id } })
    if (!station) { console.log(`  ${id}: already gone, skipping`); continue }
    const checklists = await prisma.checklist.findMany({ where: { stationId: id } })

    await prisma.$transaction([
      prisma.checklist.deleteMany({ where: { stationId: id } }),
      prisma.station.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: 'DEFECT_CLEANUP_MOCK_SEED_DELETE',
          entityType: 'Station',
          entityId: id,
          before: { station, deletedChecklistIds: checklists.map(c => c.id) },
        },
      }),
    ])
    console.log(`  ${id}: deleted (+ ${checklists.length} checklist(s))`)
  }

  // ── 2. Duplicate-station merges ─────────────────────────────────────────────
  console.log('\n── Merging duplicate station groups ──')
  for (const { keep, remove, correctedAgency } of DUPLICATE_GROUPS) {
    const keeper = await prisma.station.findUnique({ where: { id: keep } })
    const dupe   = await prisma.station.findUnique({ where: { id: remove } })
    if (!keeper) { console.log(`  SKIP: keeper ${keep} not found`); continue }
    if (!dupe)   { console.log(`  ${remove}: already gone, skipping`); continue }

    const movedChecklists = await prisma.checklist.findMany({ where: { stationId: remove } })

    const ops = [
      prisma.checklist.updateMany({ where: { stationId: remove }, data: { stationId: keep } }),
      prisma.station.delete({ where: { id: remove } }),
    ]
    if (correctedAgency) {
      ops.push(prisma.station.update({ where: { id: keep }, data: { responsibleAgency: correctedAgency } }))
    }
    ops.push(prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: 'DEFECT_CLEANUP_DUPLICATE_MERGE',
        entityType: 'Station',
        entityId: remove,
        before: { removedStation: dupe, reassignedChecklistIds: movedChecklists.map(c => c.id) },
        after: { mergedIntoStationId: keep, correctedAgency },
      },
    }))
    await prisma.$transaction(ops)

    // Re-derive the keeper's score/status/lastInspected from its full, now-merged
    // checklist history — same "most recent by submittedAt, then createdAt" rule
    // findLatest() uses, so the station's cached fields match what the app displays.
    const latest = await prisma.checklist.findFirst({
      where: { stationId: keep, status: { in: ['SUBMITTED', 'APPROVED'] } },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
    })
    if (latest) {
      const score = computeScoreFromItems(latest.items)
      const status = scoreToStatus(score)
      await prisma.station.update({
        where: { id: keep },
        data: { score, status, lastInspected: latest.submittedAt },
      })
      console.log(`  merged ${remove} -> ${keep} (${movedChecklists.length} checklist(s) reassigned); keeper rescored to ${score} (${status})`)
    } else {
      console.log(`  merged ${remove} -> ${keep} (${movedChecklists.length} checklist(s) reassigned); no APPROVED/SUBMITTED checklist to rescore from`)
    }
  }

  console.log('\nDone.')
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
