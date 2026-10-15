import { describe, expect, it } from 'vitest'
import { fileExtension, isSupportedSourceFile } from './source-files.js'

describe('isSupportedSourceFile', () => {
  it.each([
    ['report.pdf', 'application/pdf'],
    ['protocol.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['old.doc', 'application/msword'],
    ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['deck.ppt', 'application/vnd.ms-powerpoint'],
    ['data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['data.xls', 'application/vnd.ms-excel'],
    ['listing.csv', 'text/csv'],
    ['listing.csv', 'application/vnd.ms-excel'],           // Windows + Excel installed
    ['scan.png', 'image/png'],
    ['photo.JPG', 'image/jpeg'],
    ['photo.jpeg', 'image/jpg'],
    ['figure.webp', 'image/webp'],
    ['fax.tif', 'image/tiff'],
  ])('accepts %s (%s)', (name, mime) => {
    expect(isSupportedSourceFile(name, mime)).toBe(true)
  })

  it('tolerates a generic or missing MIME type when the extension is allowed', () => {
    expect(isSupportedSourceFile('data.xlsx', 'application/octet-stream')).toBe(true)
    expect(isSupportedSourceFile('data.xlsx', '')).toBe(true)
  })

  it('ignores MIME parameters such as charset', () => {
    expect(isSupportedSourceFile('listing.csv', 'text/csv; charset=utf-8')).toBe(true)
  })

  it.each([
    ['malware.exe', 'application/octet-stream'],
    ['page.html', 'text/html'],
    ['logo.svg', 'image/svg+xml'],          // can carry script
    ['archive.zip', 'application/zip'],
    ['noextension', 'application/pdf'],
  ])('rejects %s (%s)', (name, mime) => {
    expect(isSupportedSourceFile(name, mime)).toBe(false)
  })

  it('rejects a disguised file: allowed extension but a conflicting real MIME type', () => {
    expect(isSupportedSourceFile('invoice.pdf', 'text/html')).toBe(false)
    expect(isSupportedSourceFile('data.xlsx', 'image/png')).toBe(false)
  })

  it('reads the extension case-insensitively and from the last dot', () => {
    expect(fileExtension('a.b.PDF')).toBe('pdf')
    expect(fileExtension('none')).toBe('')
  })
})
