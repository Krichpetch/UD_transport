// Server-side image compression transform (image-compression.ts). All fixtures are SYNTHETIC images
// generated in-test with sharp — never real inspection data, per the project's security rules.
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import { compressImage, MAX_LONG_EDGE_PX } from '../image-compression'

// A noisy synthetic photo. Random pixels (via native crypto.randomBytes — a JS per-byte loop over a
// multi-megapixel buffer is far too slow) so JPEG can't trivially collapse it to nothing, which keeps
// the "smaller bytes" assertion meaningful for an oversized input.
async function makeImage(width: number, height: number): Promise<Buffer> {
  const noise = randomBytes(width * height * 3)
  return sharp(noise, { raw: { width, height, channels: 3 } })
    .png() // PNG input keeps the source large/uncompressed, so the JPEG re-encode is a real reduction
    .toBuffer()
}

describe('compressImage (server-side transform)', () => {
  it('caps an oversized image to MAX_LONG_EDGE_PX on the long edge and re-encodes as JPEG', async () => {
    const input = await makeImage(2400, 1800)
    const result = await compressImage(input, 'image/png')

    expect(result.compressed).toBe(true)
    expect(result.mimetype).toBe('image/jpeg')

    const meta = await sharp(result.buffer).metadata()
    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(MAX_LONG_EDGE_PX)
    // Aspect ratio preserved (2400x1800 -> 1920x1440).
    expect(meta.width).toBe(1920)
    expect(meta.height).toBe(1440)
    // The whole point: an oversized source comes out meaningfully smaller.
    expect(result.buffer.length).toBeLessThan(input.length)
  }, 30000)

  it('never upscales an already-small image', async () => {
    const input = await makeImage(800, 600)
    const result = await compressImage(input, 'image/png')

    expect(result.compressed).toBe(true)
    const meta = await sharp(result.buffer).metadata()
    expect(meta.width).toBe(800)
    expect(meta.height).toBe(600)
  }, 30000)

  it('falls back to the original buffer/mimetype when the input is not a decodable image', async () => {
    const garbage = Buffer.from('this is not an image', 'utf-8')
    const result = await compressImage(garbage, 'image/jpeg')

    expect(result.compressed).toBe(false)
    expect(result.buffer).toBe(garbage) // untouched — never blocks the upload
    expect(result.mimetype).toBe('image/jpeg')
  })
})
