'use strict'
// Checks the live database (DATABASE_URL) for drift against the migration history in
// prisma/migrations/. Exits non-zero (and prints the missing DDL) if the live DB is missing
// anything the migrations folder says should exist -- e.g. Railway, which has only ever been
// `db push`ed and is missing the two partial unique indexes from
// migrations/20260718170200_checklist_draft_submit_uniqueness (partial indexes aren't
// expressible in schema.prisma, so `db push` can never create them -- see the comment above
// the Checklist model).
//
// Direction matters: --from-url (the live DB) --to-migrations (what history says should exist).
// A non-empty script means the live DB needs those statements applied to catch up. Run this
// against a dev/CI DB freely; running it against Railway is a read-only diff (it never writes),
// but treat the result as informational only -- applying the fix is the separate baseline
// runbook, not this script.
//
// `migrate diff` against a --to-migrations directory always needs a shadow database (it has to
// actually apply the migrations somewhere to know the resulting schema) -- pass
// SHADOW_DATABASE_URL to use a specific one (e.g. if the provider forbids CREATE DATABASE);
// otherwise this derives `<database>_shadow` on the same Postgres server as a same-user
// default, which Prisma creates and drops automatically around the diff.
const path = require('path')
const { execFileSync } = require('child_process')

// Unlike `npx prisma ...` subcommands (which load .env automatically), a plain `node` process
// does not -- load it explicitly so `pnpm run db:drift-check` works the same way the other
// prisma/*.ts scripts do.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

function deriveShadowUrl(url) {
  const u = new URL(url)
  u.pathname = u.pathname.replace(/\/([^/]+)$/, (_, dbName) => `/${dbName}_shadow`)
  return u.toString()
}

const shadowUrl = process.env.SHADOW_DATABASE_URL || deriveShadowUrl(databaseUrl)

const args = [
  'prisma', 'migrate', 'diff',
  '--from-url', databaseUrl,
  '--to-migrations', 'prisma/migrations',
  '--shadow-database-url', shadowUrl,
  '--script',
]

let output
try {
  // shell: true so `npx` resolves on Windows (a .cmd shim, not directly executable via
  // execFileSync without a shell) as well as POSIX.
  output = execFileSync('npx', args, { encoding: 'utf8', shell: true })
} catch (err) {
  // migrate diff itself exits 0 even when a diff exists -- a non-zero exit here means the
  // command failed to run (bad connection, missing shadow db, etc.), not "drift found".
  console.error('prisma migrate diff failed to run:')
  console.error((err.stdout || '') + (err.stderr || err.message))
  process.exit(1)
}

const executableLines = output
  .split('\n')
  .filter((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('--')
  })

if (executableLines.length > 0) {
  console.error('Drift detected -- the live database is missing DDL present in migration history:\n')
  console.error(output)
  process.exit(1)
}

console.log('No drift: live database matches migration history.')
