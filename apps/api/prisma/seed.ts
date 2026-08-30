import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { BCRYPT_ROUNDS } from '../src/config/constants'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // ---- Users ----
  const passwordHash = await bcrypt.hash('password123', BCRYPT_ROUNDS)

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', email: 'admin@ud-transport.go.th', passwordHash, role: 'ADMIN', isSuperAdmin: true },
  })
  await prisma.user.upsert({
    where: { username: 'auditor1' },
    update: {},
    create: { username: 'auditor1', email: 'auditor1@ud-transport.go.th', passwordHash, role: 'AUDITOR' },
  })
  await prisma.user.upsert({
    where: { username: 'executive' },
    update: {},
    create: { username: 'executive', email: 'executive@ud-transport.go.th', passwordHash, role: 'EXECUTIVE' },
  })

  // Station seeding was removed here (Part 0 fix, W2-S1) — it referenced the pre-cutover
  // unique-key shape (nameTh, mode, responsibleAgency, province), which no longer exists on
  // Station (replaced by (mode, nameTh, line) at the masterlist cutover), so it failed to even
  // compile. prisma/reset-stations.ts is the real, authoritative station-seeding path (the
  // closed 823-row masterlist) — run that separately, not this script.

  console.log('Seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
