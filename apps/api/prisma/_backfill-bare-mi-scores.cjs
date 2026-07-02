'use strict'
// Backfill: recompute scores for all APPROVED checklists under the new formula
// (bare-มี / flagged items excluded from denominator).
// Safe to re-run — only writes when the recomputed score differs from stored.
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

function computeScore(items) {
  if (!Array.isArray(items)) return 0
  const allItems = items.flatMap(g => g?.items ?? [])
  const eligible = allItems.filter(it =>
    it.value !== null &&
    it.value !== 'N/A' &&
    !(it.value === 'มี' && it.flagged === true),  // มี && flagged
  )
  const standard = eligible.filter(it => it.value === 'มี' && it.meetsStandard === true)
  return eligible.length > 0 ? Math.round((standard.length / eligible.length) * 100) : 0
}

function scoreToStatus(score) {
  if (score >= 75) return 'ผ่านมาตรฐาน'   // ผ่านมาตรฐาน
  if (score >= 50) return 'ต้องปรับปรุง' // ต้องปรับปรุง
  return 'ไม่ผ่าน'                                              // ไม่ผ่าน
}

async function main() {
  const checklists = await prisma.checklist.findMany({
    where: { status: 'APPROVED' },
    select: { id: true, stationId: true, score: true, submittedAt: true, items: true },
  })

  // Latest approved per station
  const latest = new Map()
  for (const c of checklists) {
    const ex = latest.get(c.stationId)
    if (!ex || c.submittedAt > ex.submittedAt) latest.set(c.stationId, c)
  }

  let checklistUpdates = 0
  let stationUpdates   = 0
  let scoreRises       = 0
  let scoreFalls       = 0

  for (const cl of checklists) {
    const newScore = computeScore(cl.items)
    if (newScore === cl.score) continue
    if (newScore > cl.score) scoreRises++
    else scoreFalls++
    await prisma.checklist.update({ where: { id: cl.id }, data: { score: newScore } })
    checklistUpdates++
  }

  // Recompute station.score/status from its latest approved checklist
  for (const cl of latest.values()) {
    const newScore  = computeScore(cl.items)
    const newStatus = scoreToStatus(newScore)
    const station   = await prisma.station.findUnique({ where: { id: cl.stationId }, select: { score: true, status: true } })
    if (!station) continue
    if (station.score === newScore && station.status === newStatus) continue
    await prisma.station.update({
      where: { id: cl.stationId },
      data:  { score: newScore, status: newStatus },
    })
    stationUpdates++
  }

  console.log('\n══ Backfill: bare-มี exclusion ══')  // ══ Backfill: bare-มี exclusion ══
  console.log(`  Checklists scanned : ${checklists.length}`)
  console.log(`  Checklist updates  : ${checklistUpdates}  (${scoreRises} rose, ${scoreFalls} fell)`)
  console.log(`  Station updates    : ${stationUpdates}`)

  // Final consistency check
  const allStations = await prisma.station.findMany({ select: { id: true, score: true, status: true } })
  const mismatches  = allStations.filter(s => {
    const expected = s.score >= 75 ? scoreToStatus(100) : s.score >= 50 ? scoreToStatus(60) : scoreToStatus(0)
    return s.status !== expected
  })
  console.log(`  Score/status mismatches: ${mismatches.length}`)
  if (mismatches.length > 0) {
    for (const s of mismatches.slice(0, 5)) console.log(`    id=${s.id} score=${s.score} status=${s.status}`)
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e.message); process.exit(1) })
