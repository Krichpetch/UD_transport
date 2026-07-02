'use strict'
// Verification: prints value-class histogram and spot-checks stored scores
// against server-side recomputation (the same logic as scoring.ts).
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

function computeScore(items) {
  if (!Array.isArray(items)) return 0
  const allItems = items.flatMap(g => g?.items ?? [])
  const eligible = allItems.filter(it => it.value !== null && it.value !== 'N/A')
  const standard = eligible.filter(it => it.value === 'มี' && it.meetsStandard === true)
  return eligible.length > 0 ? Math.round((standard.length / eligible.length) * 100) : 0
}

async function main() {
  const checklists = await prisma.checklist.findMany({
    where: { status: 'APPROVED' },
    select: { id: true, stationId: true, score: true, submittedAt: true, items: true },
    orderBy: { submittedAt: 'desc' },
  })

  // Dedupe to most recent per station
  const latest = new Map()
  for (const c of checklists) {
    if (!latest.has(c.stationId)) latest.set(c.stationId, c)
  }

  // ── Value-class histogram ─────────────────────────────────────────────────
  const hist = {
    hasStandard: 0, hasSubstandard: 0, standardUnspecified: 0,
    none: 0, na: 0, nullOrOther: 0, total: 0,
  }
  for (const cl of latest.values()) {
    for (const g of (Array.isArray(cl.items) ? cl.items : [])) {
      for (const it of (g?.items ?? [])) {
        hist.total++
        if (it.value === null)    { hist.nullOrOther++;          continue }
        if (it.value === 'N/A')   { hist.na++;                   continue }
        if (it.value === 'ไม่มี') { hist.none++;                 continue }
        if (it.value === 'มี') {
          if (it.meetsStandard)   hist.hasStandard++
          else if (it.flagged)    hist.standardUnspecified++
          else                    hist.hasSubstandard++
        }
      }
    }
  }

  console.log('\n══ Value-class histogram (latest approved checklist per station) ══')
  console.log(`  มี / ได้มาตรฐาน          : ${String(hist.hasStandard).padStart(6)}`)
  console.log(`  มี / ไม่ได้มาตรฐาน       : ${String(hist.hasSubstandard).padStart(6)}`)
  console.log(`  มี / ไม่ระบุ ⚑ (bare มี) : ${String(hist.standardUnspecified).padStart(6)}`)
  console.log(`  ไม่มี                    : ${String(hist.none).padStart(6)}`)
  console.log(`  N/A  (excluded)          : ${String(hist.na).padStart(6)}`)
  console.log(`  null / OTHER ⚑           : ${String(hist.nullOrOther).padStart(6)}`)
  console.log(`  ────────────────────────────────`)
  console.log(`  Total cells              : ${String(hist.total).padStart(6)}`)

  // ── Spot-checks: stored score vs server-recomputed ────────────────────────
  const entries = [...latest.values()].slice(0, 10)
  const stations = await prisma.station.findMany({
    where: { id: { in: entries.map(e => e.stationId) } },
    select: { id: true, nameTh: true, score: true, status: true },
  })
  const stMap = new Map(stations.map(s => [s.id, s]))

  console.log('\n══ Spot-checks: stored station.score vs server-recomputed ══')
  let mismatches = 0
  for (const cl of entries) {
    const computed = computeScore(cl.items)
    const st = stMap.get(cl.stationId)
    const stored = st?.score ?? null
    const match = stored !== null && Math.abs(computed - stored) < 1
    if (!match) mismatches++
    const flag = match ? '✓' : '✗ MISMATCH'
    console.log(`  ${flag}  ${(st?.nameTh ?? cl.stationId).padEnd(30)} stored=${String(stored ?? '—').padStart(4)}  computed=${String(computed).padStart(4)}`)
  }

  // ── Status vs recomputed ──────────────────────────────────────────────────
  const allStations = await prisma.station.findMany({ select:{ id:true, score:true, status:true } })
  const statusMismatch = allStations.filter(s => {
    const expected = s.score >= 75 ? 'ผ่านมาตรฐาน' : s.score >= 50 ? 'ต้องปรับปรุง' : 'ไม่ผ่าน'
    return s.status !== expected
  })

  console.log(`\n══ Score/status consistency ══`)
  console.log(`  Station score–status mismatches: ${statusMismatch.length}`)
  if (statusMismatch.length > 0 && statusMismatch.length <= 5) {
    for (const s of statusMismatch) console.log(`    id=${s.id} score=${s.score} status=${s.status}`)
  }

  console.log(`\n══ Summary ══`)
  console.log(`  Checklists total       : ${checklists.length}`)
  console.log(`  Unique stations w/data : ${latest.size}`)
  console.log(`  Score spot mismatches  : ${mismatches}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e.message); process.exit(1) })
