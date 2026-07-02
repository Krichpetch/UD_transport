'use strict'
// Lists stations whose primary key does not look like a Prisma cuid.
// Cuids start with 'c' and are 25 chars; anything else is suspect (e.g. Thai-name IDs from seed.ts).
// READ-ONLY — prints a report, makes no changes.
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const CUID_RE = /^c[a-z0-9]{24}$/

async function main() {
  const stations = await prisma.station.findMany({
    select: { id: true, nameTh: true, mode: true, province: true, lastInspected: true, score: true },
    orderBy: { nameTh: 'asc' },
  })

  const suspects = stations.filter(s => !CUID_RE.test(s.id))

  console.log(`\nTotal stations : ${stations.length}`)
  console.log(`Suspect (non-cuid) IDs : ${suspects.length}`)
  if (suspects.length === 0) {
    console.log('  None found.')
  } else {
    console.log('\n  id | nameTh | mode | province | score | lastInspected')
    for (const s of suspects) {
      const li = s.lastInspected ? s.lastInspected.toISOString().slice(0, 10) : 'never'
      console.log(`  "${s.id}" | ${s.nameTh} | ${s.mode} | ${s.province} | ${s.score} | ${li}`)
    }
    console.log('\nAction required: review the list above and confirm before deleting/re-keying.')
    console.log('These rows were likely inserted by seed.ts using the Thai name as the PK.')
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e.message); process.exit(1) })
