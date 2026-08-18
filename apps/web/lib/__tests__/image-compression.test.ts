/**
 * Part D (auditor self-unsubmit/summary session) — the pure, non-canvas parts of the client-side
 * evidence-photo compression pipeline. The actual JPEG encode/decode (createImageBitmap + canvas
 * toBlob) needs a real browser and isn't covered here — see the session's final report for what
 * that leaves unverified and how to check it live.
 */
import { describe, it, expect } from 'vitest'
import { computeCompressedDimensions, sanitizeFilename, MAX_LONG_EDGE_PX } from '../image-compression'

describe('computeCompressedDimensions', () => {
  it('caps the long edge to maxDim, preserving aspect ratio — landscape', () => {
    expect(computeCompressedDimensions(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 })
  })

  it('caps the long edge to maxDim, preserving aspect ratio — portrait', () => {
    expect(computeCompressedDimensions(3000, 4000, 1920)).toEqual({ width: 1440, height: 1920 })
  })

  it('never upscales an image already smaller than maxDim', () => {
    expect(computeCompressedDimensions(800, 600, 1920)).toEqual({ width: 800, height: 600 })
  })

  it('leaves an image exactly at maxDim on its long edge unchanged', () => {
    expect(computeCompressedDimensions(1920, 1080, 1920)).toEqual({ width: 1920, height: 1080 })
  })

  it('defaults to MAX_LONG_EDGE_PX (the spec\'s ~1600-2000px cap) when no maxDim is given', () => {
    const result = computeCompressedDimensions(6000, 4000)
    expect(Math.max(result.width, result.height)).toBe(MAX_LONG_EDGE_PX)
    expect(MAX_LONG_EDGE_PX).toBeGreaterThanOrEqual(1600)
    expect(MAX_LONG_EDGE_PX).toBeLessThanOrEqual(2000)
  })
})

describe('sanitizeFilename', () => {
  it('replaces spaces and parens but keeps Thai text, digits, and dots', () => {
    expect(sanitizeFilename('รูป ทางลาด (1).jpg')).toBe('รูป_ทางลาด__1_.jpg')
  })

  it('leaves an already-safe ASCII filename untouched', () => {
    expect(sanitizeFilename('photo-A1.1_2026-08-18.jpg')).toBe('photo-A1.1_2026-08-18.jpg')
  })
})
