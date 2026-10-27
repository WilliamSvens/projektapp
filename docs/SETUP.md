# Projektapp Field — Setup and provisioning

**Status:** draft, executed once per environment
**Version:** 0.1
**Depends on:** `SPEC.md` §2 (roles), §5.2 (users), §5.10 (buckets), §13.1 (auth), §16.2 (env vars), §16.3 (migrations)
**Takes:** ~45 minutes, one sitting, before any Phase 0 code is written

The goal of this guide is narrow: a Supabase project plus Google sign-in in a state where
`pnpm dev` can log in with a real Google account, and where RLS guarantees that an **uninvited**
Google account sees literally nothing. Every step ends with *what it prevents*, because that is
the bug you would otherwise spend an evening on.

This guide does **not** author migrations or import data. The old SQLite holds test data only
(2 projects, 72 steps, 0 photos), so there is nothing to migrate.

---

## 0. What you need before starting

| Item | Why |
|---|---|
| GitHub account | Supabase and Vercel both sign in with it |
| Password manager | DB passwords and the Google client secret are shown once |
| Node 20 LTS + `pnpm` (`corepack enable`) | Vite app; see `SPEC.md` §16.1 |
| Supabase CLI (`scoop install supabase` or `npx supabase@latest`) | `link` / `db push` — no Docker needed. On stock Windows `npx` is a blocked `.ps1`: use `npx.cmd`, or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| 45 uninterrupted minutes | The Google client secret cannot be viewed again after creation |

Fill these in as you go; later steps refer back to them:

| Placeholder | Where it comes from | Example |
|---|---|---|
| `<PROD_REF>` | Supabase project ref, `projektapp-prod` | `abcdefghijklmnop` |
| `<DEV_REF>` | Supabase project ref, `projektapp-dev` | `qrstuvwxyzabcdef` |
| `<VERCEL_DOMAIN>` | Vercel production domain | `projektapp.vercel.app` |
| `<TEAM_SLUG>` | Vercel team/account slug (for the preview wildcard) | `williamsven-1234` |

## 1. Decisions encoded in this guide

Veto any of these now; they are cheap to change before step A.1 and expensive after.

| # | Decision | Value | Reason |
|---|---|---|---|
| S1 | Supabase region | **`eu-north-1` (Stockholm)** | Latency from Swedish basements; data stays in the EU |
| S2 | Environments | **Two projects**: `projektapp-prod` + `projektapp-dev` | Free tier allows two active projects; schema experiments never touch real jobs |
| S3 | Local dev DB | **No Docker, no `supabase start`** — dev points at `projektapp-dev` | Removes the biggest Windows setup failure. CI still runs `supabase db reset` (runners have Docker) |
| S4 | Google publishing status | **In production**, not Testing | Testing mode expires refresh tokens after **7 days** — it would silently defeat the 14-day offline grace (D5) |
| S5 | OAuth client | **One** Web client, several redirect URIs | Simpler. Tradeoff: rotating it affects dev and prod together |
| S6 | Buckets | Created **in migration 0001**, never clicked in the dashboard | Reproducible; paths and limits live in git beside §5.10 |
| S7 | Invite gate | Signup **succeeds**, but `handle_new_user()` creates the `users` row with `is_active = false`; RLS keys off `users` + `is_active` | An uninvited account can authenticate and still see zero rows. No lockout risk, no opaque GoTrue error |
| S8 | Secrets | `anon` key in the client build; `service_role` only in Edge Function secrets | Spec §16.2; CI greps `dist/` for `SERVICE_ROLE` |

---

## 2. Part A — Supabase projects

### A.1 Create `projektapp-prod`

<https://supabase.com/dashboard> → **New project**.

| Field | Value |
|---|---|
| Organization | your personal org |
| Name | `projektapp-prod` |
| Database password | **Generate** → store in the password manager as `supabase projektapp-prod db` |
| Region | **Stockholm (`eu-north-1`)** |
| Plan | Free |

*Prevents:* the "let me just test in prod" habit (S2), and a US-hosted database you would have to
defend in a GDPR conversation.

### A.2 Create `projektapp-dev`

Same fields, name `projektapp-dev`, separate stored password.

*Prevents:* `db push` accidents. From here on every migration goes to dev first, then to prod.

### A.3 Collect the keys

**Project Settings → API** (do it for both projects):

| Key | Secret? | Goes into |
|---|---|---|
| Project URL (`https://<ref>.supabase.co`) | no | `VITE_SUPABASE_URL` |
| `anon` / publishable key | no | `VITE_SUPABASE_ANON_KEY` |
| `service_role` / secret key | **yes** | Edge Function secrets only, step D.4 |
| Direct connection string + DB password | **yes** | Supabase CLI when it asks; password manager |

Rule from `SPEC.md` §16.2 that this step exists to enforce: anything the browser can read is
assumed public, and `service_role` must never sit in a file whose name starts with `VITE_`.

*Prevents:* the classic leak where `service_role` is dropped into `.env.local` as
`VITE_SUPABASE_SERVICE_KEY` and shipped to every phone.

---

## 3. Part B — Google Auth Platform

Google renamed the old "OAuth consent screen" into the **Google Auth Platform**, with five sections:
Overview, **Audience**, **Branding**, **Clients**, **Data Access**. The steps follow that layout; on
older consoles the same settings live under *APIs & Services → OAuth consent screen* and
*Credentials*.

### B.1 Create the Google Cloud project

<https://console.cloud.google.com> → project selector → **New project** → name `projektapp` → Create.

### B.2 Audience

**Google Auth Platform → Audience**

| Field | Value |
|---|---|
| User type | **External** (no Workspace domain) |
| Publishing status | **In production** — click *Publish app* and confirm |

Why this is not optional: while an app sits in **Testing**, Google expires refresh tokens after
**7 days**. The field app is designed to work offline for up to 14 days between sign-ins (D5) and
to survive a weekend in a basement. A Testing-mode client would log the technician out every Monday
and look exactly like a bug in our sync code.

Publishing with only `openid`, `email` and `profile` requires **no verification review** — those
scopes are non-sensitive. You will only meet verification if you add sensitive scopes later, which
this app never does.

*Prevents:* "why am I logged out every week", and a multi-week review caused by accidentally
requesting Gmail or Drive scopes.

### B.3 Data Access

**Google Auth Platform → Data Access** — the app needs exactly three scopes:

| Scope | How to add |
|---|---|
| `openid` | **Add manually** (not in the default list) |
| `.../auth/userinfo.email` | present by default |
| `.../auth/userinfo.profile` | present by default |

Remove anything else. `openid` is the one people forget; without it there is no ID token and no
stable `google_sub` claim, which `SPEC.md` §5.2 uses as the identity key.

*Prevents:* a login that succeeds but leaves `google_sub` empty, breaking the `UNIQUE NOT NULL`
constraint on `users` at first login.

### B.4 Branding

**Google Auth Platform → Branding**: app name `Projektapp`, your support email, developer contact
email. A logo is optional and triggers brand verification (a few business days) — skip it in v1.

*Prevents:* a consent screen that says "supabase-<ref>" and looks like phishing to a customer
standing next to you.

### B.5 Create the OAuth client

**Google Auth Platform → Clients → Create client**

| Field | Value |
|---|---|
| Application type | **Web application** |
| Name | `projektapp-web` |
| Authorized JavaScript origins | `http://localhost:5173`<br>`https://<VERCEL_DOMAIN>` |
| Authorized redirect URIs | `https://<PROD_REF>.supabase.co/auth/v1/callback`<br>`https://<DEV_REF>.supabase.co/auth/v1/callback` |

Rules Google enforces, and that cost people an hour:

- Origins are **scheme + host + port only** — no trailing slash, no path, no wildcard. `localhost`
  is the only exception to the HTTPS requirement.
- The redirect URI is the **Supabase callback**, not your app's URL. Your app receives the session
  from Supabase after that hop.

Then **Create** → copy the **Client ID** and **Client secret** immediately into the password manager
as `google oauth projektapp-web`. The secret is hashed after creation and the console will only ever
show its last four characters. If it is lost, rotate the secret rather than creating a new client.

*Prevents:* `redirect_uri_mismatch`, and the lost-secret dead end.

---

## 4. Part C — Connect Google to Supabase

Do this for **both** projects, `projektapp-dev` first so the surprises happen locally.

### C.1 Enable the provider

**Authentication → Sign In / Providers → Google** → toggle on:

| Field | Value |
|---|---|
| Client ID | from B.5 |
| Client Secret | from B.5 |
| Skip nonce check | leave **off** |

Save.

### C.2 URL Configuration

**Authentication → URL Configuration**

| Field | Value |
|---|---|
| Site URL | prod project: `https://<VERCEL_DOMAIN>` · dev project: `http://localhost:5173` |
| Redirect URLs | `http://localhost:5173/**`<br>`https://<VERCEL_DOMAIN>/**`<br>`https://*-<TEAM_SLUG>.vercel.app/**` |

The wildcard syntax is Supabase's own: `*` matches within one path segment, `**` matches anything
after it. The third line is what lets **Vercel preview deployments** log in. Without it production
works and every PR preview bounces to the Site URL — a miserable thing to debug on a deadline.

*Prevents:* "login works locally but the preview URL sends me to localhost" (a non-allowlisted
redirect falls back to the Site URL).

### C.3 Sessions — and the 14-day myth

**Authentication → Sessions / Security**: leave the defaults (JWT expiry 3600 s, refresh token
rotation on). Do **not** enable time-boxed sessions.

There is no "14 days" field anywhere in Supabase. The offline grace window from D5 is **client
logic** in Phase 0: the PWA keeps the last valid session and the cached data, allows read-only use
while it cannot refresh, and forces a real sign-in after 14 days. Writing it down here saves the
hour spent hunting for the setting.

*Prevents:* someone "fixing" offline login by raising JWT expiry to 14 days, which makes a stolen
phone valid for two weeks with no way to revoke it (§13.5).

### C.4 Turn off every other provider

**Authentication → Providers**: disable **Email**, and any phone/SAML/anonymous provider that is on
by default.

*Prevents:* password signups and magic links running beside the invite gate — a second, unguarded
door into the same data.

### C.5 Later, optional: block signup at the edge

Supabase offers a **Before User Created** auth hook. Once the invite flow has a UI (Phase 3), an HTTP
hook can reject uninvited emails outright instead of merely creating an inactive row.

Deliberately **not** done in v1: a Postgres function that raises inside `auth.users` reaches the user
as GoTrue's opaque `Database error saving new user`, and a failed signup is harder to explain than an
empty screen saying `Ditt konto är inte inbjudet. Kontakta William.`

*Prevents:* debugging an error that names neither its cause nor its fix.

---

## 5. Part D — Repo and environment wiring

### D.1 Link the CLI and push the schema

Run from **`pwa/`** — that is where `supabase/migrations` lives. `init` is the step that creates
`supabase/config.toml`; skipping it makes `link` fail with *Cannot find project ref*:

```powershell
cd pwa
npx.cmd supabase@latest init         # creates pwa/supabase/config.toml, keeps migrations/
npx.cmd supabase@latest login        # opens the browser once
npx.cmd supabase@latest link --project-ref <DEV_REF>
npx.cmd supabase@latest db push      # applies supabase/migrations/*.sql to dev
```

Then repeat with `--project-ref <PROD_REF>` **only after** the dev schema and the verification
checklist below are green. `db push` asks for the database password stored in A.1.

*Prevents:* hand-edited production schema that no commit describes (§16.3).

### D.2 `.env.local` (gitignored)

```
VITE_SUPABASE_URL=https://<DEV_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<dev anon key>
```

Two variables, both public by design. A committed `.env.example` lists the same keys with empty
values so a fresh clone knows what to fill in.

### D.3 Vercel environment variables

Project → Settings → Environment Variables, for **Production**, **Preview** and **Development**:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | prod URL for Production, dev URL for Preview/Development |
| `VITE_SUPABASE_ANON_KEY` | matching anon key |

### D.4 Edge Function secrets

```powershell
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<prod service_role> EXPORT_BUCKET=exports --project-ref <PROD_REF>
```

Never the client build. `SPEC.md` §16.2 has CI grep `dist/` for `SERVICE_ROLE` and fail the build.

### D.5 First login, then promote yourself to admin

Sign in once with Google. `handle_new_user()` (migration 0001) creates the `users` row with
`is_active = false`, so the app shows `Ditt konto är inte inbjudet. Kontakta William.` — which is
correct, and proves the gate works.

Then, in the SQL editor of that project:

```sql
update public.users
   set role = 'admin', is_active = true
 where email = 'your.address@gmail.com'
returning id, email, role, is_active, google_sub;
```

`google_sub` must be non-empty. If it is `null`, step B.3 is missing the `openid` scope.

This is the seeded-admin rule from §2, implemented without inventing a table: the row exists as soon
as the person has authenticated once, and activation is an explicit admin act.

### D.6 Inviting the second technician (until Phase 3 has a UI)

1. They open the app and sign in with Google → an inactive `users` row appears, app says not invited.
2. You run `update public.users set is_active = true where email = '<their email>';`
3. They reopen the app and are in.

*Prevents:* an invite mechanism that only exists in the admin's memory. Phase 3 replaces this with
the invite screen and an `event_log` entry per activation.

---

## 6. Part E — Verification checklist

Run every row. A setup is not done because the login screen appeared.

| # | Check | How | Pass looks like |
|---|---|---|---|
| E1 | Auth user created | `select count(*) from auth.users;` | `1` after your first sign-in |
| E2 | Profile row created | `select email, role, is_active, google_sub is not null as has_sub from public.users;` | your email, `admin`, `t`, `t` |
| E3 | Uninvited account is blocked from data | private window, sign in with a **different** Google account; then `select is_active from public.users where email = '<that email>';` | app shows `Ditt konto är inte inbjudet. Kontakta William.`; `is_active = f`; project list empty |
| E4 | Buckets exist | `select id, public, file_size_limit from storage.buckets order by id;` | 4 rows: `documents`, `exports`, `photos`, `signatures`; `public = false` |
| E5 | RLS is on everywhere | `select tablename from pg_tables where schemaname='public' and rowsecurity = false;` | empty result |
| E6 | Policies exist | `select count(*) from pg_policies where schemaname='public';` | non-zero; record the number in the Phase 0 PR |
| E7 | Google app is published | Google Auth Platform → Audience | publishing status **In production** |
| E8 | Preview deployment can log in | open a PR, use its `*.vercel.app` URL, sign in | session established, not bounced to localhost |
| E9 | No service key in the bundle | `pnpm build` then `Select-String -Path 'dist/**/*.js' -Pattern 'SERVICE_ROLE'` | no matches |
| E10 | Session survives a week | sign in, do not sign out, use the app on day 8 | still signed in (fails if B.2 is still in Testing) |

E10 is the one that cannot be checked in a sitting. Put it in the calendar for the first week after
setup rather than discovering it in a basement in November.

---

## 7. Part F — Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `redirect_uri_mismatch` | Redirect URI is your app's URL, has a trailing slash, or names the wrong project ref | It must be exactly `https://<ref>.supabase.co/auth/v1/callback` |
| `Database error saving new user` | A trigger on `auth.users` is raising | Do not raise there; let the row insert and gate with `is_active` + RLS (S7) |
| Signed out roughly every 7 days | Google app still in Testing | Publish it (B.2) |
| Preview deploys can't log in, production can | Preview domain not allowlisted | Add `https://*-<TEAM_SLUG>.vercel.app/**` (C.2) |
| `google_sub` is null | `openid` scope missing | Add it manually in Data Access (B.3) |
| Logged in but every list is empty | `users` row is `is_active = false`, or RLS sees no membership | Intended for strangers; activate the row (D.5) — never disable RLS to "test" |
| `supabase db push` → password authentication failed | Wrong or rotated DB password | Project Settings → Database → reset password, then re-run |
| `npx.ps1 cannot be loaded because running scripts is disabled on this system` | Windows default policy is `Restricted`; `npx`, `pnpm`, `corepack` are `.ps1` shims | Call `npx.cmd` / `pnpm.cmd`, or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (user scope, no admin) |
| `supabase link` → *Cannot find project ref* | No `supabase/config.toml`; `init` was skipped | `npx.cmd supabase@latest init` in the directory that holds `supabase/migrations`, then link and push (D.1) |
| `permission denied for table users` | Query ran as `anon`/`authenticated` without a policy | Use the SQL editor (runs as `postgres`), or qualify `public.users` |
| Vercel build: `import.meta.env.VITE_SUPABASE_URL is undefined` | Env var set for Production only | Add it to Preview and Development too (D.3) |
| Email/magic-link login still offered | C.4 not saved | Disable the Email provider and re-test in a private window |
| Project paused after a holiday | Free tier pauses after a week of inactivity | Restore from the dashboard; the nightly export job normally keeps it awake |

---

## 8. Part G — Limits and cost

- Free tier is enough for Phases 0–2: two active projects, a small database, ~1 GB of storage.
  Exact quotas move, so read the pricing page rather than this file.
- **Free projects pause after about a week of inactivity.** A daily-used field app never hits this;
  a two-week holiday does. Restoring is one click, but the nightly export stops in the meantime.
- Supabase Pro (~25 USD/month) removes the pause, adds daily backups with point-in-time recovery
  (§13.7) and raises the storage ceiling. Move when the app becomes the only record of a job, not
  before.
- Storage migration to Cloudflare R2 is a documented decision, not an accident: revisit at
  **50 GB or 5 000 SEK/month** (D4).

---

## Appendix — Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-22 | First version: two-project Supabase layout, Google Auth Platform walkthrough, provider and URL configuration, env wiring, invite gate without a new table, verification and troubleshooting tables. |

### Note carried into Phase 0

`SPEC.md` §5.2 says a user is "created/invited by an admin and matched on first login", and §2
seeds one admin, but the spec does not spell out the mechanism. Phase 0's migration `0001` must
include `handle_new_user()` (AFTER INSERT on `auth.users`: insert into `public.users` with
`google_sub := raw_user_meta_data->>'sub'`, `is_active := false`, `role := 'tekniker'`). That
function is the only new piece of schema this guide assumes; everything else it touches is already
in §5.

