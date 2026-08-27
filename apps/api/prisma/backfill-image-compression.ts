/**
 * Recompress existing evidence photos in MinIO in place — the backfill counterpart to the server-side
 * compression added to UploadsController (src/uploads/image-compression.ts). Photos uploaded before
 * compression existed (or via any client that skipped it) are still full-size in the bucket; this
 * shrinks them using the SAME transform (resize to 1920 long-edge, JPEG q80, EXIF baked).
 *
 * WHY IT'S SAFE TO OVERWRITE IN PLACE
 * ----------------------------------
 * A ChecklistPhoto is referenced only by its MinIO key (stored inside Checklist.items JSON, see
 * packages/types ChecklistPhoto.id). Recompressing to the SAME key leaves every reference valid, so
 * this script touches ZERO database rows. Before overwriting, each original is copied to a parallel
 * `checklist-photos-original/` prefix so it stays recoverable until you verify and delete the backups.
 *
 * IDEMPOTENT + RESUMABLE
 * ----------------------
 * Every object this script (or the live upload path) writes carries an `X-Amz-Meta-Compressed: v1`
 * marker. Objects already marked, or already under --min-bytes, are skipped — so a re-run is cheap and
 * a crashed run resumes cleanly. The backup copy is also skipped if it already exists.
 *
 * NOTE: this file lives under prisma/, outside apps/api's tsconfig `rootDir: "./src"`, so it cannot
 * import src/uploads/image-compression.ts. The transform below is a deliberate copy of that module's
 * pipeline (same codebase pattern as restore-template-approvals.ts et al.); keep the two in sync.
 *
 * Dry-run by default (downloads + transforms to report REAL projected sizes, but writes nothing):
 *   ts-node prisma/backfill-image-compression.ts
 * Apply:
 *   ts-node prisma/backfill-image-compression.ts --confirm
 * Options: --prefix=checklist-photos/  --min-bytes=512000  --limit=N (process at most N candidates)
 */
import 'dotenv/config'
import * as Minio from 'minio'
import sharp from 'sharp'
import { Readable } from 'stream'

// --- transform (mirror of src/uploads/image-compression.ts — keep in sync) -----------------------
const MAX_LONG_EDGE_PX = 1920
const JPEG_QUALITY = 80
const COMPRESSED_HEADER = 'X-Amz-Meta-Compressed'
const COMPRESSED_META_FIELD = 'compressed' // key as MinIO returns it from statObject (prefix stripped, lowercased)
const COMPRESSED_META_VALUE = 'v1'

async function compress(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(MAX_LONG_EDGE_PX, MAX_LONG_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
}

// --- args ----------------------------------------------------------------------------------------
interface Args {
  confirm: boolean
  prefix: string
  minBytes: number
  limit: number
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=')
  return {
    confirm: argv.includes('--confirm'),
    prefix: get('prefix') ?? 'checklist-photos/',
    minBytes: Number(get('min-bytes') ?? 512 * 1024),
    limit: Number(get('limit') ?? Infinity),
  }
}

// --- minio ---------------------------------------------------------------------------------------
// Same internal-client config MinioService.onModuleInit builds (src/minio/minio.service.ts).
const bucket = process.env.MINIO_BUCKET ?? 'ud-transport'
const client = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
})

function backupKey(key: string): string {
  // checklist-photos/<name> -> checklist-photos-original/<name>. The '-original' infix means the
  // backup prefix is NOT itself matched by the default '--prefix=checklist-photos/' scan, so backups
  // are never re-processed.
  return key.replace(/^checklist-photos\//, 'checklist-photos-original/')
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

async function listKeys(prefix: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const keys: string[] = []
    const stream = client.listObjectsV2(bucket, prefix, true)
    stream.on('data', (obj) => {
      if (obj.name) keys.push(obj.name)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(keys))
  })
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await client.statObject(bucket, key)
    return true
  } catch {
    return false
  }
}

const fmt = (n: number): string => `${(n / 1024).toFixed(0)}KB`

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  console.log(`TARGET -> ${(process.env.MINIO_ENDPOINT ?? 'localhost')}:${process.env.MINIO_PORT ?? 9000} bucket=${bucket}`)
  console.log(args.confirm ? 'MODE   -> WRITE (--confirm given)' : 'MODE   -> DRY RUN (no writes; downloads to project sizes; pass --confirm to apply)')
  console.log(`SCAN   -> prefix="${args.prefix}", skip < ${fmt(args.minBytes)}, limit=${args.limit === Infinity ? 'none' : args.limit}\n`)

  const keys = await listKeys(args.prefix)
  console.log(`Found ${keys.length} object(s) under "${args.prefix}".\n`)

  let scanned = 0
  let skippedMarked = 0
  let skippedSmall = 0
  let recompressed = 0
  let errors = 0
  let bytesBefore = 0
  let bytesAfter = 0
  let processed = 0

  for (const key of keys) {
    if (processed >= args.limit) break
    scanned++

    let stat: Minio.BucketItemStat
    try {
      stat = await client.statObject(bucket, key)
    } catch (e) {
      console.log(`  ${key.padEnd(48)} | ERROR stat: ${(e as Error).message}`)
      errors++
      continue
    }

    if (stat.metaData?.[COMPRESSED_META_FIELD] === COMPRESSED_META_VALUE) {
      skippedMarked++
      continue
    }
    if (stat.size <= args.minBytes) {
      skippedSmall++
      continue
    }

    processed++
    try {
      const original = await streamToBuffer(await client.getObject(bucket, key))
      const out = await compress(original)
      bytesBefore += original.length
      bytesAfter += out.length
      console.log(`  ${key.padEnd(48)} | ${fmt(original.length)} -> ${fmt(out.length)}${args.confirm ? '' : '  (dry run)'}`)

      if (!args.confirm) continue

      // 1. Back up the original first (skip if a backup already exists — resumable). Reuses the buffer
      //    we already downloaded rather than a server-side copyObject.
      const bkey = backupKey(key)
      if (!(await objectExists(bkey))) {
        await client.putObject(bucket, bkey, original, original.length, {
          'Content-Type': (stat.metaData?.['content-type'] as string) ?? 'application/octet-stream',
        })
      }
      // 2. Overwrite the live key in place (same key -> every DB reference stays valid), now JPEG +
      //    marked so a future run skips it.
      await client.putObject(bucket, key, out, out.length, {
        'Content-Type': 'image/jpeg',
        [COMPRESSED_HEADER]: COMPRESSED_META_VALUE,
      })
      recompressed++
    } catch (e) {
      console.log(`  ${key.padEnd(48)} | ERROR: ${(e as Error).message}`)
      errors++
    }
  }

  const saved = bytesBefore - bytesAfter
  console.log(`\nScanned ${scanned} | skipped ${skippedMarked} already-compressed, ${skippedSmall} under ${fmt(args.minBytes)}`)
  console.log(`${args.confirm ? 'Recompressed' : 'Would recompress'} ${processed} object(s)${errors ? `, ${errors} error(s)` : ''}.`)
  if (bytesBefore > 0) {
    console.log(`Bytes: ${fmt(bytesBefore)} -> ${fmt(bytesAfter)} (saved ${fmt(saved)}, ${((saved / bytesBefore) * 100).toFixed(0)}%).`)
  }
  if (!args.confirm && processed > 0) console.log('\nRe-run with --confirm to apply (originals are backed up to checklist-photos-original/ first).')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
