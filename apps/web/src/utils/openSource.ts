// Source-file helpers for the detail panels. Viewing (PDF / image) happens inside the panel via
// SourceViewer; formats that can't be rendered safely are downloaded instead.

import { documentsApi } from '../api/documents'
import { ApiError } from '../api/client'

export async function downloadSourceFile(projectId: string, source: { id: string; fileName: string }): Promise<void> {
  const { blob, filename } = await documentsApi.downloadSource(projectId, source.id)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? source.fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function sourceErrorMessage(e: unknown, fileName: string): string {
  const body = e instanceof ApiError ? (e.body as { error?: string; message?: string } | null) : null
  if (body?.error === 'file_missing') return `"${fileName}" is listed but its file is not in storage.`
  if (body?.error === 'storage_unavailable') return body.message ?? 'The file storage could not be reached. Please try again shortly.'
  if (body?.error === 'quarantined') return body.message ?? `"${fileName}" failed the virus scan and cannot be opened.`
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return 'You do not have permission to open this file.'
  return `Could not open "${fileName}". Please try again.`
}
