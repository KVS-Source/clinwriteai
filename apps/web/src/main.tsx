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
  // Prototype build serves data from MSW-intercepted JSON fixtures in both
  // dev and production. Flip this to `if (import.meta.env.DEV)` once a real
  // backend is available for production deployments.
  const { worker } = await import('./mocks/browser')
  const swUrl = `${import.meta.env.BASE_URL}mockServiceWorker.js`
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: swUrl },
  })
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
