import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

async function prepare() {
  const { anyMocksEnabled, createWorker, activeMockGroups } = await import('./mocks/browser')

  // Fully disabled → skip MSW entirely so the browser doesn't register a
  // service worker that would then intercept nothing (and briefly flash a
  // "mocked" badge during cutover).
  if (!anyMocksEnabled()) {
    console.info('[cutover] MSW disabled — all requests hit the real API')
    return
  }

  const worker = createWorker()
  const swUrl = `${import.meta.env.BASE_URL}mockServiceWorker.js`
  await worker.start({
    onUnhandledRequest: 'bypass',   // critical: lets non-mocked routes reach the real API
    serviceWorker: { url: swUrl },
  })
  console.info('[cutover] MSW active groups:', activeMockGroups().join(', '))
}

prepare().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>
  )
})
