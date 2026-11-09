import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

// Is a real AI provider set up on the server? (GET /ai/status — yes/no only, open to every signed-in user.)
// Returns false ONLY when the server says AI is not configured; while loading, or if the check itself
// fails, it returns true so the prompt doesn't flash disabled. The server still refuses any AI call
// when AI isn't set up, so a wrong "true" here can't write anything to a document.
export function useAiConfigured(): boolean {
  const q = useQuery({
    queryKey: ['ai-status'],
    queryFn:  () => api.get<{ configured: boolean }>('/ai/status'),
    staleTime: 60_000,
    retry: 0,
  })
  return q.data?.configured !== false
}
