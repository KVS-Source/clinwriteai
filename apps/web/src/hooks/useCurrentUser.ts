import { useQuery } from '@tanstack/react-query'
import { authApi } from '../api'

// The signed-in user as the API sees them (GET /auth/me). Use this wherever the
// screen says who is acting: the server records comments, signatures and audit
// entries against this identity, so the UI must show the same one.
export function useCurrentUser() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn:  () => authApi.me(),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}
