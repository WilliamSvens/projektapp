# projektapp-field — Phase 0 PWA

Offline-first field app for apartment network installs. Vanilla TypeScript + Vite + Dexie
(IndexedDB) in the browser, Supabase (Postgres + Storage + Google Auth) as the server.

Phase 0 proves exactly one thing: **a technician in a basement with no signal can tap through
an entire job, and every tap reaches the server when the phone comes back**. Everything else
(export, measurements UI, step sheets, pause/close flows) is scheduled but not built here.

Spec: `../docs/SPEC-V1.md` (§3 = sync contract, §13 = budget). Provisioning: `../docs/SETUP.md`.

---

## 1. Run it

Node 20 LTS or newer and `pnpm` (`corepack enable`).

```powershell
cd pwa
pnpm install
Copy-Item .env.example .env.local     # then fill in the dev project's values
pnpm dev                              # http://localhost:5173
```

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server, HMR |
| `pnpm test` | Vitest, one shot (19 tests, ~1.5 s, no network needed) |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm typecheck` | `tsc --noEmit` — strict, `noUnusedLocals` |
| `pnpm build` | typecheck + production build into `dist/` |
| `pnpm preview` | Serve the built `dist/` (this is what `/sw.js` expects) |

`.env.local` holds the two public values from **Dashboard → Project Settings → API**:

```
VITE_SUPABASE_URL=https://<DEV_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<dev anon key>
```

The anon key is public by design — RLS is the access control. Never put `service_role` in here;
it would be compiled into the bundle. `pnpm build` fails loudly if either variable is missing
(`src/lib/supabase.ts` throws at import time).

## 2. Set up the database

```powershell
supabase link --project-ref <DEV_REF>
supabase db push            # applies supabase/migrations/0001_init.sql
```

No Docker, no `supabase start` (SETUP.md decision S3). After the push, the schema, the `photos`
bucket and all policies exist; nothing is clicked in the dashboard.

**The allowlist lives in one place:** `is_team_member()` in `0001_init.sql`. It compares the JWT
email against a single address. A different Google account can sign in successfully and will then
see zero rows — that is the intended behaviour, not a bug.

## 3. How sync works (and why it is this small)

There is no outbox table, no `op_id`, no queue worker, no Edge Function. Local rows carry dirty
flags; the server is the only owner of `rev`.

**Push** (`src/sync/sync.ts`), in this order, because each step depends on the previous one:

1. Photo blobs to Storage at `${project_id}/${photo_id}.jpg`, upsert. Deterministic path, so a
   retry after a crash overwrites instead of duplicating.
2. Row upserts in FK order: `projects → apartments → steps → notes → photos → measurements`.
   `rev` is stripped from project rows (server-owned) and notes use `ignoreDuplicates` (insert-only,
   so a re-send is a no-op rather than a duplicate-key error).
3. One `bump_project_rev(project_id, rev)` per touched project, which increments `rev` only if it
   still matches; on a null result the client refetches the server `rev` and retries once.
4. Only after all of that succeeds are the dirty flags cleared. Any failure throws with every flag
   intact, so the next press retries the whole batch.

**Pull** (`pullProject` / `pullProjectList`):

- Refuses to start if this project still has dirty rows — the assertion that makes wholesale replace
  safe ("push before pull, always").
- Deletes local rows the server no longer has, then `bulkPut`s the server's rows. Deletes are never
  inferred from `updated_at`; absence is the only signal.
- Never deletes a local project that still holds unsynced work.
- Aborts if the server returns no project row at all, instead of wiping the open project. (An
  empty result means "deleted" *or* "this account cannot see it" — both must fail loudly.)

## 4. The acceptance test (the reason Phase 0 exists)

Two browser profiles or one phone + one laptop, both signed in with allowlisted accounts:

1. In profile A: DevTools → Network → **Offline**. Create a project, add apartments, set steps to
   `klart` / `delvis`, write a comment, add a photo.
2. Kill the tab and reopen it. Everything is still there and the header still says `Väntar (n)`.
   That is IndexedDB, not memory.
3. Back online. Press `Uppdatera`. Header reaches `Uppdaterat HH:MM` and the count disappears.
4. Profile B: reload the project list, open the project. Same statuses, same comment, photo visible.
5. In profile B change a step. Press `Uppdatera` in A. A shows B's change and its own work survives.

If step 2 works but step 5 drops data, the bug is in the pull's wholesale replace — see the
`never deletes a local project` test before changing anything.

## 5. Layout

```
src/
  main.ts                 boot, auth gate, hash router (#/, #/p/:id, #/p/:id/...)
  db/db.ts                Dexie schema, repositories, dirty-flag helpers
  sync/sync.ts            pushLocal / pullProject / pullProjectList / runSync
  sync/backend.ts         SyncBackend interface (the seam the tests fake)
  sync/state.ts           tiny observable store for the header
  domain/status.ts        progress maths: delvis = 0.5, rounds down, never 100 % early
  data/templates.ts       the 36-step Cat6 template, ported from the Streamlit app
  ui/                     header, project list, project, checklist, photo capture
  lib/                    supabase client, photo downscale, clipboard/date helpers
public/sw.js              hand-written service worker (app shell + runtime caching)
supabase/migrations/      0001_init.sql — schema, policies, bucket, rev RPC
tests/                    status, push, pull + FakeServer (in-memory PostgREST)
```

`pnpm test` needs no Supabase project: `tests/fake-server.ts` implements `SyncBackend` in memory,
including `rev` semantics and Storage uploads.

## 6. Deliberate Phase 0 limits

| Not built | Why / when |
|---|---|
| Measurements screen | Tables, dirty flags and push/pull already handle the rows; only the UI is missing (Phase 1) |
| Export to Excel | Phase 1; the ASCII status codes in `0001_init.sql` exist so the macro can compare strings |
| Pause/close project flows | Columns exist (`paused_*`, `closed_at`), screens do not |
| Search, filters, sorting | Project list shows everything |
| Conflict resolution beyond `rev` | Last write wins per row, guarded by the push-then-pull assertion |
| Background sync / retry timer | The button is the contract; a failed press is visible and repeatable |
| Step skip (`ej_aktuellt`) | `skip_reason` is reserved, the state is not in the check constraint |

## 7. Known deviation from `docs/SETUP.md`

`SETUP.md` decision **S7** and step **D.5** describe a `public.users` table with `is_active`, filled
by `handle_new_user()`, with RLS keying off membership. `0001_init.sql` instead uses a single
allowlist email inside `is_team_member()`.

Why: v1 has exactly one technician, and the email gate needs no trigger, no invite flow and no
service-role call to activate anyone. Consequences:

- An uninvited account still authenticates and still reads zero rows (S7's goal is met).
- Adding a second technician means editing one line in a migration and pushing it.
- `SETUP.md` D.5 ("activate the row") and the `users`-related troubleshooting rows do not apply as
  written.

Switching to the `users` table later is one migration plus one function body; nothing in the client
reads identity beyond `auth.getUser().email` for the footer. Decide before Phase 1 adds a second
person, not after.

- Downloads photo blobs that exist only in Storage, so the acceptance rule "the only network calls
  are the button and the auth refresh" stays true.

**UI contract:** the header is a five-state machine — `Offline → Väntar (n) → Uppdaterar… →
Uppdaterat 14:32 | Fel`. Nothing syncs on scroll, on navigation or on a timer. The button is the
only trigger (plus one silent pull when the app regains connectivity *and* something is pending).

## 8. Deploy to Vercel

`vercel.json` in this folder pins the whole build, so the dashboard only needs a root directory
and two env vars. Nothing here is guesswork — SPEC §16.5 fixes the caching rules, and a stale
service worker is the classic PWA support call.

### 8.1 Import the project

1. <https://vercel.com/new> → **Import Git Repository** → `WilliamSvens/projektapp`.
2. Open **Root Directory** → **Edit** → set it to **`pwa`**. This is the step that fails quietly:
   the repo root holds the old Streamlit app and has no `package.json`.
3. **Framework Preset** becomes **Vite** automatically once the root is `pwa`. Leave Build
   Command, Output Directory and Install Command alone — they come from `pwa/vercel.json`:

   | Setting | Value | Why |
   |---|---|---|
   | Install | `pnpm install --frozen-lockfile --prod=false` | Without `--prod=false` the build has no `tsc`/`vite` |
   | Build | `pnpm build` | Runs `tsc --noEmit && vite build`, so a type error fails the deploy |
   | Output | `dist` | Vite default |
   | Node | `22.x` | From `engines` in `package.json` |

### 8.2 Environment variables (all three scopes)

Vite inlines `VITE_*` at **build** time, so these must exist before the build runs, and changing
one requires a redeploy.

| Variable | Production | Preview + Development |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<PROD_REF>.supabase.co` | `https://<DEV_REF>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | prod anon key | dev anon key |

Two entries per variable if the values differ per scope. Do not add `service_role` to any scope —
it would be compiled into the public bundle (SPEC §16.2, check E9).

4. **Deploy**. Name the project **`projektapp`** so the domain is `projektapp.vercel.app` and
   matches the `<VERCEL_DOMAIN>` placeholder the rest of `docs/SETUP.md` uses.

### 8.3 Wire the domain back into Supabase and Google

The deploy succeeds before this and then sign-in bounces to `localhost` — this order is why.

| Where | What |
|---|---|
| Supabase **prod** → Authentication → URL Configuration | Site URL `https://projektapp.vercel.app`, Redirect URLs `https://projektapp.vercel.app/**` and `https://*-<TEAM_SLUG>.vercel.app/**` |
| Google Auth Platform → client `projektapp-web` | Authorized origin `https://projektapp.vercel.app` (keep `http://localhost:5173`) |

The wildcard is what lets preview deployments log in (SETUP.md C.2 note, verification E8).

### 8.4 Verify the deployment

| Check | How | Expected |
|---|---|---|
| Shell loads | open the URL | sign-in screen, Swedish copy |
| SW registered | DevTools → Application → Service Workers | `sw.js`, status **activated**, scope `/` |
| Headers | `curl -I https://projektapp.vercel.app/sw.js` | `cache-control: public, max-age=0, must-revalidate` |
| Hashed assets immutable | `curl -I .../assets/index-*.js` | `max-age=31536000, immutable` |
| No service key | local `pnpm build`, then search `dist/**/*.js` for `SERVICE_ROLE` | no matches (E9) |
| Offline start | Network → Offline, reload | app still boots (shell is cached) |
| Preview login | open a PR, sign in on its `*.vercel.app` URL | session established (E8) |

### 8.5 Gotchas, in the order they usually bite

| Symptom | Cause | Fix |
|---|---|---|
| Build fails: no `package.json` found | Root Directory left at the repo root | Set it to `pwa` |
| `tsc: not found` during build | Dev deps skipped because `NODE_ENV=production` | Already handled by `--prod=false`; don't "simplify" the install command |
| `ERR_PNPM_OUTDATED_LOCKFILE` | `package.json` changed without a local `pnpm install` | Run it, commit `pnpm-lock.yaml` |
| Preview deploy can't sign in, production can | Vercel **Deployment Protection** intercepts the OAuth return, or the wildcard is missing | Disable protection for previews, or test against production |
| Old version keeps loading after a deploy | Service worker still serving the previous shell | Reload twice; DevTools → SW → **Update**. Bump `CACHE` in `public/sw.js` only when SW logic changes |
| Login works, every list is empty | Env vars point at prod while the migration was only pushed to dev, or the allowlist email differs | Check `is_team_member()` in `0001_init.sql` |

Deploying by hand instead is allowed but does not replace step 8.2:

```powershell
cd pwa
npx vercel          # preview URL
npx vercel --prod   # production
```

