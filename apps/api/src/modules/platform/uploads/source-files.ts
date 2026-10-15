// Allowed source-document types for Module A and Module C uploads: PDF, Word,
// PowerPoint, Excel/CSV, and images (scans, charts, screenshots).
//
// A file is accepted only when its EXTENSION is on the allowlist AND its
// declared MIME type is a known one for that family. Browsers on Windows
// frequently send an empty or `application/octet-stream` type for Office
// files, so those two are tolerated when the extension is allowed. SVG is
// deliberately excluded: it can carry script.

const MIME_BY_EXT: Record<string, RegExp[]> = {
  pdf:  [/^application\/pdf$/],
  docx: [/^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/],
  doc:  [/^application\/msword$/],
  pptx: [/^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/],
  ppt:  [/^application\/vnd\.ms-powerpoint$/],
  xlsx: [/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/],
  xls:  [/^application\/vnd\.ms-excel$/],
  // Windows reports CSV as application/vnd.ms-excel when Excel is installed.
  csv:  [/^text\/csv$/, /^application\/csv$/, /^application\/vnd\.ms-excel$/],
  png:  [/^image\/png$/],
  jpg:  [/^image\/jpe?g$/],
  jpeg: [/^image\/jpe?g$/],
  gif:  [/^image\/gif$/],
  webp: [/^image\/webp$/],
  tif:  [/^image\/tiff?$/],
  tiff: [/^image\/tiff?$/],
  bmp:  [/^image\/(bmp|x-ms-bmp)$/],
}

const GENERIC_MIME = /^(application\/octet-stream|binary\/octet-stream)?$/

export const SUPPORTED_SOURCE_EXTENSIONS = Object.keys(MIME_BY_EXT)

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase()
}

export function isSupportedSourceFile(filename: string, mimetype: string): boolean {
  const allowed = MIME_BY_EXT[fileExtension(filename)]
  if (!allowed) return false
  const mime = (mimetype ?? '').toLowerCase().split(';')[0]!.trim()
  return GENERIC_MIME.test(mime) || allowed.some(r => r.test(mime))
}

export const SUPPORTED_SOURCE_LABEL = 'PDF, Word, PowerPoint, Excel/CSV or image (PNG, JPG, GIF, WebP, TIFF, BMP)'
