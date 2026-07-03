'use strict'
// Runs every .sql file in prisma/migrations_manual/, in filename order, against DATABASE_URL.
// These are schema changes Prisma's `db push`/`migrate` can't safely express (e.g. PostGIS
// expression indexes — see the .sql files themselves for why). All statements in this folder
// must be idempotent (IF NOT EXISTS) so this is safe to re-run.
//
// Run this AFTER `prisma db push` (or `prisma migrate deploy`) on any environment: fresh dev
// DB, CI, staging, prod. Nothing runs this automatically yet — it is not wired into
// `postinstall` or the Docker build on purpose, since it alters schema and a deploy step
// should decide when that happens, not every `pnpm install`.
//
// Uses PrismaClient (already a project dependency) rather than adding a new `pg` dependency
// just for this script. Each file is split on top-level `;` and run as separate statements —
// fine for the plain DDL in this folder; if a future file needs a PL/pgSQL block or anything
// else containing an internal `;`, split it out into its own single-statement file instead of
// making this script's splitting logic smarter than it needs to be.
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const DIR = path.join(__dirname, 'migrations_manual')

async function main() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
  if (files.length === 0) {
    console.log('No manual migrations found in', DIR)
    return
  }

  const prisma = new PrismaClient()
  try {
    for (const file of files) {
      const raw = fs.readFileSync(path.join(DIR, file), 'utf8')
      // Strip full-line `--` comments before splitting on `;` — prose comments in this repo
      // sometimes contain a semicolon mid-sentence, which would otherwise split a statement
      // in the wrong place. None of these files use inline trailing comments on code lines.
      const sql = raw
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0)
      console.log(`Applying ${file} (${statements.length} statement(s)) ...`)
      for (const stmt of statements) {
        await prisma.$executeRawUnsafe(stmt)
      }
      console.log('  done.')
    }
  } finally {
    await prisma.$disconnect()
  }
  console.log('All manual migrations applied.')
}

main().catch(e => { console.error(e.message); process.exit(1) })
