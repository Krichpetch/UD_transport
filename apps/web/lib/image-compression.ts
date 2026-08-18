// Part D (auditor self-unsubmit/summary session) — client-side compression for auditor-uploaded
// evidence photos, before they ever reach MinIO. Canvas API only (createImageBitmap + canvas 2d),
// no image library: these are the two browser-native primitives, not a bespoke codec.
//
// Two things the PREVIOUS version of this (PhotoPicker.tsx's old compressImage) got wrong:
//   1. It decoded via `new Image()` + `drawImage`, which silently ignores EXIF orientation — a
//      photo taken in portrait on a phone whose sensor is physically landscape (the common case)
//      would come out sideways, since canvas never carries EXIF through toBlob either way.
//   2. It picked a FIXED quality (0.82) regardless of the resulting file size — no actual target,
//      just a guess that happened to usually land somewhere reasonable.
// Both are fixed here: createImageBitmap's `imageOrientation: 'from-image'` bakes the EXIF
// rotation into the DECODED PIXELS during decode (this is what "preserving orientation" actually
// means for a canvas pipeline — the output looks correct everywhere forever, with no tag for a
// downstream viewer to ignore), and quality steps down only as far as needed to land near the
// ~1-2MB target, never below a floor that would start destroying the measurement annotations
// these photos exist to show.

// Long-edge cap (spec: ~1600-2000px) — dimension is the PRIMARY compression lever, quality is
// secondary and bounded (see QUALITY_STEPS), matching "cap by dimension + tuned quality rather
// than crushing quality alone."
export const MAX_LONG_EDGE_PX = 1920
// Upper bound of the ~1-2MB target; the quality step-down loop stops once under this.
export const TARGET_MAX_BYTES = 2 * 1024 * 1024
// Already within/near the target — recompressing would only spend battery for no size benefit
// (and could needlessly cost quality), so these are left untouched.
export const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024
// Descending quality ladder tried in order; stops at the first that lands under TARGET_MAX_BYTES,
// or falls through to the last (floor) rung if even that isn't enough — always makes forward
// progress, never loops indefinitely. 0.55 is the floor: below this the tiny measurement numbers
// annotated on these photos start becoming unreadable, which defeats the point of the photo.
export const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.55] as const

// Pure — no canvas/DOM involved, so this is the one part of the pipeline actually unit-testable
// without a canvas polyfill. Scales width/height down to fit within maxDim on the LONG edge,
// preserving aspect ratio; never upscales (ratio is clamped to at most 1).
export function computeCompressedDimensions(
  width: number,
  height: number,
  maxDim: number = MAX_LONG_EDGE_PX,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width, height }
  const ratio = Math.min(1, maxDim / Math.max(width, height))
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) }
}

// Sanitizes a filename for safe use in HTTP headers / object keys — non-ASCII (besides Thai) and
// special characters become '_'. Extracted unchanged from the pre-existing compressImage.
export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.฀-๿-]/g, '_')
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

// New uploads only (per Part D.3) — never re-processes an already-stored photo; this is called
// exactly once, at the moment a file is picked, before it's handed to uploadPhoto().
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= SKIP_BELOW_BYTES) return file

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    try {
      const { width, height } = computeCompressedDimensions(bitmap.width, bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(bitmap, 0, 0, width, height)

      const safeName = sanitizeFilename(file.name)
      for (const quality of QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, quality)
        if (!blob) continue
        const isFloorStep = quality === QUALITY_STEPS[QUALITY_STEPS.length - 1]
        if (blob.size <= TARGET_MAX_BYTES || isFloorStep) {
          return new File([blob], safeName, { type: 'image/jpeg' })
        }
      }
      return file
    } finally {
      bitmap.close()
    }
  } catch {
    // Decode/compress failed for any reason (unsupported format, corrupt file, browser quirk) —
    // upload the original rather than block the auditor; the server's own size backstop
    // (UploadsController's 10MB Multer limit) still guards against anything truly oversized.
    return file
  }
}
