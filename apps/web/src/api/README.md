# API client layer

Thin fetch wrappers over the Fastify API, per-domain. Shape:

- `client.ts` — the generic `api.get/post/patch/put/delete` wrapper. Handles
  the session cookie (`credentials: 'include'`), auto-redirects on 401 to
  `/auth/login`, throws typed `ApiError` on 4xx/5xx.
- `error-handling.ts` — `describeApiError(err)` → `DescribedError`. Maps
  HTTP status + body shape to toast/inline/dialog with severity.
- per-domain files (`projects.ts`, `documents.ts`, `signatures.ts`, …) —
  one `*Api` object per domain, each method returns `Promise<T>`.

## Adding a new per-domain wrapper

Pattern (keeps call sites consistent):

```ts
import { api } from './client'

export interface Foo { ... }

export const fooApi = {
  list: (projectId: string) =>
    api.get<Foo[]>(`/projects/${projectId}/foos`),
  create: (projectId: string, body: Partial<Foo>) =>
    api.post<Foo>(`/projects/${projectId}/foos`, body),
}
```

Then re-export from `index.ts` so consumers import from `../api`.

## Type parity (`openapi-typescript`)

The hand-written interfaces in each per-domain file are a stop-gap. For
long-term type parity against the Fastify API, regenerate types from the
live `/docs/json` OpenAPI spec:

```bash
# Dev — API running on localhost:3001 with FEATURE_OPENAPI_DOCS=true
cd apps/web
API_SPEC_URL=http://127.0.0.1:3001/docs/json npm run generate:api-types

# Demo env
API_SPEC_URL=https://api.clinwrite.ai/docs/json npm run generate:api-types
```

The output lands at `src/api/openapi-types.ts`. Per-domain wrappers can then
import `components['schemas']['Project']` etc. for exact-shape typing.

The Fastify API publishes OpenAPI via `@fastify/swagger` in server.ts; routes
without explicit `schema:` definitions produce minimal entries. As each
module stabilises, add Zod schemas → Fastify schema definitions → the
generated types get richer. **Current coverage: partial.** A route-by-route
schema fill pass is a BACKLOG.md follow-up.
