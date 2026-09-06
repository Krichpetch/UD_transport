/**
 * Local backup of the MinIO object store (inspection evidence photos + admin template images).
 *
 * WHY THIS EXISTS
 * ---------------
 * MinIO holds the actual photo BYTES. The database only stores the object KEYS (ChecklistPhoto.id,
 * nested in Checklist.items JSON, e.g. `checklist-photos/<hex>.jpg`; plus `template-images/…`). If
 * the bucket/volume is lost, every key in the DB dangles -> permanent, unrecoverable loss of
 * confidential inspection evidence. Railway volume snapshots cover the ON-platform copy; this script
 * is the second, independent copy: it pulls the whole bucket down to a local folder so there are
 * always two copies (local device/HCI host + Railway cloud). An offsite copy (Backblaze B2) is a
 * separate, deferred ticket — this script intentionally does local-only for now.
 *
 *   ts-node prisma/backup-minio.ts [outDir] [--dry-run] [--prune] [--verify] [--verify-all]
 *
 * outDir defaults to apps/api/backups/minio/ (gitignored). Read-only against MinIO and the DB.
 *
 * WHAT IT DOES
 * ------------
 * Incremental, ADDITIVE mirror: walks every object in the bucket and downloads only the ones missing
 * locally or whose size/etag changed since the last run (tracked in _manifest.json). Objects deleted
 * from the bucket are KEPT locally by default (evidence preservation) — pass --prune for a true
 * mirror that also removes local files no longer in the bucket. Keys are preserved as the relative
 * path under outDir, so restoring is a straight re-upload by key.
 *
 * RUNNING AGAINST RAILWAY
 * -----------------------
 * MinIO in production is a separate Railway service on public HTTPS, so this runs from any machine
 * that owns the backup folder (the dev PC now, the HCI host later). Point the MINIO_* env at the
 * PUBLIC endpoint:
 *   MINIO_ENDPOINT=<minio-public-host>  MINIO_PORT=443  MINIO_USE_SSL=true
 *   MINIO_ACCESS_KEY=...  MINIO_SECRET_KEY=...  MINIO_BUCKET=ud-transport
 * These are secrets — set them in the environment, never commit them (root CLAUDE.md).
 *
 * CONFIDENTIALITY
 * ---------------
 * The downloaded objects are real inspection evidence. Keep backups/ (gitignored) local or offline;
 * never commit it, never push it to shared/public storage.
 */
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import * as Minio from 'minio'

const BUCKET = process.env.MINIO_BUCKET ?? 'ud-transport'
const MANIFEST_NAME = '_manifest.json'
// The only key prefixes the app ever writes (uploads.controller.ts + templates.service.ts).
const KEY_PREFIXES = ['checklist-photos/', 'template-images/']

interface ObjectEntry {
  size: number
  etag: string
}
interface Manifest {
  finishedAt: string
  bucket: string
  sourceCount: number
  downloaded: number
  skipped: number
  bytesDownloaded: number
  perKey: Record<string, ObjectEntry>
}

function makeClient(): Minio.Client {
  const accessKey = process.env.MINIO_ACCESS_KEY
  const secretKey = process.env.MINIO_SECRET_KEY
  if (!accessKey || !secretKey) {
    console.error(
      'MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set. Point MINIO_* at the bucket you want to\n' +
        'back up (for Railway use the PUBLIC endpoint: MINIO_ENDPOINT=<host> MINIO_PORT=443 MINIO_USE_SSL=true).',
    )
    process.exit(1)
  }
  return new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey,
    secretKey,
  })
}

/** Collect every object in the bucket via the recursive listing stream. */
function listAllObjects(client: Minio.Client): Promise<Array<{ key: string; size: number; etag: string }>> {
  return new Promise((resolve, reject) => {
    const out: Array<{ key: string; size: number; etag: string }> = []
    const stream = client.listObjectsV2(BUCKET, '', true)
    stream.on('data', (item: Minio.BucketItem) => {
      // Recursive listing yields objects (name set), never common-prefix entries.
      if (item.name) out.push({ key: item.name, size: item.size, etag: (item.etag ?? '').replace(/"/g, '') })
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(out))
  })
}

function loadManifest(outDir: string): Manifest | null {
  const p = path.join(outDir, MANIFEST_NAME)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Manifest
  } catch {
    console.warn(`Could not parse existing ${MANIFEST_NAME}; treating every object as new.`)
    return null
  }
}

/** OS-correct local path for an object key (keys use forward slashes). */
function localPathFor(outDir: string, key: string): string {
  return path.join(outDir, ...key.split('/'))
}

/** Recursively collect every string value under a JSON value that names a known object key. */
function collectKeys(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (KEY_PREFIXES.some((p) => value.startsWith(p))) into.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, into)
    return
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectKeys(v, into)
  }
}

/** Every object key the DB references (photo ids in Checklist.items + template imageKeys). */
async function collectDbReferencedKeys(): Promise<string[]> {
  const prisma = new PrismaClient()
  try {
    const keys = new Set<string>()
    const checklists = await prisma.checklist.findMany({ select: { items: true } })
    for (const c of checklists) collectKeys(c.items, keys)
    const templates = await prisma.checklistTemplate.findMany({ select: { definition: true } })
    for (const t of templates) collectKeys(t.definition, keys)
    return [...keys]
  } finally {
    await prisma.$disconnect()
  }
}

function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const prune = args.includes('--prune')
  const verify = args.includes('--verify') || args.includes('--verify-all')
  const verifyAll = args.includes('--verify-all')
  const positional = args.find((a) => !a.startsWith('--'))
  const outDir = positional ?? path.join(__dirname, '..', 'backups', 'minio')

  const client = makeClient()
  console.log(`SOURCE -> ${process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.MINIO_ENDPOINT ?? 'localhost'}:${process.env.MINIO_PORT ?? 9000} bucket "${BUCKET}"`)
  console.log(`DEST   -> ${outDir}${dryRun ? '  (dry run — nothing written)' : ''}`)

  if (!dryRun) fs.mkdirSync(outDir, { recursive: true })

  const objects = await listAllObjects(client)
  const prev = loadManifest(outDir)
  const perKey: Record<string, ObjectEntry> = {}

  let downloaded = 0
  let skipped = 0
  let bytesDownloaded = 0

  for (const obj of objects) {
    perKey[obj.key] = { size: obj.size, etag: obj.etag }
    const local = localPathFor(outDir, obj.key)
    const unchanged =
      fs.existsSync(local) &&
      fs.statSync(local).size === obj.size &&
      prev?.perKey[obj.key]?.etag === obj.etag
    if (unchanged) {
      skipped++
      continue
    }
    if (dryRun) {
      downloaded++
      bytesDownloaded += obj.size
      continue
    }
    fs.mkdirSync(path.dirname(local), { recursive: true })
    await client.fGetObject(BUCKET, obj.key, local)
    downloaded++
    bytesDownloaded += obj.size
  }

  // Report by prefix only — never log full keys (they are opaque but still object identifiers).
  const byPrefix = KEY_PREFIXES.map((p) => `${p}=${objects.filter((o) => o.key.startsWith(p)).length}`).join('  ')
  console.log(`\nBucket objects: ${objects.length}  (${byPrefix})`)
  console.log(`${dryRun ? 'Would download' : 'Downloaded'}: ${downloaded}  (${(bytesDownloaded / 1024 / 1024).toFixed(2)} MB)   Skipped (unchanged): ${skipped}`)

  if (prune) {
    const keep = new Set(objects.map((o) => o.key))
    const orphans = prev ? Object.keys(prev.perKey).filter((k) => !keep.has(k)) : []
    if (orphans.length && !dryRun) {
      for (const k of orphans) fs.rmSync(localPathFor(outDir, k), { force: true })
    }
    console.log(`Prune: ${orphans.length} local object(s) no longer in bucket ${dryRun ? 'would be' : 'were'} removed.`)
  } else if (prev) {
    const kept = Object.keys(prev.perKey).filter((k) => !perKey[k]).length
    if (kept) console.log(`Retained ${kept} local object(s) no longer in the bucket (additive backup; pass --prune to remove).`)
  }

  if (!dryRun) {
    const manifest: Manifest = {
      finishedAt: new Date().toISOString(),
      bucket: BUCKET,
      sourceCount: objects.length,
      downloaded,
      skipped,
      bytesDownloaded,
      perKey,
    }
    fs.writeFileSync(path.join(outDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf-8')
  }

  if (verify) {
    const dbKeys = await collectDbReferencedKeys()
    const toCheck = verifyAll ? dbKeys : sample(dbKeys, 50)
    const missing = toCheck.filter((k) => !fs.existsSync(localPathFor(outDir, k)))
    console.log(
      `\nVerify: checked ${toCheck.length}/${dbKeys.length} DB-referenced key(s) resolve in the local backup.`,
    )
    if (missing.length) {
      console.error(`FAILED: ${missing.length} referenced key(s) are NOT present locally (first: ${missing[0].slice(0, 24)}…).`)
      process.exit(2)
    }
    console.log('OK: every checked key is present locally.')
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
