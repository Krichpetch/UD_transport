/**
 * UDT-28 — read-only inspection of the ธรณีประตู door-threshold leaf across every ChecklistTemplate
 * row, so we can see what value is actually STORED before/after reconciling it to 13 mm. The door
 * leaf is coded B1.1-4 in land/air/rail_train (and the v2 templates) and B2.1-4 in rail_metro; it
 * carries m1 (height, lte, mm — the reconciled threshold) and m2 (edge slope, lte, degree — the
 * UDT-30 slopeAngle item). The number is admin-editable via the template editor and lives only in
 * ChecklistTemplate.definition, never in git, so this is the only way to know the live value.
 *
 *   DATABASE_URL=... ts-node prisma/inspect-door-threshold.ts
 *
 * Point DATABASE_URL at local or the Railway public URL. Does NOT write to the database.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DOOR_CODES = new Set(['B1.1-4', 'B2.1-4'])

interface Node {
  code?: string
  measurements?: Array<Record<string, unknown>>
  subItems?: Node[]
}

function findDoorLeaf(def: unknown): Node | null {
  const groups = (def as { groups?: Array<{ items?: Node[] }> })?.groups ?? []
  let found: Node | null = null
  const visit = (n: Node) => {
    if (found) return
    if (n.code && DOOR_CODES.has(n.code) && n.measurements) { found = n; return }
    for (const c of n.subItems ?? []) visit(c)
  }
  for (const g of groups) for (const it of g.items ?? []) visit(it)
  return found
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''
  console.log(`SOURCE -> ${url.replace(/(:\/\/[^:]+:)[^@]+@/, '$1***@')}\n`)

  const rows = await prisma.checklistTemplate.findMany({
    select: { mode: true, variantKey: true, version: true, status: true, definition: true },
    orderBy: [{ mode: 'asc' }, { variantKey: 'asc' }, { version: 'asc' }],
  })

  for (const r of rows) {
    const leaf = findDoorLeaf(r.definition)
    const head = `${r.mode} / ${r.variantKey} v${r.version} (${r.status})`
    if (!leaf) { console.log(`${head}: no door leaf (B1.1-4 / B2.1-4)`); continue }
    console.log(`${head}  [${leaf.code}]`)
    for (const m of leaf.measurements ?? []) {
      const byLaw = m.byLaw ? ` byLaw=${JSON.stringify(m.byLaw)}` : ''
      console.log(
        `    ${m.key}: ${m.operator} ${m.value ?? '·'} ${m.unit}` +
        `  confirmed=${m.confirmed ?? false}` +
        (m.slopeAngle ? ' slopeAngle=true' : '') +
        `  "${m.sourceText ?? ''}"${byLaw}`,
      )
    }
  }
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exit(1) })
    .finally(() => prisma.$disconnect())
}
