// File types accepted by the source-document upload screens (Module A and
// Module C). Keep in step with apps/api/src/modules/platform/uploads/source-files.ts,
// which is the authoritative server-side check.

export const SOURCE_FILE_EXTENSIONS = [
  'pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'csv',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff', 'bmp',
] as const

// <input accept="..."> — extensions work across browsers even when the OS
// reports an odd MIME type for Office files.
export const SOURCE_FILE_ACCEPT = SOURCE_FILE_EXTENSIONS.map(e => `.${e}`).join(',')

export const SOURCE_FILE_EXT_RE = new RegExp(`\.(${SOURCE_FILE_EXTENSIONS.join('|')})$`, 'i')

// Short label for the drop zone, long one for errors / helper text.
export const SOURCE_FILE_HINT = 'PDF, Word, PowerPoint, Excel/CSV, images'
export const SOURCE_FILE_ERROR = 'Unsupported file type. Upload a PDF, Word, PowerPoint, Excel/CSV or image (PNG, JPG, GIF, WebP, TIFF, BMP).'
