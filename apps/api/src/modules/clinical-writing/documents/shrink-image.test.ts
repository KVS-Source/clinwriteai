import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { shrinkImage } from './shrink-image.js'

// Generate a solid-colour PNG of the given dimensions. Noise-free so the
// test is deterministic; large dimensions keep it over the test cap.
async function makePng(width: number, height: number, rgb: [number, number, number] = [255, 0, 0]): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: rgb[0], g: rgb[1], b: rgb[2] },
    },
  }).png().toBuffer()
}

// Add noise so compression actually matters (solid-colour PNGs compress
// to a few bytes regardless of dimensions, breaking the "over cap" assumption).
async function makeNoisyJpeg(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3)
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(Math.random() * 256)
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
}

describe('shrinkImage', () => {
  it('fast path — returns original when already under the cap', async () => {
    const small = await makePng(100, 100)
    const r = await shrinkImage({ mediaType: 'image/png', data: small }, { maxBytes: 5 * 1024 * 1024 })
    expect(r).not.toBeNull()
    expect(r!.data).toBe(small)                 // reference equality — no re-encode
    expect(r!.shrunk.note).toContain('no resize needed')
    expect(r!.mediaType).toBe('image/png')
  })

  it('resizes an oversized noisy image to under the cap', async () => {
    const big = await makeNoisyJpeg(3000, 3000)
    expect(big.length).toBeGreaterThan(500_000)
    // Cap aggressively so the test genuinely has to shrink.
    const r = await shrinkImage({ mediaType: 'image/jpeg', data: big }, { maxBytes: 300_000, maxLongEdge: 1024 })
    expect(r).not.toBeNull()
    expect(r!.data.length).toBeLessThanOrEqual(300_000)
    expect(r!.shrunk.note.toLowerCase()).toContain('≤1024px')
  })

  it('re-encodes PNG to JPEG when PNG resize alone is not enough', async () => {
    // Noisy image saved as PNG is huge; cap tightly so JPEG fallback triggers.
    const noisyPx = Buffer.alloc(2000 * 2000 * 3)
    for (let i = 0; i < noisyPx.length; i++) noisyPx[i] = Math.floor(Math.random() * 256)
    const bigPng = await sharp(noisyPx, { raw: { width: 2000, height: 2000, channels: 3 } }).png().toBuffer()
    const r = await shrinkImage({ mediaType: 'image/png', data: bigPng }, { maxBytes: 200_000, maxLongEdge: 1024 })
    expect(r).not.toBeNull()
    expect(r!.data.length).toBeLessThanOrEqual(200_000)
    expect(r!.mediaType).toBe('image/jpeg')
    expect(r!.shrunk.note.toLowerCase()).toContain('jpeg')
  })

  it('returns null when the file is not a decodable image (over cap)', async () => {
    // Fast path skips sharp when the file is already under the cap —
    // the only way to trigger sharp's decode (and the null fallback)
    // is to force a buffer that's over the cap. Make a big junk buffer.
    const notAnImage = Buffer.alloc(10 * 1024)
    for (let i = 0; i < notAnImage.length; i++) notAnImage[i] = i & 0xff
    const r = await shrinkImage({ mediaType: 'image/png', data: notAnImage }, { maxBytes: 1024 })
    expect(r).toBeNull()
  })

  it('carries original + shrunk size metadata', async () => {
    const big = await makeNoisyJpeg(2000, 2000)
    const r = await shrinkImage({ mediaType: 'image/jpeg', data: big }, { maxBytes: 400_000, maxLongEdge: 1200 })
    expect(r).not.toBeNull()
    expect(r!.original.bytes).toBe(big.length)
    expect(r!.shrunk.bytes).toBeLessThanOrEqual(400_000)
    expect(r!.original.mediaType).toBe('image/jpeg')
  })
})
