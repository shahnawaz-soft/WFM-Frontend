# CLAUDE.md

Steelo frontend: structural drawing review, ABM and wireframe. The backend is a separate
Django repo (`WFM-Backend`); see `README.md` for setup.

## Stack

- React 19 + TypeScript (strict) single-page app, bundled with **Vite**. Not Next.js: there are no
  server components, no `'use client'`, no `next/*` APIs.
- Routing: **React Router 7** (`createBrowserRouter`, `src/app/router.tsx`).
- Server state: **TanStack Query v5** over an **axios** `apiClient` (`src/api/client.ts`).
- Heavy libraries: `three` + `@react-three/fiber` (wireframe 3D), `pdfjs-dist` (drawing viewer).
- Tests: **Vitest** + Testing Library + **MSW** (jsdom). Lint: **oxlint**. Package manager: **npm**.
- Node ≥ 20.19.

## Commands

| Task | Command |
|---|---|
| Dev server (proxies `/api`, `/health` to Django on :8000) | `npm run dev` |
| Tests | `npm test` (watch: `npm run test:watch`, coverage: `npm run test:coverage`) |
| Lint | `npm run lint` (oxlint) |
| Typecheck | `npm run typecheck` |
| Production build | `npm run build` |
| Regenerate API types | `npm run api:types` (`API_SCHEMA=<url or file>` to override) |

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test:coverage → build on Node 20.

## Skills usage

- For **any** work on React components, routes, data fetching, bundle size or rendering,
  apply the `vercel-react-best-practices` skill (`.claude/skills/`) and follow its priority order:
  **waterfalls first, then bundle size**, then re-renders and rendering. Skip its Next.js/RSC/server
  rules (`server-*`, `next/dynamic`, hydration). Here the equivalents are `lazy` routes,
  `React.lazy` / dynamic `import()`, and TanStack Query (in place of SWR).
- **Managing skills** (`npx skills …`): the project is on Node 20, so pin `skills@1.5.18`
  (later releases need Node ≥ 22), and always run the CLI with telemetry off:
  `DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 npx skills@1.5.18 update -p`. Installed skills are tracked
  in `skills-lock.json`.
- **Workflow for new features and bug fixes:**
  1. Plan before coding: state the approach and the files you'll touch.
  2. Write or update tests first: a failing test that captures the feature or reproduces the bug.
  3. Implement in small, reviewable changes.
  4. Before reporting done, run `npm run typecheck`, `npm run lint` and `npm test`, and fix
     every failure. Never report done with failing checks; if something can't be fixed, say so.

## Conventions

### TypeScript
- `strict`, `noUncheckedIndexedAccess`, `noUnused*`, `verbatimModuleSyntax`, `erasableSyntaxOnly`.
  So: `import type` for types, no `enum`s or parameter properties, and handle `undefined` from
  indexed access.
- **No `any`** (the codebase has none outside generated code). Use `unknown` and narrow.

### API & types
- `src/api/schema.d.ts` is **generated** from the Django OpenAPI schema. **Never hand-edit it.**
  When backend endpoints change, regenerate it with `npm run api:types`. Never use `any` or casts
  to paper over a schema mismatch; fix the backend schema or regenerate.
- Use the friendly aliases in `src/api/types.ts`; add new aliases there.
- One endpoint module per resource in `src/api/<resource>.ts`: plain `async` functions over
  `apiClient`. Every failure becomes an `ApiError` (`src/api/errors.ts`).

### Data fetching
- All server state goes through TanStack Query. Global error policy lives in `src/app/queryClient.ts`:
  first-load failures render `<ErrorState>` inline, while background-refresh and mutation failures toast
  (opt out with `meta: { suppressErrorToast: true }` when a form shows errors inline).
- Every data view handles loading, empty, error and success states.
- Keep `invalidateQueries` scoped to the keys a mutation actually affects.

### Bundle
- New heavy routes and libraries **must be lazy-loaded**, following the `lazy:` pattern in
  `src/app/router.tsx` (or `React.lazy` for heavy components, as with `Wireframe3D`).
  `three`/`@react-three/*` and `pdfjs-dist` must never be imported from main-chunk code.

### Layout & naming
```
src/
  app/          App providers, router, AppShell, query client
  auth/         AuthProvider/useAuth, token store, route guards
  api/          apiClient, ApiError, endpoint modules, generated schema + aliases
  features/<f>/ feature modules: components, hooks, helpers and tests together
  components/   ui/ (design-system primitives), feedback/ (toasts, states, error boundary)
  pages/        top-level route components (login, home, errors)
  lib/          small shared utilities
  styles/       tokens.css, global.css, neumorphism.css
  test/         setup, MSW server and mock backends, render helpers
```
- Components: `PascalCase.tsx` with **named exports** (default export only for `React.lazy`
  targets). Hooks: `useThing.ts`. Helpers: `camelCase.ts`.
- Tests sit next to the code as `*.test.ts(x)`.

### UI & accessibility
- Statuses always render with `<StatusBadge>` (icon + text + colour), never colour alone.
- Notifications via `notify.success/error/info(title, description?)`.
- Target WCAG 2.2 AA: visible focus, labelled controls, landmarks, reduced-motion support.
- Gate UI with `useAuth().can('<capability>')`; the API enforces permissions independently.

### Tests
- Vitest + Testing Library + MSW. MSW runs with `onUnhandledRequest: 'error'`, so **every new
  API call needs an MSW handler**: add it to the matching mock backend in `src/test/`
  (`mockBackend.ts`, `mockProjects.ts`, `mockDrawings.ts`), and override per test with `server.use(...)`.
- Render through the helpers in `src/test/renderApp.tsx`.
