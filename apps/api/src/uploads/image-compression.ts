// Server-side compression for uploaded evidence photos — the defense-in-depth backstop behind the
// client-side Canvas compressor (apps/web/lib/image-compression.ts). The client already shrinks most
// uploads, but anything that bypasses/predates it, or slips under its 1.5MB skip threshold, would
// otherwise land in MinIO full-size. This guarantees every stored object is capped and re-encoded
// regardless of client, and the SAME transform is reused by the backfill script for existing objects.
//
// Mirrors the client compressor's two deliberate choices: cap by the LONG edge (dimension is the
// primary lever) and bake EXIF orientation into the pixels (sharp's .rotate() with no arg applies the
// EXIF Orientation tag, then output drops metadata by default — so the result looks correct
// everywhere with no tag for a downstream viewer to ignore). On any failure it returns the original
// buffer untouched rather than blocking the upload, same philosophy as the client's try/catch.
import sharp from 'sharp'

// Long-edge cap — matches the client compressor's MAX_LONG_EDGE_PX so server + client converge on the
// same output shape.
export const MAX_LONG_EDGE_PX = 1920
// JPEG quality for the re-encode; ~80 with mozjpeg keeps the small measurement annotations these
// photos exist to show readable while still shrinking hard.
export const JPEG_QUALITY = 80

// Idempotency marker written as object metadata on every server-compressed object. The MinIO client
// stores `X-Amz-Meta-Compressed: v1` and returns it back from statObject as `metaData.compressed`
// (prefix stripped, key lowercased) — the backfill reads that field to skip already-done objects.
export const COMPRESSED_HEADER = 'X-Amz-Meta-Compressed'
export const COMPRESSED_META_FIELD = 'compressed'
export const COMPRESSED_META_VALUE = 'v1'

export interface CompressResult {
  buffer: Buffer
  mimetype: string // always 'image/jpeg' after a successful transform; the original mimetype on fallback
  compressed: boolean // false = sharp failed and we're returning the input untouched
}

// Resize to fit within MAX_LONG_EDGE_PX on the long edge (never upscales), bake EXIF orientation, and
// re-encode as JPEG. Pure w.r.t. storage — no MinIO involvement — so it's unit-testable on a raw
// buffer and shared verbatim between the upload path and the backfill script.
export async function compressImage(input: Buffer, originalMimetype: string): Promise<CompressResult> {
  try {
    const buffer = await sharp(input)
      .rotate() // apply (then strip) EXIF orientation
      .resize(MAX_LONG_EDGE_PX, MAX_LONG_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer()
    return { buffer, mimetype: 'image/jpeg', compressed: true }
  } catch {
    // Corrupt/unsupported/odd file — store the original rather than fail the auditor's upload. The
    // controller's 10MB Multer limit still backstops anything truly oversized.
    return { buffer: input, mimetype: originalMimetype, compressed: false }
  }
}

// The metadata map handed to MinioService.upload when the transform succeeded. Kept here (not inlined
// at each call site) so the header name and marker value have one source of truth.
export function compressedMeta(): Record<string, string> {
  return { [COMPRESSED_HEADER]: COMPRESSED_META_VALUE }
}
