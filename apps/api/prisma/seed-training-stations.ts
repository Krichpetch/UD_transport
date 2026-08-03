// Session S3b, Part A.1 — seeds the 5 tutorial/example stations, one per template type, that
// back the auditor's "แบบฝึกหัด" (tutorial) flow. Each is:
//   - isTraining: true (excluded from every real aggregate — see StationsService/AdminService)
//   - scope: OUT_OF_SCOPE (never counted as an audit target, belt-and-suspenders alongside isTraining)
//   - no coordinates (the tutorial's proximity gate is skipped server-side regardless — Part A.2)
//   - yearBuilt: null (so the tutorial walks the auditor through the year-entry step too)
//   - named unmistakably so no one could mistake one for a real station in a list
//
// Idempotent: upserts by the same (mode, nameTh, line) identity key every other station uses.
// Run after `prisma migrate deploy`:
//   npx ts-node prisma/seed-training-stations.ts

import { PrismaClient } from '@prisma/client'
import { OTHER_AGENCY } from '@repo/types'

const prisma = new PrismaClient()

interface TrainingStationSeed {
  nameTh: string
  mode: string
  railSubtype?: string
}

const TRAINING_STATIONS: TrainingStationSeed[] = [
  { nameTh: 'สถานีฝึกหัด — ทางบก', mode: 'ทางบก' },
  { nameTh: 'สถานีฝึกหัด — ทางน้ำ', mode: 'ทางน้ำ' },
  { nameTh: 'สถานีฝึกหัด — ทางอากาศ', mode: 'ทางอากาศ' },
  { nameTh: 'สถานีฝึกหัด — ทางราง (รถไฟ)', mode: 'ทางราง', railSubtype: 'รถไฟ' },
  { nameTh: 'สถานีฝึกหัด — ทางราง (รถไฟฟ้า)', mode: 'ทางราง', railSubtype: 'รถไฟฟ้า' },
]

async function main() {
  const report: string[] = []

  for (const s of TRAINING_STATIONS) {
    await prisma.station.upsert({
      where: { mode_nameTh_line: { mode: s.mode, nameTh: s.nameTh, line: '' } },
      update: {
        railSubtype: s.railSubtype ?? null,
        isTraining: true,
        scope: 'OUT_OF_SCOPE',
      },
      create: {
        name: s.nameTh,
        nameTh: s.nameTh,
        mode: s.mode,
        railSubtype: s.railSubtype ?? null,
        line: '',
        responsibleAgency: OTHER_AGENCY,
        scope: 'OUT_OF_SCOPE',
        isTraining: true,
        yearBuilt: null,
      },
    })
    report.push(`upserted: ${s.nameTh}`)
  }

  console.log(report.join('\n'))
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
