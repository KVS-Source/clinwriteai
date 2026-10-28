// Shrink an image buffer down to fit under a byte cap, so attachments
// that come off a phone camera (10-20MB) aren't dropped by the vision
// 5MB per-image cap.
//
// Strategy (increasingly aggressive):
//   1. If already ≤ maxBytes → return as-is (fast path, zero work)
//   2. Resize longest edge to 2048px, keep original format
//   3. If still over cap AND format is PNG/GIF/WebP → re-encode as JPEG q85
//   4. If still over cap → progressively drop JPEG quality (85 → 70 → 55)
//   5. Still over cap → return null (caller drops the file)
//
// Dimensions capped at 2048px because vision models downsample anything
// bigger server-side anyway; shipping more pixels is pure overhead.
//
// All work is best-effort — any sharp exception returns null so the
// caller sees "shrink failed" and falls back to the drop-with-note path.

import sharp from 'sharp'

const DEFAULT_MAX_LONG_EDGE = 2048
const JPEG_QUALITY_LADDER = [85, 70, 55]

export interface ShrunkImage {
  mediaType: string            // may differ from input if re-encoded to JPEG
  data: Buffer
  original: { bytes: number; mediaType: string }
  shrunk:   { bytes: number; mediaType: string; note: string }
}

export async function shrinkImage(
  original: { mediaType: string; data: Buffer },
  opts: { maxBytes: number; maxLongEdge?: number } = { maxBytes: 5 * 1024 * 1024 },
): Promise<ShrunkImage | null> {
  const { maxBytes } = opts
  const maxLongEdge = opts.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE
  const origType = original.mediaType.toLowerCase()
  const origSize = original.data.length

  // Fast path — already within cap and we don't need to resize.
  if (origSize <= maxBytes) {
    return {
      mediaType: original.mediaType,
      data: original.data,
      original: { bytes: origSize, mediaType: origType },
      shrunk:   { bytes: origSize, mediaType: origType, note: 'no resize needed' },
    }
  }

  try {
    // Step 1 — resize keeping original format.
    const resized = await sharp(original.data)
      .rotate() // honour EXIF orientation
      .resize({ width: maxLongEdge, height: maxLongEdge, fit: 'inside', withoutEnlargement: true })
      .toBuffer()

    if (resized.length <= maxBytes) {
      return {
        mediaType: original.mediaType,
        data: resized,
        original: { bytes: origSize, mediaType: origType },
        shrunk:   { bytes: resized.length, mediaType: origType, note: `resized to ≤${maxLongEdge}px long edge` },
      }
    }

    // Step 2 — re-encode as JPEG at descending quality.
    for (const quality of JPEG_QUALITY_LADDER) {
      const jpeg = await sharp(original.data)
        .rotate()
        .resize({ width: maxLongEdge, height: maxLongEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer()
      if (jpeg.length <= maxBytes) {
        return {
          mediaType: 'image/jpeg',
          data: jpeg,
          original: { bytes: origSize, mediaType: origType },
          shrunk:   { bytes: jpeg.length, mediaType: 'image/jpeg', note: `re-encoded as JPEG quality ${quality} + resized to ≤${maxLongEdge}px long edge` },
        }
      }
    }

    return null // Could not get it under the cap even at the floor quality.
  } catch {
    return null // Corrupt / unsupported — let the caller drop with a note.
  }
}
