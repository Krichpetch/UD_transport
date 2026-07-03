'use strict'
// Reports stations that collide on a normalized (nameTh, mode, province) key —
// the DB unique constraint is exact-string, so whitespace/casing drift lets
// near-duplicates through it. READ-ONLY — prints a report, makes no changes.
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

function normalize(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function dupeKey(s) {
  return `${normalize(s.nameTh)}|${s.mode}|${normalize(s.province)}`
}

async function main() {
  const stations = await prisma.station.findMany({
    select: {
      id: true, nameTh: true, mode: true, province: true, responsibleAgency: true,
      score: true, lastInspected: true, createdAt: true,
    },
    orderBy: { nameTh: 'asc' },
  })

  const groups = new Map()
  for (const s of stations) {
    const key = dupeKey(s)
    const arr = groups.get(key)
    if (arr) arr.push(s)
    else groups.set(key, [s])
  }

  const dupes = [...groups.values()].filter(g => g.length > 1)

  console.log(`\nTotal stations : ${stations.length}`)
  console.log(`Duplicate groups (normalized nameTh+mode+province) : ${dupes.length}`)
  if (dupes.length === 0) {
    console.log('  None found.')
  } else {
    let total = 0
    for (const g of dupes) {
      total += g.length
      console.log(`\n  Key: "${g[0].nameTh}" | ${g[0].mode} | ${g[0].province}  (${g.length} rows)`)
      for (const s of g) {
        const li = s.lastInspected ? s.lastInspected.toISOString().slice(0, 10) : 'never'
        console.log(`    "${s.id}" | agency=${s.responsibleAgency} | score=${s.score} | lastInspected=${li} | createdAt=${s.createdAt.toISOString().slice(0, 10)}`)
      }
    }
    console.log(`\n${total} rows across ${dupes.length} groups. Review and confirm before merge/delete.`)
    console.log('Suggested keep: row with the most recent lastInspected (falls back to most recent createdAt).')
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e.message); process.exit(1) })
