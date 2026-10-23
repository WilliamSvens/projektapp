-- 0001_init.sql — v1 schema (docs/SPEC-V1.md §2, §3)
-- Source of truth for the schema. Never edit tables in the Supabase dashboard.
-- Six business tables, no users/membership table: v1 is one technician, so RLS keys off
-- a single allowlist email (see is_team_member()) instead of a project_members join.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Identity gate
-- ---------------------------------------------------------------------------

-- The one place the allowlist lives. Change the address here and every policy follows.
-- Returns false for anonymous callers, so an uninvited Google account reads zero rows
-- even though sign-in itself succeeds (docs/SETUP.md S7).
create or replace function public.is_team_member()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'svenwilliamsvens@gmail.com'
$$;

grant execute on function public.is_team_member() to authenticated, anon;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  project_type  text not null,
  customer      text,
  address       text,
  contact_name  text,
  contact_phone text,
  -- ASCII codes, never the Swedish label: the Excel macro compares strings (§8).
  status        text not null default 'pagaende'
                check (status in ('pagaende', 'pausad', 'klart')),
  paused_reason text,
  paused_note   text,
  paused_at     timestamptz,
  resume_on     date,
  closed_at     timestamptz,
  notes         text,
  -- The only version number in the system. Bumped server-side by bump_project_rev().
  rev           integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists public.apartments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  building    text,
  stairwell   text,
  unit_number text not null,
  floor       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.steps (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  apartment_id uuid references public.apartments (id) on delete cascade,
  category     text not null,
  subcategory  text,
  title        text not null,
  sort_order   integer not null,
  -- Three states, no boolean: 'delvis' is real work in progress (§2.1).
  status       text not null default 'ej_klar'
               check (status in ('klar', 'delvis', 'ej_klar')),
  -- Reserved for a future 'ej_aktuellt'; unused in v1.
  skip_reason  text,
  comment      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- Append-only: no updated_at, no deleted_at, and no UPDATE/DELETE policy below.
create table if not exists public.notes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  apartment_id uuid references public.apartments (id) on delete cascade,
  step_id      uuid references public.steps (id) on delete cascade,
  body         text not null,
  author_email text not null,
  created_at   timestamptz not null default now()
);

create table if not exists public.photos (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  apartment_id   uuid references public.apartments (id) on delete cascade,
  step_id        uuid references public.steps (id) on delete cascade,
  storage_path   text,
  caption        text,
  taken_at       timestamptz,
  captured_lat   double precision,
  captured_lng   double precision,
  gps_accuracy_m double precision,
  width          integer,
  height         integer,
  bytes          integer,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table if not exists public.measurements (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  apartment_id     uuid references public.apartments (id) on delete cascade,
  step_id          uuid references public.steps (id) on delete cascade,
  link_id          text,
  measurement_type text not null,
  wavelength_nm    integer,
  length_m         numeric(10, 3),
  splice_count     integer,
  connector_count  integer,
  value_db         numeric(6, 3),
  budget_db        numeric(6, 3),
  passed           boolean,
  instrument       text,
  measured_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- ---------------------------------------------------------------------------
-- Indexes — one per pull path (§3.4 selects a whole project)
-- ---------------------------------------------------------------------------

create index if not exists projects_updated_idx on public.projects (updated_at);
create index if not exists apartments_project_idx on public.apartments (project_id);
create index if not exists steps_project_idx on public.steps (project_id);
create index if not exists steps_apartment_idx on public.steps (apartment_id);
create index if not exists notes_project_idx on public.notes (project_id);
create index if not exists photos_project_idx on public.photos (project_id);
create index if not exists measurements_project_idx on public.measurements (project_id);

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists apartments_touch on public.apartments;
create trigger apartments_touch before update on public.apartments
  for each row execute function public.touch_updated_at();

drop trigger if exists steps_touch on public.steps;
create trigger steps_touch before update on public.steps
  for each row execute function public.touch_updated_at();

drop trigger if exists measurements_touch on public.measurements;
create trigger measurements_touch before update on public.measurements
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Rev bump (§3.3 step 4) — PostgREST cannot express `rev = rev + 1 where rev = :rev`
-- ---------------------------------------------------------------------------

-- Returns the new rev, or null when another device already moved it: the caller then
-- refetches the rev and retries once, exactly as §3.3 describes.
create or replace function public.bump_project_rev(p_project uuid, p_rev integer)
returns integer
language plpgsql
as $$
declare
  v_new integer;
begin
  update public.projects
     set rev = rev + 1
   where id = p_project
     and rev = p_rev
     and deleted_at is null
  returning rev into v_new;

  return v_new;
end;
$$;

grant execute on function public.bump_project_rev(uuid, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.projects     enable row level security;
alter table public.apartments   enable row level security;
alter table public.steps        enable row level security;
alter table public.notes        enable row level security;
alter table public.photos       enable row level security;
alter table public.measurements enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['projects', 'apartments', 'steps', 'photos', 'measurements']
  loop
    execute format('drop policy if exists team_all on public.%I', t);
    execute format(
      'create policy team_all on public.%I for all to authenticated
         using (public.is_team_member()) with check (public.is_team_member())', t);
  end loop;
end;
$$;

-- Notes are append-only in the database, not just by convention: no UPDATE, no DELETE policy.
drop policy if exists team_read on public.notes;
create policy team_read on public.notes
  for select to authenticated using (public.is_team_member());

drop policy if exists team_insert on public.notes;
create policy team_insert on public.notes
  for insert to authenticated with check (public.is_team_member());

-- ---------------------------------------------------------------------------
-- Storage (§5.10): created here, never clicked in the dashboard (SETUP.md S6)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists photos_team_read on storage.objects;
create policy photos_team_read on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.is_team_member());

drop policy if exists photos_team_write on storage.objects;
create policy photos_team_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and public.is_team_member());

drop policy if exists photos_team_update on storage.objects;
create policy photos_team_update on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and public.is_team_member())
  with check (bucket_id = 'photos' and public.is_team_member());
