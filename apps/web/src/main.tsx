import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'
import { CutoverBadge } from './components/CutoverBadge'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

// React Query devtools — dev always; staging opt-in via VITE_SHOW_RQ_DEVTOOLS.
// Lazy-loaded so prod bundles don't ship it unless explicitly enabled.
const showDevtools =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_RQ_DEVTOOLS === 'on'

const RqDevtools = showDevtools
  ? React.lazy(() =>
      import('@tanstack/react-query-devtools').then(m => ({ default: m.ReactQueryDevtools })),
    )
  : null

async function prepare() {
  const { anyMocksEnabled, createWorker, activeMockGroups } = await import('./mocks/browser')

  if (!anyMocksEnabled()) {
    console.info('[cutover] MSW disabled — all requests hit the real API')
    return
  }

  const worker = createWorker()
  const swUrl = `${import.meta.env.BASE_URL}mockServiceWorker.js`
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: swUrl },
  })
  console.info('[cutover] MSW active groups:', activeMockGroups().join(', '))
}

prepare().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <CutoverBadge />
        {RqDevtools && (
          <React.Suspense fallback={null}>
            <RqDevtools initialIsOpen={false} buttonPosition="bottom-left" />
          </React.Suspense>
        )}
      </QueryClientProvider>
    </React.StrictMode>
  )
})
