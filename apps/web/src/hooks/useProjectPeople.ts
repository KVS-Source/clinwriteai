import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { assignableUsersApi } from '../api/raci'

// Names of the people on a project, for showing who did what. Any signed-in user who can see the
// project may read this; the tenant user directory (GET /admin/users) is for admins only, so using it
// here refused everyone else on every page load. People since suspended are included, so their names
// still resolve. Not a list to pick from: pickers use assignableUsersApi, which leaves them out.
export function useProjectPeople(projectId: string | undefined) {
  const { data: people = [] } = useQuery({
    queryKey: ['project-people', projectId],
    queryFn:  () => assignableUsersApi.listPeople(projectId!),
    enabled:  !!projectId,
    staleTime: 60_000,
    retry: false,
  })
  const usersById = useMemo(() => new Map(people.map(p => [p.id, p])), [people])
  return { people, usersById }
}
