/**
 * Full-database backup via pg_dump. Dumps EVERY table (User, Station, ChecklistTemplate,
 * MasterCriterion, LawReference, Checklist, AuditLog, …) to a single timestamped file.
 *
 * WHY THIS EXISTS
 * ---------------
 * dump-template-backup.ts only captures ChecklistTemplate.definition — it is NOT a backup of the
 * database. Before any schema migration (`prisma migrate deploy`) or other risky write against an
 * environment with real data (Railway / prod), take a real full dump with THIS script first.
 *
 *   ts-node prisma/dump-full-backup.ts [outDir]
 *
 * outDir defaults to apps/api/backups/ (gitignored). Read-only against the DB.
 *
 * OUTPUT FORMAT
 * -------------
 * pg_dump custom format (-Fc): compressed and restored with pg_restore, e.g.
 *   pg_restore --no-owner --no-privileges -d "$TARGET_DATABASE_URL" <file>
 * The dump is --no-owner/--no-privileges so it restores cleanly under a different role on the new
 * host (e.g. the HCI server), and includes the CREATE EXTENSION statements — the RESTORE TARGET must
 * be a PostGIS-capable Postgres (postgis binaries present), never a stock image, or the geography
 * column + GiST index restore will fail.
 *
 * CONFIDENTIALITY
 * ---------------
 * A full dump contains real inspection data + PII. Keep it in backups/ (gitignored) or move it
 * offline. NEVER commit it. (root CLAUDE.md: no real inspection data / PII in git.)
 *
 * REQUIREMENTS
 * ------------
 * `pg_dump` must be on PATH, or set PG_DUMP_PATH to its full path (e.g. a PostgreSQL client install).
 * Its major version should be >= the server's, so prefer the pg_dump that ships with the matching
 * Postgres (16).
 */
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

function maskUrl(url: string): string {
  return url.replace(/(:\/\/[^:]+:)[^@]+@/, '$1***@')
}

function main(): void {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set — point it at the database you want to back up.')
    process.exit(1)
  }

  const outDir = process.argv[2] ?? path.join(__dirname, '..', 'backups')
  fs.mkdirSync(outDir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = path.join(outDir, `full-db-backup-${stamp}.dump`)

  const pgDump = process.env.PG_DUMP_PATH ?? 'pg_dump'
  console.log(`SOURCE -> ${maskUrl(databaseUrl)}`)
  console.log(`DUMP   -> ${outPath}`)

  // Pass the connection string + options as separate args (no shell) to avoid quoting pitfalls with
  // special characters in the URL on Windows/PowerShell.
  const result = spawnSync(
    pgDump,
    [databaseUrl, '--format=custom', '--no-owner', '--no-privileges', '--file', outPath],
    { stdio: 'inherit' },
  )

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      console.error(
        `\n'${pgDump}' not found. Install the PostgreSQL client tools (they ship pg_dump), then either\n` +
          `add it to PATH or set PG_DUMP_PATH to its full path and re-run. On Windows the EnterpriseDB\n` +
          `installer puts it at e.g. C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe.`,
      )
    } else {
      console.error(err)
    }
    process.exit(1)
  }
  if (result.status !== 0) {
    // pg_dump already printed the reason to stderr (inherited). Remove the partial/empty file.
    fs.rmSync(outPath, { force: true })
    console.error(`\npg_dump exited with code ${result.status}. No backup written.`)
    process.exit(result.status ?? 1)
  }

  const bytes = fs.statSync(outPath).size
  console.log(`\nWrote full backup (${(bytes / 1024 / 1024).toFixed(2)} MB) -> ${outPath}`)
}

if (require.main === module) {
  main()
}
