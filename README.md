# Steelo — Frontend

React 19 + TypeScript + Vite single-page app for Steelo. The backend is a separate repo
(`WFM-Backend`, Django). Architecture and decisions are documented there under
`docs/architecture/`.

## Local development

Requirements: Node ≥ 20.19. The local backend runs on `http://localhost:8000` by default.

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:5173 — /api and /health are proxied to Django
```

Choose the backend in your git-ignored `.env.local` file: leave `VITE_API_BASE_URL=` empty
to use the local Vite proxy, or set it to `https://steelo-api.staging.steel.study` for staging.
Restart `npm run dev` after changing the value. For a different local Django port, set
`VITE_DEV_API_PROXY=http://localhost:<port>` in `.env.local` and restart the dev server.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | dev server with API proxy |
| `npm test` | unit/component tests (Vitest + Testing Library + MSW) |
| `npm run test:coverage` | tests with coverage |
| `npm run lint` | oxlint |
| `npm run typecheck` | TypeScript (strict) |
| `npm run build` | production build to `dist/` |
| `npm run api:types` | regenerate `src/api/schema.d.ts` from the backend OpenAPI schema (`API_SCHEMA=<url or file>`) |

## Structure

```
src/
  app/          App (providers), router, AppShell, UserMenu, query client + global error policy
  auth/         AuthProvider/useAuth, token store, RequireAuth / RequireCapability guards
  features/     feature modules (users/ …)
  api/          axios client, ApiError normalisation, endpoint modules
  components/
    ui/         Button, StatusBadge, StatusIcon — design-system primitives
    feedback/   Toaster + notify(), Loading/Error/Empty states, ErrorBoundary, activity bar
  pages/        route components
  styles/       tokens.css (colours, spacing; light + dark), global.css
  test/         test setup, MSW server, render helpers
```

## Conventions

- **Auth:** access token in memory only (`auth/tokenStore.ts`); refresh token is an httpOnly
  cookie the app never sees. `apiClient` renews on 401 once (shared across concurrent calls)
  and signs the user out with a message if renewal fails. Use `useAuth().can('users.manage')`
  to show/hide UI; the API enforces permissions independently.
- **API types** come from the backend schema (`src/api/schema.d.ts`, generated — never edit);
  use the aliases in `src/api/types.ts`.

- **API calls** go through `apiClient`; every failure becomes an `ApiError`
  (`status`, `code`, `message`, `details`, `requestId`) matching the backend envelope.
- **Server state** uses TanStack Query. First-load failures render `<ErrorState>` inline;
  background-refresh and mutation failures raise a notification automatically (opt out
  with `meta: { suppressErrorToast: true }` when a form shows errors inline).
- **Notifications:** `notify.success/error/info(title, description?)` from anywhere.
- **Status is never colour-only:** always render statuses with `<StatusBadge>`
  (icon + text + colour).
- **Every data view** handles loading, empty, error and success states.
- **Accessibility target:** WCAG 2.2 AA — visible focus, labelled controls, skip link,
  landmarks, reduced-motion support.

## Deployment

DigitalOcean App Platform static site — spec in `.do/app.staging.yaml`.
`VITE_API_BASE_URL` is inlined at build time, so each deployment uses its configured API URL.
