// Read-only PDF viewer for Master Library documents: the in-app View and the page behind a share link.
//
// The pages are drawn onto canvases with PDF.js inside our own page, so the browser's PDF viewer never opens and
// no browser (Safari included, which ignores "#toolbar=0") shows its download / print buttons. Right-click,
// Ctrl/Cmd+S, Ctrl/Cmd+P and printing the page are blocked while the viewer is open.
//
// This is a deterrent, not DRM: the file still reaches the browser, and nothing stops a screenshot. What makes a
// leaked copy traceable is the watermark the API stamps on every page (apps/api/.../library/watermark.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

// Loaded on first use, so PDF.js isn't in the bundle of every page. The legacy build also runs on older Safari.
// The worker goes through Vite's "?worker", which emits it as a same-origin .js file (CSP script-src 'self';
// no .mjs, which older nginx MIME tables serve with the wrong type).
let pdfjsPromise: Promise<Pdfjs> | null = null
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerPort = new worker.default()
    return lib
  }).catch(err => { pdfjsPromise = null; throw err })
  return pdfjsPromise
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const
const GAP = 16           // px between pages
const PAD = 16           // px around the pages

interface Size { width: number; height: number }

export function ProtectedPdfViewer({ file, title }: { file: Blob; title: string }) {
  const { t } = useTranslation()
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<Size[]>([])
  const [failed, setFailed] = useState(false)
  const [zoomIdx, setZoomIdx] = useState<number>(2)       // 100% = fit to width
  const [width, setWidth] = useState(0)
  const [current, setCurrent] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)

  // Open the file and read every page's size, so the scroll height is right before any page is drawn.
  useEffect(() => {
    let cancelled = false
    let opened: PDFDocumentProxy | null = null
    setDoc(null); setSizes([]); setFailed(false); setCurrent(1)
    ;(async () => {
      const pdfjs = await loadPdfjs()
      const data = new Uint8Array(await file.arrayBuffer())
      opened = await pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false }).promise
      const all: Size[] = []
      for (let i = 1; i <= opened.numPages; i++) {
        const vp = (await opened.getPage(i)).getViewport({ scale: 1 })
        all.push({ width: vp.width, height: vp.height })
      }
      if (cancelled) return
      setSizes(all); setDoc(opened)
    })().catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true; void opened?.destroy() }
  }, [file])

  // Track the available width, for "fit to width".
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(entries => setWidth(entries[0]!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // While open: no save, no print shortcut, and a printed page comes out blank.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['s', 'p'].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    const style = document.createElement('style')
    style.setAttribute('data-protected-pdf-print', '')
    style.textContent = '@media print { html, body { display: none !important; } }'
    document.head.appendChild(style)
    return () => { window.removeEventListener('keydown', onKey, { capture: true }); style.remove() }
  }, [])

  const widest = useMemo(() => sizes.reduce((m, s) => Math.max(m, s.width), 0), [sizes])
  const fit = widest && width ? Math.max(0.2, (width - PAD * 2) / widest) : 1
  const scale = fit * ZOOMS[zoomIdx]!

  // Page tops at this scale, for the "page x of n" readout.
  const tops = useMemo(() => {
    let y = PAD
    return sizes.map(s => { const top = y; y += s.height * scale + GAP; return top })
  }, [sizes, scale])
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el || tops.length === 0) return
    const mid = el.scrollTop + el.clientHeight / 3
    let page = 1
    for (let i = 0; i < tops.length; i++) if (tops[i]! <= mid) page = i + 1
    setCurrent(page)
  }, [tops])

  const block = (e: React.SyntheticEvent) => e.preventDefault()

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100" data-protected-pdf>
      <div className="flex flex-none items-center justify-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-700">
        <span className="min-w-[90px] text-center tabular-nums" data-pdf-page>
          {sizes.length ? t('component.pdf_viewer.page_of', { page: current, total: sizes.length }) : ''}
        </span>
        <span className="h-4 w-px bg-slate-200" />
        <button type="button" onClick={() => setZoomIdx(i => Math.max(0, i - 1))} disabled={zoomIdx === 0}
          aria-label={t('component.pdf_viewer.zoom_out')} title={t('component.pdf_viewer.zoom_out')} data-action="pdf-zoom-out"
          className="h-7 w-7 rounded-md border border-slate-200 text-[15px] leading-none hover:bg-slate-50 disabled:opacity-40">−</button>
        <button type="button" onClick={() => setZoomIdx(2)} title={t('component.pdf_viewer.fit_width')} data-pdf-zoom
          className="h-7 min-w-[56px] rounded-md px-2 tabular-nums hover:bg-slate-50">{Math.round(ZOOMS[zoomIdx]! * 100)}%</button>
        <button type="button" onClick={() => setZoomIdx(i => Math.min(ZOOMS.length - 1, i + 1))} disabled={zoomIdx === ZOOMS.length - 1}
          aria-label={t('component.pdf_viewer.zoom_in')} title={t('component.pdf_viewer.zoom_in')} data-action="pdf-zoom-in"
          className="h-7 w-7 rounded-md border border-slate-200 text-[15px] leading-none hover:bg-slate-50 disabled:opacity-40">+</button>
      </div>

      <div ref={scroller} onScroll={onScroll} onContextMenu={block} onDragStart={block} onCopy={block}
        className="min-h-0 flex-1 select-none overflow-auto" role="document" aria-label={title} data-pdf-scroller>
        {failed ? (
          <p role="alert" className="p-4 text-[12px] text-red-700" data-pdf-state="error">{t('component.pdf_viewer.failed')}</p>
        ) : !doc ? (
          <p className="p-4 text-[12px] text-slate-500" data-pdf-state="loading">{t('component.pdf_viewer.loading')}</p>
        ) : (
          <div className="mx-auto flex w-max min-w-full flex-col items-center" style={{ padding: PAD, gap: GAP }}>
            {sizes.map((s, i) => (
              <PdfPage key={i} doc={doc} pageNumber={i + 1} width={s.width * scale} height={s.height * scale} scale={scale} root={scroller} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// One page: drawn when it comes near the screen, redrawn when the zoom changes.
function PdfPage({ doc, pageNumber, width, height, scale, root }: {
  doc: PDFDocumentProxy; pageNumber: number; width: number; height: number; scale: number
  root: React.RefObject<HTMLDivElement | null>
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e!.isIntersecting) setNear(true) }, { root: root.current, rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!near || !canvas.current) return
    let task: RenderTask | null = null
    let cancelled = false
    ;(async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled || !canvas.current) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: scale * dpr })
      const c = canvas.current
      c.width = Math.floor(viewport.width)
      c.height = Math.floor(viewport.height)
      task = page.render({ canvas: c, viewport })
      await task.promise
    })().catch(() => { /* cancelled by a zoom change or unmount */ })
    return () => { cancelled = true; task?.cancel() }
  }, [near, doc, pageNumber, scale])

  return (
    <div ref={box} className="flex-none bg-white shadow-sm" style={{ width, height }} data-pdf-page-box={pageNumber}>
      <canvas ref={canvas} style={{ width, height, display: 'block' }} />
    </div>
  )
}
