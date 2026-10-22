# Projektapp Field — Technical Specification

**Status:** draft for approval
**Version:** 0.1
**Owner:** William Svens (solo fiber/coax technician, Swedish apartment complexes)
**Supersedes:** the Streamlit application in this repository (`app.py`, `src/`), which stays as a reference and read-only desk view until Phase 4.

---

## Table of contents

1. [Purpose, scope, non-goals](#1-purpose-scope-non-goals)
2. [Roles and permissions](#2-roles-and-permissions)
3. [Domain glossary](#3-domain-glossary)
4. [Domain model](#4-domain-model)
5. [Database schema](#5-database-schema)
6. [State machines](#6-state-machines)
7. [Offline sync contract](#7-offline-sync-contract)
8. [Screens and flows](#8-screens-and-flows)
9. [Photo and document pipeline](#9-photo-and-document-pipeline)
10. [Search](#10-search)
11. [Excel export contract](#11-excel-export-contract)
12. [PDF and report contract](#12-pdf-and-report-contract)
13. [Security, privacy and GDPR](#13-security-privacy-and-gdpr)
14. [Non-functional budgets](#14-non-functional-budgets)
15. [Testing strategy](#15-testing-strategy)
16. [Repository, environment, CI, deploy](#16-repository-environment-ci-deploy)
17. [Migration and cutover from Streamlit](#17-migration-and-cutover-from-streamlit)
18. [Phases and acceptance criteria](#18-phases-and-acceptance-criteria)
19. [Open decisions](#19-open-decisions)
20. [Appendix A — Swedish UI copy](#appendix-a--swedish-ui-copy)
21. [Appendix B — Change log](#appendix-b--change-log)

---

## 1. Purpose, scope, non-goals

### 1.1 Purpose

A field tool for one or more technicians installing fibre and coax/CAT6 in apartment
complexes. It must work **with no network in a basement plant room**, record
documentation that holds up months later, and produce spreadsheets and PDFs that a
customer accepts and that bookkeeping/VBA macros can consume without rework.

### 1.2 In scope

- Projects with a real lifecycle: **aktiv / pausad / avslutad**, including *why* a job is
  paused and *when* it can resume.
- Buildings → stairwells (`uppgång`) → apartments, with bulk creation of units.
- Per-apartment checklists driven by editable, versioned templates.
- Photos (camera, compressed, GPS + timestamp, markup), documents, measurements with
  pass/fail, tenant sign-off.
- Time and material logging per project and per apartment.
- Offline-first operation on a phone, multi-technician safe synchronisation.
- Excel export at a stable path with a versioned, macro-safe schema.
- PDF protocols generated on the device, offline.
- Search over everything, offline, plus 30-day undo for deletions.

### 1.3 Explicit non-goals

| Not building | Why |
|---|---|
| Invoicing/accounting | The app produces the *underlag*; bookkeeping stays in the accounting system. |
| CRM / sales pipeline | Out of scope forever. |
| Customer-facing portal | Sign-off happens on the technician's phone. |
| Payroll or scheduling optimisation | Assignments only, no rostering engine. |
| Native iOS/Android binaries | PWA only; app stores add cost with no field benefit. |
| Real-time chat | Notes are per step and per project; enough. |
| Offline map tiles (v1) | Phase 3 at the earliest, and only if a job needs it. |

### 1.4 Design principles

1. **The device is a cache, the server is truth.** Never let the phone be the only copy of
   anything that matters.
2. **Never silently overwrite another technician's work.** Conflicts are shown, not resolved
   by guessing.
3. **Nothing is destroyed in one tap.** Soft delete + 30-day restore everywhere.
4. **The field UI is thumb-sized, glove-friendly and sunlight-readable.** Design for one
   hand, standing up.
5. **Text before pixels.** Checklist state syncs in seconds; photos trickle in afterwards.
6. **The export is an API.** Column names and sheet names are a contract for VBA macros and
   change only with a version bump.

---

## 2. Roles and permissions

Solo today, crew-ready by design. A role is stored on `users.role` and can be overridden
per project through `project_members.role`.

| Capability | `tekniker` | `arbetsledare` | `admin` |
|---|---|---|---|
| See assigned projects | ✅ | ✅ | ✅ |
| See all projects | ❌ | ✅ | ✅ |
| Create projects | ❌ | ✅ | ✅ |
| Edit project details | ❌ | ✅ | ✅ |
| Pause / resume a project | ✅ (with reason) | ✅ | ✅ |
| Close a project | ❌ | ✅ (all units signed off) | ✅ (override + note) |
| Reopen a closed project | ❌ | ❌ | ✅ (logged) |
| Edit checklist templates | ❌ | ✅ | ✅ |
| Delete (soft) any record | own records | own project | any |
| Restore from Papperskorg | own records | own project | any |
| Invite users | ❌ | ❌ | ✅ |
| Export Excel / PDF | ✅ (assigned projects) | ✅ | ✅ |

**Notes**

- There is exactly **one** seeded admin: the Google account in `allowed_emails` at first
  login becomes `admin`. Everyone else is invited as `tekniker` by default.
- A `tekniker` may pause a project because that is a field decision (access denied, weather,
  missing material); it always records who did it.
- RLS is enforced in Postgres, not in the UI. The UI hiding a button is a convenience, never
  the security boundary.

---

## 3. Domain glossary

Swedish field language is the source of truth for what a thing *is*; code and database
columns stay English/ASCII so exports stay macro-safe.

| Swedish (UI) | Code / DB | Meaning |
|---|---|---|
| Projekt | `projects` | One contract on one address, or one phase of it. |
| Projekttyp | `projects.project_type` | `fiber_apartment`, `cat6`, `ovrigt`. |
| Aktiv / Pausad / Avslutad | `project_status` | Lifecycle state; see §6.1. |
| Pausorsak | `projects.paused_reason` | Why work stopped; enum + free text in `paused_note`. |
| Beräknat återupptag | `projects.resume_on` | Date the job is expected to continue. |
| Byggnad / Hus | `buildings` | Physical building. Optional for single-building jobs. |
| Uppgång / Trapphus | `stairwells` | Stairwell inside a building (`A`, `B`, `1`…). |
| Lägenhet | `apartments` | Unit, identified by `unit_number` (`1001`). |
| Fastighetsbeteckning | `buildings.property_designation` | Optional legal property id. |
| Kategori / Underkategori | `steps.category` / `steps.subcategory` | Grouping, e.g. `NOD` / `ODF`. |
| Steg | `steps` | One checklist line: `"Fiber svetsad till ODF"`. |
| Ej aktuellt | `step_status.ej_aktuellt` | Deliberately skipped, requires `skip_reason`. |
| NOD | `steps.category = 'NOD'` | Node/central location (stativ, ODF, patch). |
| ODF | (text in `subcategory`) | Optical distribution frame. |
| ONT | (text in `steps.title`) | Optical network terminal in the apartment. |
| Svetsning / skarv | (text) | Fusion splice. |
| Dämpning | `measurements.value_db` | Attenuation in dB. |
| Budget | `measurements.budget_db` | Allowed attenuation; drives pass/fail. |
| Mätprotokoll | `documents.category = 'matprotokoll'` | OTDR/power meter report file. |
| Egenkontroll | `steps` category | Self-inspection before handover. |
| Överlämning | `signoffs` | Tenant/customer acceptance. |
| Signatur | `signoffs.signature_path` | PNG stroke capture in storage. |
| Avvikelse | `steps.status = 'ej_aktuellt'` + note, or a `documents` entry | Deviation from the drawing/spec. |
| Material | `materials` | Article, quantity, unit, price. |
| Arbetstid / Besök | `visits` | Check-in/check-out per site visit. |
| Papperskorg | soft delete UI | 30-day restore window. |
| Synk | sync (see §7) | Push/pull of pending operations. |

---

## 4. Domain model

### 4.1 Entity overview

```
users ──< project_members >── projects
                                │
                                ├──< buildings ──< stairwells ──< apartments
                                │                                   │
                                ├──< steps ──────────────────────────┤  (apartment_id NULL = project-level)
                                │      ├──< step_revisions          │
                                │      ├──< photos ──────────────────┤
                                │      ├──< measurements ────────────┤
                                │      └──< materials ───────────────┤
                                ├──< documents ─────────────────────┤
                                ├──< visits ────────────────────────┤
                                ├──< signoffs ──────────────────────┘
                                └──< event_log  (append-only, all entities)
```

### 4.2 Cardinality rules

- A **project** may have zero buildings (single address) or many.
- A **building** may have zero stairwells; apartments then hang directly off the building via
  `stairwell_id = NULL`.
- An **apartment** belongs to exactly one project and at most one stairwell. `unit_number` is
  unique per project (case-insensitive, trimmed).
- A **step** belongs to a project and either to one apartment (`apartment_id` set) or to the
  project as a whole (`apartment_id IS NULL`, e.g. "Schakt utfört").
- **Photos, documents, measurements, materials** may attach to a step, to an apartment, to
  both, or to the project only. At least one owner must be present (`CHECK`).
- **Signoffs** attach to an apartment (normal) or a project (whole-site handover).
- **event_log** rows are immutable and never deleted.

### 4.3 Identity

- All primary keys are **UUID v4** (`gen_random_uuid()`), generated on the client for
  offline-created rows. Integer sequences are forbidden: two offline devices would collide.
- Human-facing ordering uses `sort_order` plus `created_at`, never the primary key.

### 4.4 Multi-tenancy

Single-tenant deployment today (one company, one database). Rows are *not* partitioned by
company. If a second company ever needs the app, add `org_id` to `projects`,
`step_templates`, `users` and extend RLS; nothing else in the model changes.

---

## 5. Database schema

Postgres 15+ via Supabase. Migrations live in `supabase/migrations/*.sql` and are the
**only** source of schema truth — no hand edits in the dashboard.

### 5.0 Extensions and enums

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email

CREATE TYPE user_role          AS ENUM ('tekniker','arbetsledare','admin');
CREATE TYPE project_status     AS ENUM ('aktiv','pausad','avslutad');
CREATE TYPE project_type       AS ENUM ('fiber_apartment','cat6','ovrigt');
CREATE TYPE pause_reason        AS ENUM ('vantar_kund','vantar_material','vantar_entreprenor',
                                         'vader','atkomst_nekad','annat');
CREATE TYPE apartment_status    AS ENUM ('ej_paborjad','pagaende','klar','signerad');
CREATE TYPE step_status         AS ENUM ('ej_paborjad','pagaende','klar','ej_aktuellt');
CREATE TYPE document_category   AS ENUM ('ritning','protokoll','foljesedel','matprotokoll',
                                         'egenkontroll','avvikelse','ovrigt');
CREATE TYPE measurement_type    AS ENUM ('otdr','effekt','kontinuitet','dampning');
CREATE TYPE signer_role         AS ENUM ('hyresgast','tekniker','forvaltare','kund');
```

`ej_aktuellt` is **not** a synonym for "done". It requires `skip_reason` and is reported
separately in exports and in the PDF protocol, so a skipped step never hides inside a
100 % progress bar.

### 5.1 Shared column conventions

Every mutable business table carries:

```sql
  version     integer     NOT NULL DEFAULT 1,
  created_by  uuid        REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
```

- `version` is incremented by trigger on every `UPDATE`; clients send the version they read
  (see §7.3).
- `deleted_at` implements soft delete; all normal queries filter `deleted_at IS NULL` through
  views, and partial unique indexes ignore deleted rows.
- `updated_at` is maintained by a single trigger function, never by the client.

```sql
CREATE OR REPLACE FUNCTION touch_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version    := COALESCE(OLD.version, 1) + 1;
  RETURN NEW;
END $$;

-- applied to every business table that carries version/updated_at
CREATE TRIGGER touch_projects      BEFORE UPDATE ON projects        FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER touch_buildings     BEFORE UPDATE ON buildings       FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER touch_stairwells    BEFORE UPDATE ON stairwells      FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER touch_apartments    BEFORE UPDATE ON apartments      FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER touch_steps         BEFORE UPDATE ON steps           FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER touch_measurements  BEFORE UPDATE ON measurements    FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER touch_step_templates BEFORE UPDATE ON step_templates FOR EACH ROW EXECUTE FUNCTION touch_row();
```

`updated_at` is what the pull cursor reads (§7.6), so **every** write path — including triggers
that derive values — must bump it. A row that changes without bumping `updated_at` is invisible
to other devices, which is the worst kind of sync bug: silent and permanent.

### 5.2 Users and membership

```sql
CREATE TABLE users (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_sub  text UNIQUE NOT NULL,
  email       citext UNIQUE NOT NULL,
  full_name   text,
  phone       text,
  role        user_role NOT NULL DEFAULT 'tekniker',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE project_members (
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role        user_role NOT NULL DEFAULT 'tekniker',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
```

`google_sub` is the OIDC `sub` claim, the only stable identity key. Email can change; `sub`
cannot. A user is created/invited by an admin and matched on first login.

### 5.3 Projects

```sql
CREATE TABLE projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text          NOT NULL CHECK (length(btrim(name)) > 0),
  project_type  project_type  NOT NULL DEFAULT 'fiber_apartment',
  customer      text,
  address       text,
  contact_name  text,
  contact_phone text,
  status        project_status NOT NULL DEFAULT 'aktiv',

  -- pause block (see §6.1)
  paused_reason pause_reason,
  paused_note   text,
  paused_at     timestamptz,
  resume_on     date,
  resume_note   text,

  -- close block
  closed_at     timestamptz,
  closed_by     uuid REFERENCES users(id),
  close_note    text,

  version    integer     NOT NULL DEFAULT 1,
  created_by uuid        NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CONSTRAINT pause_fields_consistent CHECK (
    (status = 'pausad' AND paused_reason IS NOT NULL AND paused_at IS NOT NULL)
    OR (status <> 'pausad' AND paused_reason IS NULL AND paused_at IS NULL)
  ),
  CONSTRAINT close_fields_consistent CHECK (
    (status = 'avslutad' AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
    OR (status <> 'avslutad')
  )
);

CREATE INDEX projects_status_idx ON projects (status) WHERE deleted_at IS NULL;
CREATE INDEX projects_resume_idx ON projects (resume_on)
  WHERE status = 'pausad' AND deleted_at IS NULL;
CREATE INDEX projects_updated_idx ON projects (updated_at);
```

The `CHECK` constraints are the last line of defence: a paused project without a reason
cannot exist, even if a client bug tries to write one.

### 5.4 Buildings, stairwells and apartments

```sql
CREATE TABLE buildings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 text NOT NULL,                 -- 'Hus 1'
  property_designation text,                          -- 'Stockholm Granen 12'
  address              text,
  sort_order           integer NOT NULL DEFAULT 0,
  version    integer     NOT NULL DEFAULT 1,
  created_by uuid        REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE stairwells (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name        text NOT NULL,                          -- 'A', 'B', 'Uppgång 1'
  sort_order  integer NOT NULL DEFAULT 0,
  version     integer     NOT NULL DEFAULT 1,
  created_by  uuid        REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE apartments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  building_id   uuid REFERENCES buildings(id)  ON DELETE SET NULL,
  stairwell_id  uuid REFERENCES stairwells(id) ON DELETE SET NULL,
  unit_number   text NOT NULL,                        -- '1001', 'B-1203'
  floor         integer,
  label         text,                                 -- printed door label text
  qr_token      text UNIQUE,                          -- token embedded in the printed QR
  status        apartment_status NOT NULL DEFAULT 'ej_paborjad',
  notes         text,
  completed_at  timestamptz,
  completed_by  uuid REFERENCES users(id),
  signed_at     timestamptz,
  sort_order    integer NOT NULL DEFAULT 0,
  version    integer     NOT NULL DEFAULT 1,
  created_by uuid        REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (length(btrim(unit_number)) > 0)
);

CREATE UNIQUE INDEX apartments_unit_unique
  ON apartments (project_id, lower(btrim(unit_number)))
  WHERE deleted_at IS NULL;

CREATE INDEX apartments_project_idx ON apartments (project_id, sort_order)
  WHERE deleted_at IS NULL;
CREATE INDEX apartments_status_idx  ON apartments (project_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX apartments_qr_idx      ON apartments (qr_token)
  WHERE deleted_at IS NULL;
```

**`apartments.status` and `signed_at` are denormalised.** They are recomputed by trigger
whenever a step or sign-off changes, so the phone can sort and filter 40 units without
joining steps, and the Excel export gets a cheap column. They must never be set by a client.

### 5.5 Checklist templates and steps

```sql
CREATE TABLE step_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  project_type project_type,                          -- NULL = usable for any type
  is_default   boolean NOT NULL DEFAULT false,
  is_archived  boolean NOT NULL DEFAULT false,
  version    integer     NOT NULL DEFAULT 1,
  created_by uuid        REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE step_template_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id          uuid NOT NULL REFERENCES step_templates(id) ON DELETE CASCADE,
  category             text NOT NULL,                 -- 'NOD'
  subcategory          text,                          -- 'ODF'
  title                text NOT NULL,                 -- 'Fiber svetsad till ODF'
  per_apartment        boolean NOT NULL DEFAULT false,-- true = copied per apartment
  requires_photo       boolean NOT NULL DEFAULT false,
  requires_measurement boolean NOT NULL DEFAULT false,
  sort_order           integer NOT NULL DEFAULT 0,
  deleted_at           timestamptz
);

CREATE TABLE steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  apartment_id     uuid REFERENCES apartments(id) ON DELETE CASCADE,
  template_item_id uuid REFERENCES step_template_items(id) ON DELETE SET NULL,
  category         text NOT NULL,
  subcategory      text,
  title            text NOT NULL,
  status           step_status NOT NULL DEFAULT 'ej_paborjad',
  skip_reason      text,
  comment          text,                              -- latest note; history in step_revisions
  requires_photo       boolean NOT NULL DEFAULT false,
  requires_measurement boolean NOT NULL DEFAULT false,
  completed_at     timestamptz,
  completed_by     uuid REFERENCES users(id),
  sort_order       integer NOT NULL DEFAULT 0,
  version    integer     NOT NULL DEFAULT 1,
  created_by uuid        REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT skip_needs_reason CHECK (status <> 'ej_aktuellt' OR skip_reason IS NOT NULL),
  CONSTRAINT done_needs_stamp  CHECK (status <> 'klar' OR completed_at IS NOT NULL)
);

CREATE INDEX steps_project_idx   ON steps (project_id, apartment_id, sort_order)
  WHERE deleted_at IS NULL;
CREATE INDEX steps_apartment_idx ON steps (apartment_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE step_revisions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id    uuid NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  body       text NOT NULL,
  author_id  uuid REFERENCES users(id),
  device_id  text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Notes are append-only.** `steps.comment` holds the latest text for cheap display and
export; `step_revisions` keeps every version with author and device. Two technicians
writing a note offline both survive — nothing is overwritten.

**Creating a project from a template** copies `step_template_items` into two sets of rows:
one project-level set (`apartment_id IS NULL`, categories like `Kanalisation`, `NOD`) and,
once apartments exist, one per-unit set (categories like `Lägenhetsinstallationer`). A
template item is flagged `per_apartment` to decide which. Copying is explicit and happens in
one transaction, so a 40-unit project creates ~1 500 step rows in one round-trip.

### 5.6 Photos, documents, measurements

```sql
CREATE TABLE photos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_id          uuid REFERENCES steps(id)        ON DELETE SET NULL,
  apartment_id     uuid REFERENCES apartments(id)   ON DELETE SET NULL,
  storage_path     text NOT NULL,          -- annotated image shown in the app
  original_path    text NOT NULL,          -- untouched original, never modified
  thumb_path       text,
  mime             text NOT NULL DEFAULT 'image/jpeg',
  width            integer,
  height           integer,
  bytes            bigint,
  caption          text,
  taken_at         timestamptz NOT NULL,   -- device clock at shutter
  uploaded_at      timestamptz,
  captured_lat     double precision,
  captured_lng     double precision,
  gps_accuracy_m   double precision,
  uploader_id      uuid NOT NULL REFERENCES users(id),
  device_id        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX photos_project_idx ON photos (project_id) WHERE deleted_at IS NULL;
CREATE INDEX photos_step_idx    ON photos (step_id)    WHERE deleted_at IS NULL;

CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_id       uuid REFERENCES steps(id)      ON DELETE SET NULL,
  apartment_id  uuid REFERENCES apartments(id) ON DELETE SET NULL,
  category      document_category NOT NULL DEFAULT 'ovrigt',
  title         text NOT NULL,
  revision      text,                       -- drawing revision 'B'
  storage_path  text NOT NULL,
  original_name text,
  mime          text,
  bytes         bigint,
  uploaded_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX documents_project_idx ON documents (project_id, category)
  WHERE deleted_at IS NULL;

CREATE TABLE measurements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  apartment_id      uuid REFERENCES apartments(id) ON DELETE SET NULL,
  step_id           uuid REFERENCES steps(id)      ON DELETE SET NULL,
  link_id           text,                  -- 'LGH1001-A', ODF port, cable id
  measurement_type  measurement_type NOT NULL DEFAULT 'dampning',
  wavelength_nm     integer,               -- 1310, 1550, 850…
  length_m          numeric(8,2),
  splice_count      integer,               -- used by the budget formula (§6.4)
  connector_count   integer,
  value_db          numeric(6,2),
  budget_db         numeric(6,2),
  passed            boolean,               -- computed, see §6.4
  instrument        text,                  -- 'EXFO MaxTester'
  instrument_serial text,
  method            text,                  -- '1-kabel', 'skarvade', 'OTDR 2-punkt'
  measured_at       timestamptz NOT NULL,
  measured_by       uuid REFERENCES users(id),
  notes             text,
  document_id       uuid REFERENCES documents(id) ON DELETE SET NULL,
  version    integer     NOT NULL DEFAULT 1,
  created_by uuid        REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX measurements_project_idx ON measurements (project_id)
  WHERE deleted_at IS NULL;
```

**Photo integrity rule:** `original_path` is written once and never overwritten. Markup
produces a second object at `storage_path`. Deleting "the" photo soft-deletes the row and
keeps both objects until purge, so a disputed image can always be produced.

### 5.7 Visits, materials, sign-offs, audit log

```sql
CREATE TABLE visits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  apartment_id uuid REFERENCES apartments(id) ON DELETE SET NULL,
  user_id      uuid NOT NULL REFERENCES users(id),
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz,
  start_lat    double precision,
  start_lng    double precision,
  end_lat      double precision,
  end_lng      double precision,
  note         text,
  device_id    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX visits_open_idx ON visits (user_id) WHERE ended_at IS NULL AND deleted_at IS NULL;
CREATE INDEX visits_project_idx ON visits (project_id) WHERE deleted_at IS NULL;

CREATE TABLE materials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  apartment_id uuid REFERENCES apartments(id) ON DELETE SET NULL,
  step_id      uuid REFERENCES steps(id) ON DELETE SET NULL,
  article      text NOT NULL,
  quantity     numeric(10,2) NOT NULL CHECK (quantity > 0),
  unit         text NOT NULL DEFAULT 'st',          -- st, m, rulle, ask
  unit_price   numeric(10,2),
  billable     boolean NOT NULL DEFAULT true,
  supplier     text,
  notes        text,
  added_by     uuid REFERENCES users(id),
  added_at     timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE signoffs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  apartment_id   uuid REFERENCES apartments(id) ON DELETE CASCADE,
  signer_name    text NOT NULL,
  signer_role    signer_role NOT NULL DEFAULT 'hyresgast',
  signature_path text,                      -- PNG in storage, 1 bit stroke capture
  signed_at      timestamptz NOT NULL,
  present        boolean NOT NULL DEFAULT true,   -- tenant was physically present
  comment        text,
  document_id    uuid REFERENCES documents(id) ON DELETE SET NULL,  -- generated PDF
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE INDEX signoffs_apartment_idx ON signoffs (apartment_id)
  WHERE deleted_at IS NULL;

CREATE TABLE event_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op_id       uuid UNIQUE NOT NULL,          -- client-generated, idempotency key
  entity      text NOT NULL,                  -- 'project', 'step', 'photo'…
  entity_id   uuid NOT NULL,
  action      text NOT NULL,                  -- 'project.paused'
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_version integer,
  user_id     uuid REFERENCES users(id),
  device_id   text,
  client_ts   timestamptz,                    -- device clock (may be wrong)
  server_ts   timestamptz NOT NULL DEFAULT now(),  -- authoritative
  project_id  uuid REFERENCES projects(id) ON DELETE SET NULL
              -- SET NULL, not CASCADE: audit history must outlive a project row
);

CREATE INDEX event_log_project_idx ON event_log (project_id, server_ts DESC);
CREATE INDEX event_log_entity_idx  ON event_log (entity, entity_id, server_ts DESC);
```

`event_log` answers "who paused this job and why, and when did it resume", including for
states that have since changed. `op_id` uniqueness makes a retried sync a no-op instead of a
duplicate row. `server_ts` is authoritative; `client_ts` is kept only to explain oddities
from a phone with a wrong clock.

### 5.8 Derived apartment status

```sql
CREATE OR REPLACE FUNCTION refresh_apartment_status(p_apartment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  total       int;
  cleared     int;
  v_status    apartment_status;
  v_completed timestamptz;
BEGIN
  SELECT count(*) FILTER (WHERE deleted_at IS NULL),
         count(*) FILTER (WHERE deleted_at IS NULL AND status IN ('klar','ej_aktuellt'))
    INTO total, cleared
    FROM steps WHERE apartment_id = p_apartment;

  v_status := (CASE
      WHEN EXISTS (SELECT 1 FROM signoffs s
                    WHERE s.apartment_id = p_apartment AND s.deleted_at IS NULL) THEN 'signerad'
      WHEN total = 0 THEN 'ej_paborjad'
      WHEN cleared = total THEN 'klar'
      WHEN cleared > 0 THEN 'pagaende'
      ELSE 'ej_paborjad'
    END)::apartment_status;

  SELECT a.completed_at INTO v_completed FROM apartments a WHERE a.id = p_apartment;
  IF v_status IN ('klar','signerad') THEN
    v_completed := COALESCE(v_completed, now());
  ELSE
    v_completed := NULL;                    -- un-ticking a step clears the completion stamp
  END IF;

  -- no-op guard: only touch the row when something actually changed, so the
  -- touch_apartments trigger does not create pull noise for every unrelated edit
  UPDATE apartments a
     SET status = v_status, completed_at = v_completed
   WHERE a.id = p_apartment
     AND (a.status IS DISTINCT FROM v_status
          OR a.completed_at IS DISTINCT FROM v_completed);
END $$;

CREATE OR REPLACE FUNCTION trg_steps_refresh_apartment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.apartment_id IS NOT NULL THEN PERFORM refresh_apartment_status(NEW.apartment_id); END IF;
  IF TG_OP = 'UPDATE' AND OLD.apartment_id IS DISTINCT FROM NEW.apartment_id
     AND OLD.apartment_id IS NOT NULL THEN
    PERFORM refresh_apartment_status(OLD.apartment_id);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER steps_refresh_apartment
AFTER INSERT OR UPDATE OF status, deleted_at, apartment_id ON steps
FOR EACH ROW EXECUTE FUNCTION trg_steps_refresh_apartment();
```

"`ej_aktuellt` counts as cleared" is deliberate: a step that does not apply cannot block a
handover forever — but it stays visible as its own status in every report, so it can't hide.

### 5.9 Row level security

RLS is the security boundary. Client code never filters for security reasons.

```sql
ALTER TABLE projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE steps            ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials        ENABLE ROW LEVEL SECURITY;
ALTER TABLE signoffs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE buildings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stairwells       ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_templates   ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION my_role() RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM users WHERE id = auth.uid() AND deleted_at IS NULL AND is_active
$$;

CREATE OR REPLACE FUNCTION is_supervisor() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(my_role() IN ('arbetsledare','admin'), false)
$$;

CREATE OR REPLACE FUNCTION on_project(p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM project_members m
                  WHERE m.project_id = p AND m.user_id = auth.uid())
      OR is_supervisor()
$$;

-- Projects
CREATE POLICY projects_read   ON projects FOR SELECT
  USING (on_project(id) AND deleted_at IS NULL);
CREATE POLICY projects_write  ON projects FOR UPDATE
  USING (is_supervisor() OR on_project(id))
  WITH CHECK (is_supervisor() OR on_project(id));
CREATE POLICY projects_insert ON projects FOR INSERT
  WITH CHECK (is_supervisor());

-- Child tables all follow the same shape, e.g. steps
CREATE POLICY steps_read ON steps FOR SELECT USING (on_project(project_id));
CREATE POLICY steps_write ON steps FOR ALL
  USING (on_project(project_id)) WITH CHECK (on_project(project_id));
```

**Notes**

- `tekniker` may write steps/photos/notes on their own projects — that is the job.
- Project insert/close/reopen is enforced in app logic **and** by a `BEFORE UPDATE` trigger
  that checks `my_role()` for status transitions (see §6.1), because RLS cannot express
  column-level transition rules.
- `event_log` is insert-only: **no** `UPDATE`/`DELETE` policies exist, so even an admin
  cannot rewrite history from the client.
- `users` is readable to all authenticated users (needed to show "changed by Karl"), but
  only admins may update roles.

### 5.10 Storage buckets

| Bucket | Path convention | Public | Write policy |
|---|---|---|---|
| `photos` | `projects/<project_id>/<apartment_id or "project">/<photo_id>_annotated.jpg`<br>`…_original.jpg`<br>`…_thumb.jpg` | no | project member |
| `documents` | `projects/<project_id>/<category>/<document_id>_<original_name>` | no | project member |
| `signatures` | `projects/<project_id>/signoffs/<signoff_id>.png` | no | project member |
| `exports` | `exports/projekt-export-latest.xlsx`<br>`exports/archive/projekt-export-<ts>.xlsx` | no | service role only |

- Reads use **short-lived signed URLs** (60 min) generated in the app; the PWA caches the
  compressed blob locally so a re-render offline never needs a URL.
- The `exports` bucket is written by the scheduled job using the service-role key, never by a
  client. Its path is stable so a macro/postman/bookmark always hits the same object.
- Uploads are capped by bucket policy: images 8 MB, documents 25 MB.

---

## 6. State machines

### 6.1 Project lifecycle

```
            ┌──────────────── pause (reason required) ────────────────┐
            ▼                                                        │
        ┌────────┐                                              ┌──────────┐
   ───► │ aktiv  │ ◄──────────── resume ─────────────────────── │  pausad  │
        └────────┘                                              └──────────┘
            │   ▲                                                    │
   close    │   │ reopen (admin only)                               │ close
            ▼   │                                                    ▼
        ┌──────────────────── avslutad ◄──────────────────────────────┘
        └────────────────────
```

| From | To | Who | Required input | Effect |
|---|---|---|---|---|
| `aktiv` | `pausad` | any member | `paused_reason` (enum), optional `paused_note`, optional `resume_on`, `resume_note` | `paused_at = now()`; event `project.paused` |
| `pausad` | `aktiv` | any member | — | pause fields cleared; previous values preserved in `event_log`; event `project.resumed` |
| `aktiv` | `avslutad` | supervisor | all apartments `klar`/`signerad`, **or** `close_note` (admin override) | `closed_at`, `closed_by`; event `project.closed` |
| `pausad` | `avslutad` | supervisor | same as above | same |
| `avslutad` | `aktiv` | admin | reason in `close_note` | `closed_at/by` cleared, kept in history; event `project.reopened` |

**Rules enforced server-side** (trigger `enforce_project_transition`, `BEFORE UPDATE OF status`):

1. A move to `pausad` without `pause_reason` raises `P0001` with the Swedish message
   `"Pausorsak krävs"`.
2. A move to `avslutad` by a `tekniker` raises `"Endast arbetsledare kan avsluta projekt"`.
3. A move to `avslutad` while units remain open requires non-empty `close_note`, and only
   `admin` may supply it.
4. A move out of `avslutad` requires `my_role() = 'admin'`.
5. Any transition writes an `event_log` row from the trigger itself, so a change made through
   SQL or a script is still audited.

**Why `paused` is a state and not a flag on `status='aktiv'`:** paused jobs must vanish from
"Dagens jobb" (or technicians will keep driving to them) while remaining visible in a
follow-up list with a resume date. A boolean can't do either.

### 6.2 Apartment status

Derived only — never client-set (see §5.8).

| Status | Condition |
|---|---|
| `ej_paborjad` | no steps, or no step cleared |
| `pagaende` | at least one step cleared, not all |
| `klar` | all non-deleted steps are `klar` or `ej_aktuellt` |
| `signerad` | a non-deleted `signoffs` row exists for the unit (overrides `klar`) |

`ej_aktuellt` counts towards completion but is counted and displayed separately in every
report and in the Excel export (`antal_ej_aktuellt`).

### 6.3 Step lifecycle

| From | To | Notes |
|---|---|---|
| `ej_paborjad` | `pagaende` | first interaction (comment, photo, or partial work) |
| `ej_paborjad` / `pagaende` | `klar` | sets `completed_at`, `completed_by`; blocked if `requires_photo`/`requires_measurement` unmet |
| `klar` | `pagaende` | un-ticking is allowed — mistakes happen; logged |
| any | `ej_aktuellt` | requires `skip_reason`; blocked for steps with `requires_measurement = true` unless reason is `monteras_ej` |
| `ej_aktuellt` | `ej_paborjad` | when the situation changes |

**Requirement gate:** pressing *Klar* on a step with `requires_photo` and zero photos shows
`"Foto krävs för det här steget"` and offers "Ta foto nu" or "Ej aktuellt" — it never blocks
silently, and it never completes falsely.

### 6.4 Measurement result

`passed` is computed, never entered:

```
estimated_budget_db = length_km * attenuation_db_per_km[category][wavelength]
                    + 0.10 * splice_count
                    + 0.30 * connector_count
budget_db           = max(estimated_budget_db, project_budget_override)
passed              = value_db <= budget_db
```

- Attenuation defaults: single-mode 1310 nm `0.35 dB/km`, 1550 nm `0.20 dB/km`; multimode
  850 nm `3.0 dB/km`. Overridable per project (`projects` extra column in Phase 2 migration).
- Splice count and connector count come from the measurement form (default 2 connectors).
- The app shows `GODKÄNT` / `EJ GODKÄNT` with the numbers behind it, and warns when
  `value_db` is within 0.5 dB of the budget (`"nära gränsen"`) — that margin is where a
  future fault usually starts.
- Recomputing `passed` on edit is mandatory; a stale result is worse than no result.

### 6.5 Photo lifecycle (client-side)

```
kamerabild → komprimerad (2000 px, q85) → [markerad?] → köad → uppladdad → verifierad
```

| State | Stored where | Shown as |
|---|---|---|
| captured (compressed) | IndexedDB blob | `"Väntar på uppladdning"` badge |
| marked up | IndexedDB blob (second blob: annotated) | normal thumbnail |
| queued | outbox row + blob | badge with retry count |
| uploaded | Supabase Storage + `photos` row | normal |
| verified | size/mime checked after upload | normal |

Failure (offline, 4xx, 5xx) never deletes the blob. Only a **manual** delete or a successful
upload followed by server-side soft delete removes it locally.

### 6.6 Sync operation lifecycle

```
köad ──► skickad ──► tillämpad
                  └─► konflikt ──► (auto-merge | användaren väljer) ──► tillämpad
                  └─► fel (retry med backoff, max 5) ──► misslyckad (visas i Synkstatus)
```

`misslyckad` is not silent: the row stays in the outbox, the sync badge turns amber, and the
affected screen shows `"Ej synkat"`. Nothing is ever dropped to make the UI look clean.

---

## 7. Offline sync contract

### 7.1 Local store (Dexie / IndexedDB)

The phone holds a **mirror of the projects the user has opened**, never the whole database.

```ts
// src/db/schema.ts
export class FieldDB extends Dexie {
  projects!:  Table<LocalProject>;
  apartments!:Table<LocalApartment>;
  steps!:     Table<LocalStep>;
  photos!:    Table<LocalPhoto>;      // metadata + blobs in a separate store
  documents!: Table<LocalDocument>;
  measurements!: Table<LocalMeasurement>;
  materials!: Table<LocalMaterial>;
  visits!:    Table<LocalVisit>;
  signoffs!:  Table<LocalSignoff>;
  templates!: Table<LocalTemplateItem>;
  outbox!:    Table<OutboxOp>;
  blobs!:     Table<LocalBlob>;       // { id, opId, kind: 'original'|'annotated'|'thumb'|'signature', blob }
  meta!:      Table<MetaRow>;         // sync cursor, device id, last pull, schema version

  constructor() {
    super('fielddb');
    this.version(1).stores({
      projects:   'id, updated_at, status, resume_on',
      apartments: 'id, project_id, [project_id+status], unit_number, updated_at',
      steps:      'id, project_id, apartment_id, [apartment_id+status], updated_at, status',
      photos:     'id, project_id, apartment_id, step_id, updated_at',
      documents:  'id, project_id, category, updated_at',
      measurements:'id, project_id, apartment_id, updated_at',
      materials:  'id, project_id, apartment_id',
      visits:     'id, project_id, user_id, started_at',
      signoffs:   'id, project_id, apartment_id',
      templates:  'id, template_id, sort_order',
      outbox:     '++seq, op_id, entity, entity_id, status, next_attempt_at, created_at',
      blobs:      'id, opId, kind',
      meta:       'key',
    });
  }
}
```

Every local row carries `_dirty: 'pending' | 'synced' | 'conflict'` (for UI badges) and the
server `version` it was based on.

### 7.2 Operation envelope

Every local mutation writes exactly one outbox row, in the **same IndexedDB transaction** as
the data change. No mutation exists without an op, and no op exists without a mutation.

```ts
interface OutboxOp {
  seq: number;               // local monotonic order (Dexie auto-increment)
  op_id: string;             // uuid v4, idempotency key, generated once
  entity: EntityName;        // 'project' | 'step' | 'photo' | ...
  entity_id: string;         // uuid
  type: 'insert' | 'update' | 'delete' | 'restore' | 'upload';
  payload: Record<string, unknown>;   // changed columns only for 'update'
  base_version: number | null;        // null for insert
  device_id: string;         // stable per install, uuid in meta
  client_ts: string;         // ISO 8601 with offset
  project_id: string;        // routing + audit
  status: 'queued'|'sending'|'applied'|'conflict'|'failed';
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  requires_blob?: string;    // blob id that must upload before/after this op
}
```

Wire format (JSON, one call per batch):

```json
{
  "device_id": "0e7c…",
  "app_version": "1.4.2",
  "ops": [
    {
      "op_id": "5b0e…",
      "entity": "project",
      "entity_id": "a1f3…",
      "type": "update",
      "payload": { "status": "pausad", "paused_reason": "vantar_material",
                   "paused_note": "Väntar på 24-fiberkabel", "resume_on": "2026-11-03" },
      "base_version": 7,
      "device_id": "0e7c…",
      "client_ts": "2026-10-22T09:14:03+02:00",
      "project_id": "a1f3…"
    }
  ]
}
```

### 7.3 Push protocol

`POST /functions/v1/sync-push` (Supabase Edge Function, service-role DB access, JWT verified).

1. **Authenticate** the JWT, resolve `user_id`, reject inactive/deleted users.
2. **Auth check per op**: `on_project(op.project_id)` must be true, else `403 op_rejected`
   (op marked `failed`, never retried).
3. **Deduplicate**: `INSERT INTO event_log (op_id, …) ON CONFLICT (op_id) DO NOTHING`.
   If the insert affected 0 rows, the op already ran → return its recorded result
   (`status: 'applied'`, current `version`). This makes retries harmless.
4. **Apply** in one transaction per op:
   - `insert` → `INSERT … ON CONFLICT (id) DO NOTHING`, then read back the row.
   - `update` → `UPDATE t SET <payload>, updated_by=$user WHERE id=$id AND version=$base`.
   - `delete` → `UPDATE t SET deleted_at = now(), updated_by=$user WHERE id=$id`.
   - `restore` → `UPDATE t SET deleted_at = NULL, updated_by=$user WHERE id=$id`.
5. **Version conflict**: if the `UPDATE` matched 0 rows, load the current row and respond
   `409` with `{ status:'conflict', current: {...} }`. The client decides per the merge table
   in §7.5 — the server never guesses.
6. **Respond per op** with `{ op_id, status, version, updated_at }` or an error code.

Batching: up to 50 ops per request, ordered by `seq`. If one op in the batch conflicts, the
rest still apply (each op is its own transaction); the response array is positional by `op_id`.

### 7.4 Operation catalogue

| entity | types | notes |
|---|---|---|
| `project` | insert, update, delete, pause, resume, close, reopen | `pause/resume/close/reopen` are `update` op types with a mandatory `action` in payload; they exercise the §6.1 trigger |
| `building`, `stairwell` | insert, update, delete | |
| `apartment` | insert, update, delete, restore, bulk_insert | `bulk_insert` payload = `{ units: [...] }` |
| `step` | insert, update, delete, bulk_insert | `update` payload minimal: `{ status }`, `{ comment }` |
| `step_revision` | insert | append-only |
| `photo` | insert (after upload), update (caption), delete | file uploaded separately, op references `storage_path` |
| `document` | insert (after upload), delete | |
| `measurement` | insert, update, delete | `passed` recomputed server-side too |
| `material` | insert, update, delete | |
| `visit` | insert, update (end visit) | |
| `signoff` | insert, delete | signature PNG uploaded first |

### 7.5 Merge policy (conflict resolution)

The unit of conflict is **(entity, field group)**, not the row. A row-level "last write wins"
would lose a colleague's comment because someone else ticked a different box two minutes later.

| Field group | Example fields | Policy |
|---|---|---|
| Status ticks | `steps.status`, `steps.completed_at/by` | **LWW per field** by `server_ts`. Ticking is a deliberate act; the latest wins. |
| Comments / notes | `steps.comment`, `step_revisions.body`, `apartments.notes` | **Keep both.** Every note is appended as a revision; `comment` = newest. |
| Measurements | `measurements.*` | **Never auto-merge.** Any concurrent edit opens a side-by-side prompt. |
| Photos / documents | `photos`, `documents` | **Append-only.** No conflicts possible; deletes are soft. |
| Captions / titles | `photos.caption`, `documents.title` | LWW, because it's cosmetic. |
| Sign-offs | `signoffs.*` | Never auto-merge; a signature is a legal act. Prompt. |
| Project pause/close | `projects.status` + pause/close block | **Never auto-merge.** Prompt: "Projektet ändrades av Karl medan du var offline." |
| Materials / visits | `materials.*`, `visits.*` | LWW per field; quantities prompt if both changed. |
| Assignment | `project_members` | Supervisor wins; technician sees the change on next pull. |

**Conflict UI** (never a toast that disappears):

```
┌────────────────────────────────────────┐
│ ⚠ Konflikt: Steg "Svetsning i ODF"      │
│                                        │
│ Karl ändrade detta 09:12               │
│   Status: klar                         │
│ Du ändrade detta 09:14                 │
│   Status: ej_aktuellt                  │
│                                        │
│ [ Behåll min ] [ Använd Karls ] [ Se ] │
└────────────────────────────────────────┘
```

Resolution writes a new op with the **current** `base_version`, so the resolution itself is
syncable and auditable. Choices are stored in `event_log` as `conflict.resolved`.

### 7.6 Pull protocol

`POST /functions/v1/sync-pull` with `{ project_ids: string[], cursor: string }`.

```sql
-- per table, per project
SELECT * FROM steps
 WHERE project_id = ANY($1)
   AND updated_at > $2
 ORDER BY updated_at
 LIMIT 1000;
```

- Cursor = max `updated_at` seen, stored per device in `meta.last_pull_cursor` (per project
  in `meta['cursor:'||project_id]`). Server time, never device time.
- Deletions are pulled as rows with `deleted_at` set (soft delete is part of the mirror), so
  the client can show "Borttagen av Karl" instead of silently losing data.
- A full resync (`cursor = '1970-01-01'`) is available in Settings and is the recovery path
  after a schema bump.
- Pull is **read-only w.r.t. the outbox**. Local dirty rows are not overwritten; the pull
  writes into `conflicts` if a dirty row's `base_version` is older than the incoming version.

### 7.7 Realtime

- Supabase Realtime subscription on `steps`, `apartments`, `projects` filtered by
  `project_id` for the project currently open.
- Realtime is a **fast path only**: it triggers the same pull handler, and everything works
  without it (a 60 s timer and app-foreground event also pull).
- A technician with no signal is never "broken" by missing realtime events.

### 7.8 Offline authentication

- Supabase JWT (access + refresh) is persisted; the app works with an expired access token
  and refreshes on reconnect.
- **Grace period: 14 days** offline. After that the app opens read-only with a banner
  `"Logga in igen för att fortsätta"` — local data is *not* deleted, and the outbox is
  preserved, because deleting unsynced field work is unacceptable.
- Sign-out with a non-empty outbox warns: `"Du har 12 ändringar som inte är synkade."` and
  requires explicit confirmation.

### 7.9 Ordering and failure matrix

Upload ordering rules:

1. Text ops for a project first (they are small and make the job correct on other devices).
2. Then photo/document/signature **blobs**, one at a time, in capture order.
3. Then the `photo`/`document`/`signoff` insert ops that reference the uploaded paths.

| Failure | Client reaction |
|---|---|
| Offline / DNS / timeout | op stays `queued`, exponential backoff `2s, 8s, 30s, 2m, 10m`, retry on reconnect/foreground |
| `401` (token expired) | refresh token; if refresh fails → read-only mode, outbox intact |
| `403` (not a member) | op → `failed`, banner `"Du har inte längre åtkomst till projektet"` |
| `409` conflict | op → `conflict`, row flagged, UI prompt per §7.5 |
| `422`/`400` validation | op → `failed`, show server message, keep payload for manual fix |
| `5xx` | retry with backoff, max 5 attempts, then `failed` + amber badge |
| Quota exceeded (storage) | pause photo uploads, keep text sync, banner with link to Synkstatus |
| Client crash mid-upload | op re-sent with same `op_id`; server dedupes; orphan blob overwritten by same path |
| Two devices create the same unit number | second insert fails unique index → client converts to "unit already exists" prompt, no data loss |

**Nothing is ever silently discarded.** The Synkstatus screen lists every op that isn't
`applied`, with entity, action, attempts and last error.

---

## 8. Screens and flows

### 8.0 Global chrome

- Bottom tab bar (thumb zone, always visible, 4 items):
  `Idag` · `Projekt` · `Sök` · `Mer`
- Top bar: project name (when inside a project), sync badge, overflow menu.
- **Sync badge** (persistent, top right):
  `● Synkat 09:14` / `◐ 3 väntar` / `▲ 2 misslyckade` / `✕ Offline`. Tapping it opens S14.
- Every destructive action is either undoable (snackbar, 10 s) or confirmed with an explicit
  verb button (`"Radera steg"`, never `"OK"`).
- All numbers are right-aligned; all dates use `YYYY-MM-DD` in dense lists and `"22 okt"` in
  prose. Times render in **Europe/Stockholm** through one utility (`formatSthlm()`); nothing
  displays a raw UTC string.
- Minimum tap target 48×48 px, base font 16 px, no hover-only affordances.

### 8.1 Screen map

| # | Screen | Route | Primary job |
|---|---|---|---|
| S1 | Logga in | `/login` | Google sign-in, invitation check |
| S2 | Idag | `/` | What to do now; paused follow-ups |
| S3 | Projekt | `/projekt` | Find/create projects |
| S4 | Projektdetalj | `/projekt/:id` | Status, pause/close, progress, exports |
| S5 | Lägenheter | `/projekt/:id/lagenheter` | Unit grid, bulk add, jump to unit |
| S6 | Checklista | `/projekt/:id/lagenhet/:aid` | One-tap step completion |
| S7 | Steg | `…/steg/:sid` (sheet) | Note, photos, measurement, skip |
| S8 | Kamera | `…/foto` (fullscreen) | Capture, compress, mark up, caption |
| S9 | Mätning | `…/matning` (sheet) | Record dB with pass/fail |
| S10 | Material & tid | `/projekt/:id/material` | Log articles and visits |
| S11 | Överlämning | `…/overlamning` | Signature + protocol PDF |
| S12 | Dokument | `/projekt/:id/dokument` | Drawings, protocols, uploads |
| S13 | Sök | `/sok` | Offline search across everything |
| S14 | Mer | `/mer` | Inställningar, Synkstatus, Papperskorg, Export |

---

### S1 — Logga in

**Purpose:** get in with the least friction, on a phone, possibly with gloves on.

- Single button: `"Logga in med Google"`. No password form exists anywhere.
- The first user whose email matches `allowed_emails` becomes `admin`; everyone else must be
  pre-created by an admin (`users` row with email + role).
- Unknown email after OAuth → `"Ditt konto är inte inbjudet. Kontakta William."` with the
  email shown, so the fix is a one-line message rather than a support call.
- Once signed in, the app never asks again while the refresh token lives (see §7.8).
- Session exists + offline → straight to S2 with the offline badge.

**Ops emitted:** none (auth only).
**States:** idle · redirecting · not-invited · offline-with-session · sign-in-failed.

---

### S2 — Idag

**Purpose:** answer "where do I go and what do I do" in one glance, including jobs that are
waiting on someone else.

```
┌──────────────────────────────────────────┐
│ Idag                       ● Synkat 09:14│
├──────────────────────────────────────────┤
│ ⏱ Besök pågår · Granen 12                │
│    Startade 08:12 · 1 h 04 min  [Avsluta]│
├──────────────────────────────────────────┤
│ AKTIVA                                   │
│ ┌──────────────────────────────────────┐ │
│ │ Granen 12         12/40 lgh    30 %  │ │
│ │ Fiber till lägenhet · Hägersten      │ │
│ │ Senast: lgh 1004 · för 2 tim         │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ Björken 4          0/12 lgh     0 %  │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ PAUSADE · FÖLJ UPP                       │
│ ┌──────────────────────────────────────┐ │
│ │ Eken 7      Väntar material          │ │
│ │ 24-fiberkabel saknas                 │ │
│ │ Beräknat återupptag 2026-11-03       │ │
│ │ Pausad av William · 6 dagar sedan    │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ [ + Nytt projekt ]                       │
└──────────────────────────────────────────┘
```

- **Aktiva** sorted by last activity — the job you were just at is on top.
- **Pausade** shows reason in plain Swedish, the note, and `resume_on`. A paused job past its
  `resume_on` is amber with `"Dags att följa upp"`.
- Paused jobs are **not** hidden: a job waiting on material for three weeks is exactly the job
  that otherwise gets forgotten.
- `avslutade` projects live in S3, never here.
- An unfinished visit pins a sticky bar at the top with **Avsluta**; leaving one open across
  days silently corrupts time reporting.

**Ops emitted:** `visit.insert` (start), `visit.update` (end).
**States:** empty (`"Inga aktiva projekt. Skapa ett för att börja."`) · offline (mirror data,
`Offline` badge) · paused-past-resume · visit-open.

---

### S3 — Projekt

- Segmented filter: `Aktiva` / `Pausade` / `Avslutade` / `Alla`, plus a text filter over
  name, customer and address.
- Row: name, type chip (`Fiber` / `CAT6`), units done/total, status chip, last activity.
- `⋯` menu: `Öppna`, `Pausa`, `Avsluta`, `Exportera`, `Radera`.
- `+ Nytt projekt` (supervisor only) opens a sheet: name, type, customer, address, contact,
  template, buildings/stairwells, and **`Skapa lägenheter automatiskt`** with a range pattern
  (`1-4`, `01-12`, `1001-1004, 1101-1104`) so a 40-unit job is four lines of input, not forty
  rows.
- Creating a project offline is allowed: project, apartments and steps get client UUIDs and
  sync later. Two supervisors offline creating the *same* project yields two projects —
  accepted, and merged by hand (rare, and better than blocking field work).

**Ops emitted:** `project.insert`, `apartment.bulk_insert`, `step.bulk_insert`,
`project.update`, `project.delete`.
**States:** empty · filtered-empty · offline-create (badge `"Skapas lokalt"`).

---

### S4 — Projektdetalj

```
┌──────────────────────────────────────────┐
│ ‹ Projekt                    ● 3 väntar  │
│ Granen 12                                │
│ Fiber till lägenhet · Hägersten          │
│ [Pausad: Väntar material]  [Återuppta]   │
├──────────────────────────────────────────┤
│ 12 / 40 klara             4 signerade    │
│ ██████░░░░░░░░░░░░░░░░░░░░░░   30 %      │
│ 2 ej aktuellt                            │
├──────────────────────────────────────────┤
│ ⏸ Pausad 2026-10-16 av William           │
│ Orsak: Väntar material                   │
│ "24-fiberkabel saknas"                   │
│ Beräknat återupptag: 2026-11-03          │
│ [Ändra pausinfo]                         │
├──────────────────────────────────────────┤
│ Lägenheter             40 st          ›  │
│ Checklista (projekt)   18 steg        ›  │
│ Mätningar              12 st          ›  │
│ Material & tid          3 st          ›  │
│ Dokument                5 st          ›  │
│ Aktivitetslogg                        ›  │
├──────────────────────────────────────────┤
│ [ Exportera Excel ] [ Skapa protokoll ]  │
│ [ Avsluta projekt ]                      │
└──────────────────────────────────────────┘
```

- The pause block lives in the **header**, not a menu: a paused job must look paused at a
  glance, and the reason must be readable by whoever picks the job up next.
- `Återuppta` is one tap, no confirmation (it is reversible) and clears the pause fields.
- `Pausa` sheet: reason as six large chips (no dropdown), note, `resume_on` (default +14 days),
  `resume_note`.
- `Avsluta projekt` is disabled with an inline reason while units are open:
  `"12 lägenheter är inte klara."` Admin gets an override that requires a note.
- `Aktivitetslogg` renders `event_log` read-only: paused/resumed/closed/reopened, steps
  completed by others, contact changes. This is the "what happened while I was away" screen.
- Excel export runs **on the client** from the local mirror, so it works offline and produces
  the same columns as the server job (§11).

**Ops emitted:** `project.update` (pause/resume/details), `project.close`, `project.reopen`.
**States:** aktiv · pausad · avslutad · past-resume-highlight · offline-export.

---

### S5 — Lägenheter

- **Grid of unit chips**, 3–4 per row, colour-coded: grey `ej påbörjad`, amber `pågående`,
  green `klar`, dark green with check `signerad`, hatched `ej aktuellt` present.
  A 40-unit project fits one screen — the point is to see progress, not read a table.
- Filter chips: `Alla`, `Kvar`, `Klara`, `Signerade`, `Uppgång A/B`, floor.
- Tap a chip → S6. Long-press → `Öppna`, `Markera klar`, `Signera`, `Radera`.
- `+ Lägenheter` → bulk add sheet: `Uppgång`, `Våning`, `Från–Till` (`1001-1004`), preview list
  with per-row edit, then `Skapa 24 lägenheter`. Preview is mandatory: bulk add is the one
  action that can create dozens of wrong rows.
- **QR:** `Skriv ut etiketter` generates a printable A4 sheet (PDF) with `unit_number` + QR
  per unit; scanning a QR from the camera jumps straight to that unit's checklist. This is the
  "scan instead of type" flow — a phone in one hand, a label gun in the other.
- Deleting a unit with photos or sign-offs asks twice and names what will be lost.

**Ops emitted:** `apartment.bulk_insert`, `apartment.update`, `apartment.delete`,
`apartment.restore`.
**States:** empty (`"Inga lägenheter än. Lägg till med intervall."`) · partially complete ·
all done (green banner with `"Skapa protokoll"`) · offline.

---

### S6 — Checklista (kärnskärmen)

**Purpose:** complete a unit in under two minutes without scrolling, hunting or typing.

```
┌──────────────────────────────────────────┐
│ ‹ Lgh 1004 · Uppgång A       ● 2 väntar  │
│ Granen 12                                │
│ ████████████░░░░░░  18/24   [Klar] [⋯]   │
├──────────────────────────────────────────┤
│ LÄGENHETSINSTALLATIONER                  │
│ ☑ Fiber framdragen till lägenhet   📷    │
│ ☑ Kabel genomförd i rör            📷    │
│ ☑ ONT monterad och strömförsörjd         │
│ ☑ Fiber svetsad i ONT              📷    │
│ ☐ Mätning utförd                   📊    │
│ ☐ Etikettering utförd                    │
│ ☐ Städning utförd                        │
│                                          │
│ NOD (PROJEKTNIVÅ) — 6/6 klara            │
├──────────────────────────────────────────┤
│ [ 📷 Foto ]  [ 📊 Mätning ]  [ ✎ Anteckn. ]│
└──────────────────────────────────────────┘
```

- **One tap on a row toggles it done.** No checkbox hit-target games: the whole row is the
  target, swipe right-to-left reveals `Ej aktuellt` and `Foto`.
- Tapping the row body opens S7 for note/photo/measurement without losing the list position.
- Icons on the right (`📷`, `📊`) show *requirements*; when satisfied they turn solid. A step
  that still needs a photo refuses to close (§6.3) with an inline prompt, not a modal error.
- Step groups collapse; the group header shows `6/6`. Remembered per user.
- **`[Klar]` on the apartment** runs the final gate: required photos present, required
  measurements recorded, notes on any `ej_aktuellt` step. If anything is missing it lists the
  exact items with links, and offers `"Markera återstående som ej aktuellt"` with a reason.
- Progress is instant (`<50 ms`), optimistic, and written to Dexie in the same tick. The
  network never blocks a tick (§14).
- Sticky action bar at the bottom: camera, measurement, note — the three things that are
  always one tap from wherever you are in the list.
- **Undo:** any toggle shows a 10 s snackbar `"Markerad klar · Ångra"`. Mistakes in a dark
  stairwell are normal.

**Ops emitted:** `step.update` (`{status}`), `step.insert` (new ad-hoc step),
`step_revision.insert`, `apartment.update`.
**States:** not-started · in-progress · blocked-on-requirement · complete · signed ·
apartment-level steps read-only here (edit in S4 → Checklista).

---

### S7 — Steg (sheet)

Opens as a half-sheet over S6 so the list never disappears.

- Header: step title, category, who/when it was last changed.
- `Anteckning` — multiline, save-on-blur **and** `Spara` button; saving creates a
  `step_revision`. Existing revisions are listed underneath with author + time (`"Karl 09:12"`).
  No character limit below 2 000; no rich text (it exports to Excel and reads in sunlight).
- `Foton` — horizontal strip with `+` tile; each tile shows the `Väntar` badge if unsynced.
- `Mätning` — link to S9 if the step requires one; shows the latest result inline.
- `Ej aktuellt` — requires a reason chip (`Monteras ej`, `Redan utfört`, `Ingen åtkomst`,
  `Kund avböjer`, `Annat` + text).
- `Radera steg` — available to supervisors only, soft delete + undo.
- Read-only indicator if the project is `avslutad`: `"Projektet är avslutat — kontakta admin."`

**Ops emitted:** `step.update`, `step_revision.insert`, `step.delete`.
**States:** editable · read-only(closed) · offline · conflict (§7.5).

---

### S8 — Kamera

- Opens the native camera via `<input type="file" accept="image/*" capture="environment">`
  (not `getUserMedia`) — more reliable on iOS and gives the full-resolution image.
- On capture, immediately in a worker: decode → resize longest edge to **2 000 px** → re-encode
  JPEG **q85** → target ≤ 400 KB. Original is kept separately (§9).
- **GPS is requested at shutter, never blocking**: if no fix within 3 s, save with
  `captured_lat = null` and `gps_accuracy_m = null`; the badge shows `"Ingen GPS"`.
  A photo without GPS is still evidence; a photo not taken because GPS hung is not.
- `taken_at` comes from the device clock; the server timestamp is stored separately. If the
  device clock is off by more than 24 h vs. server, the UI flags it on sync.
- **Markup:** freehand pen (red/yellow/white, 3 widths), arrow, rectangle, text. Markup is
  baked into a **copy** — the original is never touched, so an accusation of doctoring can be
  answered with the original.
- `Caption` optional, one line.
- Save → thumbnail shown in S6/S7 with `Väntar på uppladdning` until uploaded.
- HEIC input is converted to JPEG on-device; HEIC is never stored or rendered (the current
  Streamlit app accepts HEIC and then fails to render it — a bug this design removes).

**Ops emitted:** `photo.insert` (after blob upload) · blob upload.
**States:** camera · processing · no-gps · markup · queued · uploaded.

---

### S9 — Mätning

- Numeric keypad first: `Dämpning (dB)` is the focused field on open.
- Fields: `Typ` (`dampning`/`otdr`/`effekt`/`kontinuitet`), `Länk/ID`, `Våglängd`,
  `Längd (m)`, `Antal skarvar`, `Antal kontakter`, `Instrument`, `Metod`, `Kommentar`.
- Result box updates while typing: `BUDGET 1.42 dB · UPPmätt 1.31 dB · GODKÄNT`
  (green) / `NÄRA GRÄNSEN` (amber, ≤ 0.5 dB margin) / `EJ GODKÄNT` (red).
- `Bifoga mätfil` attaches the instrument export (`.sor`, `.csv`, `.pdf`) as a document.
- Saving writes the measurement, **recomputes `passed`**, and — if `requires_measurement` —
  satisfies the step gate. Changing the project's splice/connector assumptions later
  recomputes on next open, so a wrong budget never becomes permanent history silently.
- Offline: fully functional; `measured_at` from the device, `measured_by` from the session.
- A failed measurement does **not** block completing the step, but it does surface on the
  project screen as `"1 mätning underkänd"` and in the export. Hiding a failure is not an option.

**Ops emitted:** `measurement.insert`, `measurement.update`, `document.insert` (if a file).
**States:** empty · editing · pass · near-limit · fail · offline.

---

### S10 — Material & tid

Two tabs on one screen.

**Material**
- Rows: article (free text with autocomplete from previously used articles for this project →
  offline suggestion list), quantity, unit (`st`, `m`, `rulle`, `ask`), unit price (prefilled
  from the last used price for that article), billable toggle, note.
- `+ Material` is three taps: search/type, quantity, save. The list is sticky at the top of the
  project so returning to the van for a part is recorded in ten seconds.
- Totals per project and per apartment, split `debiterbart` / `eget`.

**Tid (besök)**
- `Starta besök` / `Avsluta besök`; duration shown live.
- Manual correction of start/end is allowed (retro-logging happens), flagged with
  `"justerad"` in the export so invoicing can see it.
- Only **one** open visit per user is permitted; starting another prompts to close the first.
- GPS is captured at start/end when available (proof of presence), never required.

**Ops emitted:** `material.insert/update/delete`, `visit.insert`, `visit.update`.
**States:** empty · open-visit · offline · corrected.

---

### S11 — Överlämning (sign-off)

- Shows a summary the tenant can read on the phone: project, address, unit, what was installed,
  measurements (pass/fail), photos (thumbnails), open deviations.
- `Signera` opens a full-width signature canvas (pointer events, pressure ignored, PNG export
  at device pixel ratio). `Rensa` re-does it. Signature is *not* skippable without choosing
  `"Hyresgäst ej anträffad"`, which sets `present = false` and requires a note.
- Signer name (prefilled `"Hyresgäst lgh 1004"`), role chip, optional comment.
- On save: generate the unit protocol PDF (§12) locally, attach it as a `document`
  (`category = 'egenkontroll'`), and store `signoffs.document_id`.
- If offline, everything is local; the PDF is generated on-device so the tenant can be handed
  or emailed a copy **before** any sync happens. This is the single most important offline
  behaviour in the app.
- After signing, the unit shows `signerad` and its steps are read-only for `tekniker`
  (supervisor can still correct with a note).

**Ops emitted:** `signoff.insert` (+ signature blob), `document.insert`, `step.update` (lock).
**States:** unsigned · signing · present-false · signed-offline · signed-synced.

---

### S12 — Dokument

- Grouped by `category`: `Ritningar`, `Protokoll`, `Mätprotokoll`, `Följesedlar`,
  `Egenkontroll`, `Avvikelser`, `Övrigt`.
- Rows: title, revision chip, size, uploader, date, `Väntar` badge when unsynced.
- Upload from camera or file picker; PDFs render in an inline viewer; images open full-screen
  with pinch zoom (a drawing is useless if you cannot zoom into a shaft detail).
- `Ritning` revision handling: uploading a new revision of the same title keeps both, latest
  shown first, `"Rev B ersätter Rev A"` hint. Nothing is overwritten.
- Download available offline for anything previously opened (blob cached).

**Ops emitted:** `document.insert`, `document.delete`.
**States:** empty · uploading · offline-cached · offline-uncached (`"Inte nedladdad"`).

---

### S13 — Sök

See §10 for the engine. UI:

- One field, focused on open, keyboard up, no submit button (debounced 150 ms).
- Grouped results: `Projekt`, `Lägenheter`, `Steg`, `Anteckningar`, `Foton`, `Dokument`,
  `Material`. Each group shows the top 5 with `Visa alla`.
- Highlighted match, plus the project/unit context on every row (`"Granen 12 · lgh 1004"`).
- Filters: `Bara mina projekt`, `Bara öppna`, `Status`.
- Fully offline, including notes and captions.

---

### S14 — Mer

Three tabs plus export.

**Inställningar**
- `Logga in som` (email, role) · `Logga ut` · `Tvinga full synk` · `Rensa cache (behåll osynkat)`
  · `Om appen` (version, schema version, device id, storage usage).
- Display: `Stor text`, `Hög kontrast (utomhus)`, `Håll skärmen tänd` (useful while measuring).
- Storage: `navigator.storage.persist()` status shown as `"Skyddat lagringsutrymme: ja/nej"`.

**Synkstatus**
- Outbox list: entity, action, age, attempts, last error, `Försök igen` per row and for all.
- Pull info: last pull per project, cursor, `Full omsynk`.
- Recently applied ops (last 20) for peace of mind after a long offline stretch.

**Papperskorg**
- Everything soft-deleted in the last 30 days, grouped by project, with `Återställ`.
- Shows who deleted it and when. After 30 days the row is purged by a scheduled job
  (photos/documents first, then rows — see §13.4).

**Export**
- `Exportera Excel` (whole database or one project), `Skapa projektprotokoll (PDF)`,
  `Dela` via Web Share API / email.

---

## 9. Photo and document pipeline

### 9.1 Capture → storage

| Stage | Detail | Failure behaviour |
|---|---|---|
| Capture | native camera, full resolution, EXIF intact | user can retake |
| Convert | HEIC/HEIF → JPEG via `createImageBitmap` fallback; alpha flattened to white | if decode fails: keep original blob, mark `mime` as-is, warn |
| Compress | longest edge 2000 px, JPEG q85, EXIF orientation applied, GPS fields read before stripping | if > 400 KB after q85, retry q75, then q65 (floor) |
| Strip | EXIF/GPS **removed** from the compressed copy (privacy; GPS kept as columns) | — |
| Thumb | 320 px, q70, stored in `thumb_path` | thumbnail failure never blocks the upload |
| Store | original + compressed + thumb blobs in IndexedDB, row in `photos` (unsynced) | quota error → see §9.4 |
| Upload | original → `_original.jpg`, compressed → `_annotated.jpg`, thumb → `_thumb.jpg`; then `photo.insert` op | retry per §7.9 |

**Sizes:** a typical 12 MP phone photo becomes ~250–400 KB compressed and ~2.5–4 MB original.
At 3 photos per unit × 40 units, that is ~45 MB compressed + ~420 MB original per project.
Originals are the reason §19 has an open decision on storage tiering.

### 9.2 Markup

- Canvas overlay at display resolution; strokes stored as vector points while editing, baked
  to a JPEG copy on save at the same 2 000 px size.
- Tools: pen (red, yellow, white; 3 widths), arrow, rectangle, text label.
- The annotated copy replaces `storage_path` content; the original is untouched
  (§5.6 integrity rule).
- Markup is optional and never required to include a photo in a report.

### 9.3 Attachments on documents

- Allowed: `pdf`, `jpg`, `jpeg`, `png`, `heic` (converted), `xlsx`, `csv`, `txt`, `sor`, `zip`.
- Max 25 MB per document, 8 MB per image; rejected locally **before** upload with a clear
  Swedish message, never after a 4-minute upload.
- Filename sanitising: ASCII-safe slug + UUID prefix; original name kept in `original_name`
  for display and for the export.

### 9.4 Quota and cache policy

- On startup: `navigator.storage.persist()` (best effort) and `navigator.storage.estimate()`.
- Photos are **never** evicted while they are unsynced (`_dirty != 'synced'` is pinned).
- Synced photo blobs are evicted oldest-first once local usage exceeds **1.5 GB** or 80 % of
  the estimated quota; the row stays, and the image re-downloads on demand.
- If quota is hit during capture, the app says exactly what is stuck:
  `"Lagringen är full. 24 foton väntar på uppladdning. Anslut till wifi."`
- Nothing is deleted from the server because a phone ran out of space.

---

## 10. Search

**Engine:** MiniSearch (≈ 6 KB gzip, in-memory, no server). Built from the Dexie mirror, so
search works with zero network.

### 10.1 Indexed documents

| Doc type | Fields | Boost |
|---|---|---|
| `project` | name, customer, address, contact_name | 3 |
| `apartment` | unit_number, label, stairwell name, building name | 3 |
| `step` | title, category, subcategory, skip_reason | 1.5 |
| `note` (step comments + revisions) | body | 1 |
| `photo` | caption, unit_number, step title (denormalised at index time) | 1 |
| `document` | title, original_name, category label | 1 |
| `material` | article, notes | 0.8 |
| `measurement` | link_id, instrument, notes | 0.8 |

Each document is a flattened, **pre-joined** record:
`{ id, type, projectId, projectName, unitNumber, title, body, status, updatedAt }`
so a result row can render its context without extra queries.

### 10.2 Configuration

```ts
const mini = new MiniSearch<SearchDoc>({
  fields: ['title', 'body', 'unitNumber', 'projectName', 'context'],
  storeFields: ['type', 'title', 'projectId', 'projectName', 'unitNumber', 'status', 'updatedAt'],
  searchOptions: {
    boost: { title: 3, unitNumber: 3, projectName: 1.5, body: 1 },
    prefix: true,
    fuzzy: 0.2,          // tolerates a single typo in a 5+ letter word
    combineWith: 'AND',
  },
  tokenize: (text) => text
    .toLowerCase()
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')   // index-time fold
    .split(/[^a-z0-9]+/),
});
```

**Swedish folding at index time and query time** means `"tappning"` finds `"Täppning"` and
`"odr"` finds `"ÖDR"`. The stored display text keeps correct diacritics.

### 10.3 Rebuild strategy

- Index lives in memory, rebuilt on app start from Dexie: ~2 000 steps and 40 units rebuild in
  < 200 ms; a 20 000-row history in < 1 s.
- Incremental: any local mutation or pull updates the affected documents immediately
  (add/replace/remove by id). No full rebuild on normal use.
- The index is **not** persisted; rebuilding is cheaper and avoids a stale-index class of bugs.
- Empty query → no results, and the screen shows recent items instead (last 5 opened units).

### 10.4 Result behaviour

- Debounce 150 ms; max 20 per group; `Visa alla` expands a group.
- Matching text is highlighted with `<mark>`; Swedish characters in the query highlight
  correctly even though matching was folded (highlight against the normalised string with an
  index map).
- Search is scoped to what the device has: a project never opened is not searchable until it
  has been pulled. The empty state says so: `"Sökningen täcker de projekt som finns på enheten."`

---

## 11. Excel export contract

The export is a **stable interface** for VBA macros, Power Query and the accountant. Treat it
like a public API: additive changes only, and only with a version bump.

### 11.1 Non-negotiable rules

1. **Sheet names are fixed and ASCII-safe**, in a fixed order (§11.2).
2. **Row 1 is the header**, exactly one row, ASCII `snake_case`, no duplicates, no merged
   cells anywhere in the workbook.
3. **Column order is stable**; new columns are appended at the end of a sheet.
4. **No formulas, no pivot tables, no data validation, no conditional formatting.** Values only.
5. **One row per apartment** on `Lägenheter`; one row per step on `Steg`; one row per photo on
   `Foton`. Never a nested or multi-line cell.
6. **Types:** numbers are numbers (`0.00` for dB, `0.00` for money), dates are **text**
   `YYYY-MM-DD`, times are **text** `HH:MM` (24 h), timestamps are text
   `YYYY-MM-DD HH:MM:SS` in Europe/Stockholm. Booleans are `JA`/`NEJ`.
7. **No local file paths, no signed URLs, no `file://`.** Storage references are relative
   paths inside the bucket (§11.4).
8. **Stable filename and location:** `exports/projekt-export-latest.xlsx` in the `exports`
   bucket, plus a dated archive copy. A local download is named
   `projekt-export-<YYYYMMDD-HHMM>.xlsx`.
9. UTF-8 throughout; Swedish characters survive (both in the local client export and in the
   server job).
10. Empty values are empty cells, never `"null"`, `"None"` or `"-"`.

### 11.2 Sheets

| Order | Sheet | Grain | Purpose |
|---|---|---|---|
| 1 | `Exportinfo` | 1 row per key | Version, timestamps, counts, who exported |
| 2 | `Projekt` | 1 row per project | Header data incl. pause/close fields |
| 3 | `Lägenheter` | 1 row per apartment | Status, counts, times, material totals |
| 4 | `Steg` | 1 row per step | Checklist detail incl. `ej_aktuellt` reasons |
| 5 | `Kommentarer` | 1 row per note revision | Every note, with author and timestamp |
| 6 | `Mätningar` | 1 row per measurement | dB values, budget, pass/fail |
| 7 | `Foton` | 1 row per photo | Relative paths, GPS, timestamp |
| 8 | `Dokument` | 1 row per document | Category, revision, relative path |
| 9 | `Material` | 1 row per material line | Quantity, unit price, line total |
| 10 | `Tider` | 1 row per visit | Start, end, minutes, correction flag |
| 11 | `Signeringar` | 1 row per sign-off | Signer, role, timestamp, document path |
| 12 | `Sammanställning` | 1 row per project | Roll-up numbers for invoicing |
| 13 | `Fältbeskrivning` | 1 row per column | Swedish label + description per field |

`Fältbeskrivning` exists so the Swedish vocabulary lives **inside** the file without polluting
the machine-readable headers: column `ark`, `kolumn`, `svensk_etikett`, `beskrivning`,
`datatyp`.

### 11.3 Column contract

Every sheet starts with the identity columns it needs. `projekt_id` is present on all sheets so
a macro can filter without VLOOKUP chains.

**`Exportinfo`** (key/value, 2 columns)

| key | value |
|---|---|
| `export_version` | `1` |
| `schema_version` | migration number, e.g. `20261022120000` |
| `app_version` | `1.4.2` |
| `exported_at` | `2026-10-22 09:14:03` (Stockholm) |
| `exported_by` | email |
| `scope` | `all` or project id |
| `row_counts` | `Projekt=3;Lägenheter=92;Steg=1840;…` |

**`Projekt`**

```
project_id, project_name, project_type, status, customer, address,
contact_name, contact_phone,
paused_reason, paused_note, paused_at, resume_on, resume_note,
closed_at, closed_by, close_note,
apartment_count, apartment_done, apartment_signed, apartment_skipped,
step_count, step_done, step_skipped,
hours_total, material_cost, measurement_fail_count,
created_at, created_by, updated_at, updated_by, version
```

**`Lägenheter`**

```
project_id, apartment_id, project_name, building, stairwell, unit_number, floor, label,
status, steps_total, steps_done, steps_skipped, photo_count, measurement_count,
signed, signed_at, signer_name, present,
first_activity_at, completed_at, completed_by, hours_minutes, material_cost,
notes, created_at, updated_at, version
```

**`Steg`**

```
project_id, apartment_id, unit_number, apartment_id_is_null, category, subcategory, title,
status, skip_reason, comment, photo_count, measurement_count, measurement_passed,
completed_at, completed_by, sort_order, created_at, updated_at, version
```

`apartment_id_is_null` = `JA` marks project-level steps, so a macro can separate NOD work from
unit work without guessing from empty strings.

**`Kommentarer`**

```
project_id, apartment_id, unit_number, step_id, step_title, revision_index, body,
author_email, author_name, created_at, device_id
```

**`Mätningar`**

```
project_id, apartment_id, unit_number, step_id, link_id, measurement_type, wavelength_nm,
length_m, value_db, budget_db, passed, margin_db, instrument, instrument_serial, method,
measured_at, measured_by, notes, document_path, created_at, updated_at
```

**`Foton`**

```
project_id, apartment_id, unit_number, step_id, step_title, photo_id, caption,
storage_path, thumb_path, taken_at, captured_lat, captured_lng, gps_accuracy_m,
uploader_email, device_id, created_at
```

**`Dokument`**

```
project_id, apartment_id, unit_number, category, title, revision, storage_path,
original_name, mime, bytes, uploaded_by, created_at
```

**`Material`**

```
project_id, apartment_id, unit_number, step_id, article, quantity, unit, unit_price,
line_total, billable, supplier, notes, added_by, added_at
```

**`Tider`**

```
project_id, apartment_id, user_email, user_name, started_at, ended_at, minutes,
corrected, start_lat, start_lng, end_lat, end_lng, note
```

**`Signeringar`**

```
project_id, apartment_id, unit_number, signer_name, signer_role, signed_at, present,
comment, signature_path, document_path, created_by
```

**`Sammanställning`**

```
project_id, project_name, status, apartment_count, apartment_done, apartment_signed,
completion_percent, steps_total, steps_done, steps_skipped,
measurement_count, measurement_fail_count, hours_total, material_cost,
debiterbart_material_cost, open_deviation_count,
first_activity_date, last_activity_date, closed_at
```

**`Fältbeskrivning`**

```
ark, kolumn, svensk_etikett, beskrivning, datatyp
```

Examples: `Projekt | paused_reason | Pausorsak | Orsak till att arbetet pausats (enum-värde) | text`,
`Mätningar | margin_db | Marginal | budget_db - value_db, negativt = underkänd | tal`.

### 11.4 Storage references

- `storage_path` is the **bucket-relative** path, e.g.
  `photos/projects/7f2a…/a19c…/9be1…_annotated.jpg`.
- No URL, no bucket host, no expiry, no `file://`, no Windows path.
- Path is self-describing (`projects/<project>/<apartment>/<photo>_annotated.jpg`), so the tree
  can be rebuilt from the export plus a bucket listing.

### 11.5 Generation paths

There are **two** producers of the same contract:

| Producer | Where | When | Scope |
|---|---|---|---|
| Client export | browser, `exceljs` (lazy chunk) | user taps `Exportera Excel` | local mirror (works offline) |
| Server job | Supabase Edge Function + `xlsx` | nightly 02:00, plus on-demand from the desk view | whole database |

Both import **one shared module** (`src/export/buildWorkbook.ts`) that owns sheet order, column
lists, formatting and `Fältbeskrivning` generation. Divergence between the two is the highest
severity bug class, prevented by a shared golden-file test (§15.4).

Server job writes:

```
exports/projekt-export-latest.xlsx
exports/archive/projekt-export-2026-10-22T020000Z.xlsx
```

`latest` is replaced atomically (write `…-latest.tmp`, then copy), so a macro never opens a
half-written file.

### 11.6 Stability rules for macros

- Consumers must **read the header row by name**, not by column index. This is stated in
  `Exportinfo` and in `Fältbeskrivning`.
- `export_version` increments only on a breaking change (renamed/removed column, changed
  semantics). Additive columns do **not** bump it — which is precisely why index-based macros
  are unsafe and name-based macros are not.
- A macro must check `export_version` and refuse on an unknown major version with a readable
  message, rather than silently misreading money columns.
- Sheet names are never localised and never abbreviated.

### 11.7 Validation before write

The exporter **fails closed** rather than emitting a malformed workbook:

- Each sheet's header array is compared with a constant; a mismatch aborts the export.
- Comments are written verbatim but with newlines normalised to `" / "`, so no cell contains a
  line break.
- Numbers are rounded to column precision at write time (`0.00`), not in the database.
- Zero rows is fine (header only); an omitted sheet is not.
- Exporting with a non-empty outbox is allowed, but `Exportinfo.pending_ops` is set and the UI
  warns `"3 ändringar är inte synkade och saknas i exporten."` — an export that silently omits
  this morning's work is worse than no export.

---

## 12. PDF and report contract

All PDFs are generated **on the device** with `pdf-lib` + a bundled subset font (Inter regular +
bold). No server round-trip and no headless Chrome, so a protocol can be signed and handed over
in a basement plant room.

### 12.1 Apartment protocol (`Överlämningsprotokoll`)

```
┌──────────────────────────────────────────────┐
│ [LOGO]  ÖVERLÄMNINGSPROTOKOLL                │
│                                              │
│ Projekt:   Granen 12                         │
│ Kund:      Stockholmshem AB                  │
│ Adress:    Granvägen 12, 129 34 Hägersten    │
│ Lägenhet:  1004 · Uppgång A · plan 1         │
│ Tekniker:  William Svens                     │
│ Datum:     2026-10-22                        │
├──────────────────────────────────────────────┤
│ UTFÖRDA ARBETEN                              │
│ ☑ Fiber framdragen till lägenhet             │
│ ☑ Kabel genomförd i rör                      │
│ ☑ ONT monterad och strömförsörjd             │
│ ☑ Fiber svetsad i ONT                        │
│ ☑ Mätning utförd      1.31 dB (budget 1.42)  │
│ ☐ Etikettering — EJ AKTUELL: Monteras ej     │
├──────────────────────────────────────────────┤
│ MÄTNINGAR                                    │
│ Länk      Typ      Vågl.  Värde  Budget  Res.│
│ LGH1004   dämpning 1310   1.31   1.42    GODK│
├──────────────────────────────────────────────┤
│ FOTON (4 thumbnails, 2×2)                    │
├──────────────────────────────────────────────┤
│ AVVIKELSER: (inga)                           │
├──────────────────────────────────────────────┤
│ Hyresgäst: ____________________  Datum: ____ │
│ Namnförtydligande: __________________________│
│ Tekniker:  William Svens         2026-10-22  │
│                                              │
│                        Sida 1 (1)            │
└──────────────────────────────────────────────┘
```

Rules:

- **Skipped steps print with their reason**, never omitted. A protocol that hides what was not
  done is a liability.
- Failed measurements print with `EJ GODKÄNT` and are never filtered out.
- Thumbnails are the 320 px versions embedded directly (file lands at ~300–800 KB); full-size
  images stay in storage and are referenced by path in the Excel export.
- The signature PNG is placed in the signature block; when `present = false` the block prints
  `"Hyresgäst ej anträffad"` plus the required note.
- Filename: `protokoll_<project-slug>_<unit>_<YYYYMMDD>.pdf`.
- A4, 20 mm margins, repeated header on continuation pages, footer `Sida n (N)`.
- PDF metadata carries `app_version` and `signoff_id` for provenance.

### 12.2 Project protocol (`Projektprotokoll`)

- Cover: project, customer, address, period, technician(s), status at export.
- Progress per stairwell/building, with `ej aktuellt` and open deviations listed explicitly.
- **Pause history** from `event_log`: every pause with reason, note, who, how long, and whether
  it resumed. This is the document that answers "why did this take four months".
- Measurement summary including every failed measurement.
- Checklist matrix (unit × step) on landscape pages when the project is small enough, otherwise
  a per-unit appendix.
- Sign-off list with date and `present` flag.
- Filename: `projektprotokoll_<project-slug>_<YYYYMMDD>.pdf`.

### 12.3 Label sheet (QR)

- A4, 3 × 8 labels: `Granen 12 · Uppgång A · LGH 1004` plus a QR encoding
  `https://app.<domain>/s/<qr_token>`.
- Tokens are opaque and scoped to one unit. Scanning inside the app resolves against Dexie first
  (offline) and only falls back to the network.
- Generated client-side, so labels can be printed from any printer the phone can reach.

---

## 13. Security, privacy and GDPR

### 13.1 Authentication and authorisation

- Google OIDC through Supabase Auth; no passwords stored anywhere, ever.
- The browser holds only the **anon key** + user JWT. The service-role key exists only in Edge
  Function secrets and never in client code or in anything shipped to the browser.
- Authorisation is enforced by RLS (§5.9) plus transition triggers (§6.1). UI gating is cosmetic.
- Refresh tokens rotate; "sign out everywhere" is available from the desk view.

### 13.2 Data classification

| Class | Examples | Handling |
|---|---|---|
| **Personal data (GDPR art. 4)** | tenant name, signature, apartment number, GPS, notes mentioning a resident | access-limited, retained per §13.3, exportable and erasable per §13.4 |
| **Confidential business** | customer names, prices, contracts | members only |
| **Operational** | step statuses, materials, technician times | members only |
| **Device-local** | blobs, outbox, cached JWT | device storage, cleared on sign-out |

**Photos are personal data when they show a home interior.** Field rule, stated on the camera
screen: photograph *the installation*, not the tenant's belongings or any person. If a person is
unavoidable, a blur tool is offered before save.

### 13.3 Retention

| Data | Retained | Then |
|---|---|---|
| Projects, steps, measurements, materials, visits | 7 years after project close (Swedish bookkeeping law) | purge or cold archive |
| Photos, documents | 7 years after project close | purge with project |
| Signatures | 7 years after sign-off | purge |
| `event_log` | 7 years | purge |
| Soft-deleted rows | 30 days | hard purge (objects first) |
| Device-local cache | until eviction or sign-out | — |

Enforced by a daily `purge-expired` function at 03:00 that logs what it deleted, by table and
count, as a `system.purge` entry in `event_log`.

### 13.4 Right to erasure (begäran om radering)

A resident may ask for their data to be removed:

1. Admin opens the apartment and runs `Radera personuppgifter`.
2. Flow: `signoffs` (name, signature, PDF) → photos showing the interior → notes referring to the
   resident → `apartments.notes`. Step statuses and measurements **stay**, because they document
   the installation, not the person.
3. Every step is previewed with counts before anything is deleted.
4. Deletion is soft for 30 days (reversible after a mistake), then purged per §13.3.
5. The `event_log` records *that* an erasure happened, *when* and *by whom* — **without** copying
   the erased content back into the log, which would defeat the purpose.

### 13.5 Lost or stolen device

- Admin deactivates the user (`is_active = false`); RLS immediately blocks new data and the refresh
  token stops working.
- The local mirror stays readable until the OS wipes the device — accepted and documented, and the
  reason the app never stores more than the projects the technician has opened.
- No extra in-app PIN: it would be forgotten in the field, and a forgotten PIN means lost field
  work. OS passcode/biometrics is the right layer.

### 13.6 Transport and secrets

- HTTPS only, HSTS at the host, no mixed content.
- Secrets live in Vercel/Supabase environment settings; `.env.example` lists names with empty
  values. The current Streamlit repo references a `secrets.toml.example` that does not exist
  (§17.2) — the new repo ships a real example file from day one.
- No secrets, tokens or signed URLs in logs, error reports or the Excel export.
- Signed URLs live 60 minutes and are generated per view, never persisted.

### 13.7 Backups and disaster recovery

- Supabase daily automated backups + PITR (7 days on the paid tier).
- **Monthly logical dump** (`pg_dump`) to a separate bucket, retained 12 months — "the provider has
  backups" is not a recovery plan you have tested.
- The monthly dump also lists storage object paths, so a restore can detect missing files.
- Restore drill once a year: restore into a scratch project, run the app against it, export Excel.
  Untested backups do not count.

---

## 14. Non-functional budgets

Budgets are acceptance criteria measured on named devices, not aspirations.

| Metric | Budget | Measured on |
|---|---|---|
| Initial JS bundle | **≤ 300 KB gzip** | `vite build` report, enforced in CI |
| Lazy chunks (scanner, exceljs, pdf-lib) | ≤ 350 KB gzip each, never in the initial bundle | CI report |
| Cold start, app shell cached | ≤ 1.5 s | Moto G Power, 3G Fast, Lighthouse mobile |
| TTI, first ever visit | ≤ 4 s | same |
| Checklist tap → visual feedback | ≤ 50 ms | real device, performance trace |
| Local persist of a tap | ≤ 100 ms | IndexedDB transaction timing |
| Unit screen open (24 steps) | ≤ 250 ms | Moto G Power |
| Search query (5 000 docs) | ≤ 100 ms | Moto G Power |
| Photo compress (12 MP) | ≤ 1.5 s, off main thread | Moto G Power |
| Sync of 50 text ops | ≤ 2 s on 4G | Stockholm |
| PDF protocol (1 unit, 4 photos) | ≤ 2 s | Moto G Power |
| Excel export (100 units) | ≤ 5 s | Moto G Power |
| Offline capability | 100 % of S2–S11 usable with the radio off | airplane-mode test |
| Tap target | ≥ 48 × 48 px | manual audit |
| Base font | ≥ 16 px | manual audit |
| Text contrast | ≥ 4.5:1 normal, ≥ 3:1 large; outdoor theme ≥ 7:1 | axe + manual |
| Lighthouse PWA | installable, no console errors | CI |

### 14.1 Known platform limits (stated honestly in the UI, never hidden)

| Limit | Reality | Our answer |
|---|---|---|
| iOS has no Background Sync | sync only while foregrounded | sync on open, on foreground, on every mutation, and on a 60 s timer while visible; the badge tells the truth |
| iOS may evict IndexedDB after ~7 days of non-use | real data-loss risk | `navigator.storage.persist()`, sync aggressively when a network appears, never leave a day's work unsynced if a signal shows up |
| iOS Safari sometimes ignores `capture` | camera may open the photo library | accept both paths; never require live camera |
| Android may kill a backgrounded tab | state loss mid-form | forms persist drafts to Dexie on every change |
| No reliable push without a server + service worker | cannot nag about a paused job | S2 lists paused/past-resume jobs on every open — that is the reminder |
| GPS indoors is poor | a basement has no fix | never block on GPS; store accuracy and show `±m` |
| Very bright sunlight | washed-out screens | high-contrast theme, large type, colour never the only signal (status always has an icon + label) |

---

## 15. Testing strategy

### 15.1 Unit tests (Vitest)

- Pure domain logic: step gates (§6.3), measurement budget maths (§6.4), apartment status
  derivation (mirrors §5.8), merge decisions (§7.5).
- State-machine table tests: every `(from, to, role, inputs) → (allowed, error)` row of §6.1 is a
  data-driven case; the table in the spec and the table in the test are the same list.
- Export builder: header arrays, formatting, `Fältbeskrivning` completeness.
- `formatSthlm()`: DST boundaries (`2026-03-29`, `2026-10-25`), midnight, month rollover.

### 15.2 Integration tests (Vitest + `fake-indexeddb` + MSW)

- Outbox: mutation → exactly one op, same transaction, correct `base_version`.
- Push retries: same `op_id` twice → one server row, two `applied` responses.
- Conflict path: server `409` → row flagged, prompt produced, resolution op uses current version.
- Pull: deleted rows arrive, cursor advances only past applied rows, dirty rows are not clobbered.
- Auth: expired access token → refresh → retry; refresh failure → read-only with outbox intact.

### 15.3 End-to-end (Playwright)

`context.setOffline(true)` is a first-class test tool, not an afterthought:

1. Load online, open project → offline → complete 5 steps + 2 photos → reload offline → everything
   is still there → online → all ops apply.
2. Two browser contexts (two technicians) both offline, both edit the same step → reconnect →
   exactly one conflict prompt, no silent loss.
3. Pause with reason → reload → still paused with the same reason; resume clears it.
4. Close project with open units as `tekniker` → blocked with the Swedish message.
5. Sign-off offline → PDF downloads and opens, contains unit number and `EJ GODKÄNT` where
   applicable.
6. Bulk add 24 units from a range → count correct, duplicates rejected.
7. QR scan (mocked camera) → lands on the correct unit.

Visual snapshots for S2/S4/S6 at 390×844 and 360×800.

### 15.4 Contract tests (the ones that protect the customer)

- **Excel:** fixture database → build workbook → assert sheet order, every header array exactly,
  no merged cells, no formulas, correct cell types, `Exportinfo` keys present. A golden JSON of
  headers is committed; client and server builders are both tested against it.
- **Sync:** request/response fixtures per op type, including `409`, `403`, `422` and duplicate
  `op_id`.
- **PDF:** extracted text must contain unit number, project name, every skipped step with its
  reason, and `EJ GODKÄNT` for failures.

### 15.5 Manual field checklist (before each phase sign-off)

1. Airplane mode for a full working day on a real phone: 40 taps, 10 photos, 1 sign-off.
2. Battery: nothing exceeds 10 %/hour with the screen on.
3. Gloves: every primary action reachable with a thumb, no tiny targets.
4. Sunlight: read a checklist and a measurement result outdoors.
5. Basement: complete a unit with zero bars, then sync in the stairwell.
6. Wrong clock: set the phone 3 hours ahead, verify flags and that nothing corrupts.

---

## 16. Repository, environment, CI, deploy

### 16.1 Repository layout

```
projektapp-field/
├─ docs/
│  └─ SPEC.md                    ← this document, first commit
├─ public/                       icons, manifest assets
├─ src/
│  ├─ app/                       routes, layout, providers
│  ├─ components/                design-system primitives
│  ├─ features/
│  │  ├─ projects/  apartments/  checklist/  photos/  measurements/
│  │  ├─ materials/  signoff/  documents/  search/  sync/  admin/
│  ├─ domain/                    pure logic: state machines, budgets, statuses
│  ├─ db/                        Dexie schema, repositories, local migrations
│  ├─ sync/                      outbox, push/pull, conflict resolution
│  ├─ export/                    buildWorkbook.ts, buildProtocolPdf.ts (shared)
│  ├─ lib/                       formatSthlm, ids, strings, logger
│  └─ styles/
├─ supabase/
│  ├─ migrations/                only source of schema truth
│  ├─ functions/                 sync-push, sync-pull, nightly-export, purge-expired
│  └─ seed.sql                   step templates ported from src/templates.py
├─ tests/                        unit, integration, e2e, fixtures, golden
├─ .env.example
├─ vite.config.ts  tailwind.config.ts  tsconfig.json  eslint.config.js
└─ README.md
```

### 16.2 Environment variables

| Name | Where | Secret | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | client build | no | public project URL |
| `VITE_SUPABASE_ANON_KEY` | client build | no | public by design; RLS enforces |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only | **yes** | never prefixed `VITE_` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Supabase Auth config | **yes** | set in dashboard, not in repo |
| `EXPORT_BUCKET` | Edge Functions | no | `exports` |

Rule: anything the browser can read is prefixed `VITE_` and is assumed public. CI greps the built
`dist/` for `SERVICE_ROLE` and fails the build if it appears.

### 16.3 Migrations

- `supabase/migrations/<timestamp>_<name>.sql`, forward-only, idempotent where practical.
- Every migration is applied to a scratch database in CI (`supabase db reset`) and the test suite
  runs against it, so schema bugs surface before production.
- A destructive change (dropping a column) takes two releases: stop writing, then drop.
- Templates live in `supabase/seed.sql` and are versioned. Editing a template never mutates
  existing projects — their steps are immutable copies.

### 16.4 CI (GitHub Actions)

```
on: [push, pull_request]
jobs:
  verify:
    - pnpm install --frozen-lockfile
    - pnpm typecheck        # tsc --noEmit
    - pnpm lint             # eslint + prettier --check
    - pnpm test             # vitest unit + integration
    - pnpm build            # vite build + bundle-size gate
    - pnpm test:e2e         # playwright incl. offline scenarios
    - supabase db reset && pnpm test:db   # migrations + RLS tests
```

`main` requires green CI. Bundle size is a hard gate: exceeding 300 KB gzip fails the build and
prints the chunk breakdown.

### 16.5 Deploy

- Vercel, static output, preview deployment per PR, production on `main`.
- `vercel.json`: SPA rewrite to `index.html`, immutable caching for hashed assets, **no-cache**
  for `index.html` and `sw.js` — a stale service worker is the classic PWA support call.
- Supabase migrations are pushed by a tagged job, never by hand, so deployed schema always matches
  a commit.

---

## 17. Migration and cutover from Streamlit

### 17.1 What is carried over

| From the Streamlit app | To the PWA |
|---|---|
| `src/templates.py` — 37 fibre apartment steps, 11 CAT6 steps | `supabase/seed.sql` → `step_templates` + `step_template_items` |
| Checklist categories (NOD, lägenhetsinstallationer, egenkontroll) | `steps.category` / `subcategory` |
| Excel field intent (`src/excel_export.py`) | the frozen contract in §11 |
| Google OAuth allow-list | `users` rows seeded by admin |
| Photo upload flow | §9 pipeline (with HEIC fixed) |
| Nothing else | the local SQLite database holds only two test projects (`Ptest`); **it is not migrated** |

### 17.2 Bugs in the Streamlit app that must not be reproduced

| Bug | Location | Fixed in the PWA by |
|---|---|---|
| Dead `redirect_uri` pointing at an old tunnel URL | `.streamlit/secrets.toml:10` | no redirect URI in code; configured once in Supabase Auth |
| Missing `secrets.toml.example` referenced by docs and code | `README.md:12`, `src/auth.py:31` | `.env.example` committed from day one (§16.2) |
| HEIC accepted but unrenderable | `src/photos.py:15` | HEIC converted to JPEG on device (§9.1) |
| N+1 queries per rerun (74 for a 40-unit project) | `app.py:124-125` | local mirror + one query per screen |
| Write to SQLite on every keystroke | `app.py:296-298` | debounce + explicit save; drafts in Dexie |
| UTC timestamps displayed as local time | `src/db.py:14` | `formatSthlm()` everywhere (§8.0) |
| Whole-file SQLite on ephemeral disk | `src/db.py` | Postgres; no local file of record |
| Local absolute paths inside the export | `src/excel_export.py:36` | relative storage paths only (§11.4) |

### 17.3 Cutover plan

1. **Phase 0–1** (PWA in dev): Streamlit remains the only production tool.
2. **Phase 2**: run the PWA in parallel on one real job, with Streamlit open at the desk for the
   same job. Data is entered **once**, in the PWA; Streamlit is read-only reference.
3. **Phase 3**: the PWA is the tool of record for new jobs. Streamlit becomes a read-only desk
   view over the same Supabase database (reporting only, no writes).
4. **Phase 4**: Streamlit archived (`git tag streamlit-final`, README points at the PWA). Repo kept
   for history, not deployed.

Sunset criteria for Streamlit (all must hold):

- Three consecutive real jobs completed entirely in the PWA with zero data-loss events.
- The Excel export has been consumed by the bookkeeping macro without manual touch-up.
- Every photo from those jobs exists in storage and is listed in the export.
- A full working day in airplane mode happened without needing the desk app.

---

## 18. Phases and acceptance criteria

Each phase ends with a working, deployable app — not a half-migrated schema.

### Phase 0 — Foundations and sync proof (the risky part, done first)

Scope: new Vite repo (first commit = this spec), Tailwind + PWA shell, Supabase project, Google
auth, `users` / `project_members` / `projects` / `buildings` / `stairwells` / `apartments`,
migrations + RLS, Dexie mirror, outbox, `sync-push` / `sync-pull`, project list and detail with the
full pause/resume/close state machine, conflict prompt.

**Acceptance**

- [ ] Two phones: create a project offline on A; B (online) never sees it until A syncs; after sync
      B sees it within 5 s via pull/realtime.
- [ ] Pause with reason offline → sync → both devices show the same reason, note and `resume_on`.
- [ ] Both devices edit the same project's pause note while offline → reconnect → exactly one
      conflict prompt, both texts preserved in `event_log`, nothing silently lost.
- [ ] Reload with the radio off: app shell + all opened projects load; badge shows `Offline`.
- [ ] Closing a project with open units as a technician is refused with the Swedish message.
- [ ] Initial bundle ≤ 300 KB gzip; Lighthouse PWA installable.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green in CI.

### Phase 1 — The daily loop

Scope: templates seeded, bulk-add apartments, unit grid, checklist (S6), step sheet (S7), bulk
step generation, undo/soft delete + Papperskorg, Idag screen, sync status screen.

**Acceptance**

- [ ] Create a 40-unit project from a range pattern in under 60 s on a phone.
- [ ] Complete a whole unit offline, including 3 photos and one note, in under 3 minutes.
- [ ] Reconnect → every op applies; a second device sees the unit as complete.
- [ ] Toggle a step then Undo within 10 s → no net change, no stray applied op.
- [ ] Delete an apartment and restore it from Papperskorg; steps return intact.
- [ ] 200 taps across 5 units offline → outbox count accurate, sync applies all, zero duplicates
      (verified by counting `event_log` rows).

### Phase 2 — Evidence, sign-off, exports

Scope: camera pipeline + markup, measurements with pass/fail, documents with viewer, sign-off +
PDF protocol, Excel export (client) + nightly server export, search, QR labels and scanning.

**Acceptance**

- [ ] A photo taken in a basement is visible immediately, uploads later, and is byte-identical on
      the other device after sync.
- [ ] Original + annotated both present; markup exists only on the annotated copy.
- [ ] Measurement shows live `GODKÄNT` / `NÄRA GRÄNSEN` / `EJ GODKÄNT` and survives reload.
- [ ] Sign-off offline produces a PDF the tenant can receive before any sync; it lists every
      skipped step with its reason.
- [ ] Client Excel and server Excel have identical headers (golden test), both open in Excel without
      a repair prompt, and the macro reads them by header name.
- [ ] No export contains a URL or a local path.
- [ ] Search finds `"tappning"` for `"Täppning"` and `"1004"` for the unit, offline, < 100 ms.
- [ ] QR label sheet prints A4 and scanning lands on the right unit offline.

### Phase 3 — Multi-user, roles, reporting

Scope: full RLS verification with real accounts, supervisor features (create/close/templates),
project protocol PDF, activity log, nightly export, desk-view decision.

**Acceptance**

- [ ] A technician account cannot read an unassigned project even via a crafted REST call (not just
      hidden in the UI).
- [ ] A supervisor closes a project only when all units are `klar`/`signerad`, or with an admin
      override note.
- [ ] Reopen is admin-only and appears in the activity log with who/when/why.
- [ ] Pause history is visible in the project protocol PDF.
- [ ] Two technicians working the same project for a day produce zero step-tick conflicts and zero
      lost notes.

### Phase 4 — Retirement of the Streamlit app

Scope: Streamlit read-only, data verification, tagging, README rewrite.

**Acceptance**

- [ ] Streamlit no longer writes to any database.
- [ ] Three real jobs completed in the PWA, exports accepted by bookkeeping.
- [ ] `git tag streamlit-final`; README explains the new app and links to it.
- [ ] No secrets anywhere in the git history of either repo (verified with a scan).

---

## 19. Open decisions

Decisions that are **deliberately not made yet**. Each has a default so implementation can start;
changing the default later is a conscious act, not an accident.

| # | Decision | Options | Default until decided | Impact if changed | Decide by |
|---|---|---|---|---|---|
| D1 | Is `resume_on` mandatory when pausing? | mandatory / optional | **optional** | Forces a guess at the customer's timeline; a wrong date creates a false reminder | Phase 1 |
| D2 | May a project close with open units? | never / admin with note | **admin with note** (`close_note` required) | Blocks real-world handovers where one unit is inaccessible | Phase 1 |
| D3 | Keep originals or annotated only? | keep both / annotated only / originals 90 days | **keep both** | ~10× storage; loses the "unaltered evidence" argument if dropped | Phase 2 (measure real volume first) |
| D4 | When to move media to Cloudflare R2? | Supabase Storage / R2 beyond N GB | **Supabase Storage**, revisit at **50 GB or 5 000 SEK/month** | Migration effort; egress cost | Phase 3 |
| D5 | Offline auth grace period | 7 / 14 / 30 days | **14 days** | Longer = more risk on a stolen device; shorter = blocked in a long basement job | Phase 0 |
| D6 | May `arbetsledare` reopen a closed project? | no / yes with note | **no**, admin only | Every reopen rewrites invoicing assumptions; keep it rare | Phase 3 |
| D7 | Does `ej_aktuellt` count towards completion? | yes / no | **yes**, reported separately | Counting it as "not done" leaves jobs permanently unfinished | decided, revisit if customers object |
| D8 | Desk view: keep Streamlit read-only or rebuild? | retire / read-only Streamlit / new web view | **read-only Streamlit** in Phase 3, decide in Phase 4 | Maintaining two UIs is the thing we are trying to escape | Phase 4 |
| D9 | Baseline attenuation values per cable type | fixed table / entered per project | **fixed table + per-project override** | Wrong budgets produce false failures | Phase 2 |
| D10 | Blur tool for people in photos | build / omit | **omit in v1**, UI copy warns instead | GDPR exposure if a resident is photographed | Phase 2 |

---

## Appendix A — Swedish UI copy

Single source: `src/lib/strings.ts`. No hard-coded Swedish in components, and no English leaking
into the field UI.

### A.1 Statuses and enums

| Code | Swedish label | Where |
|---|---|---|
| `aktiv` | Aktiv | Project chip |
| `pausad` | Pausad | Project chip |
| `avslutad` | Avslutad | Project chip |
| `vantar_kund` | Väntar kund | Pause chip |
| `vantar_material` | Väntar material | Pause chip |
| `vantar_entreprenor` | Väntar entreprenör | Pause chip |
| `vader` | Väder | Pause chip |
| `atkomst_nekad` | Ingen åtkomst | Pause chip |
| `annat` | Annat | Pause chip |
| `ej_paborjad` | Ej påbörjad | Unit / step |
| `pagaende` | Pågående | Unit / step |
| `klar` | Klar | Unit / step |
| `signerad` | Signerad | Unit |
| `ej_aktuellt` | Ej aktuellt | Step |
| `fiber_apartment` | Fiber till lägenhet | Project type |
| `cat6` | Kabel-TV / CAT6 | Project type |
| `ovrigt` | Övrigt | Project type |

### A.2 Actions

`Pausa projekt` · `Återuppta` · `Avsluta projekt` · `Öppna igen` · `Skapa projekt` ·
`Lägg till lägenheter` · `Skriv ut etiketter` · `Markera klar` · `Ångra` · `Ej aktuellt` ·
`Ta foto` · `Mätning` · `Anteckning` · `Signera` · `Skapa protokoll` · `Exportera Excel` ·
`Försök igen` · `Återställ` · `Radera` · `Radera personuppgifter` · `Tvinga full synk` ·
`Logga ut`

### A.3 Sync and system messages

| Situation | Swedish copy |
|---|---|
| Synced | `Synkat HH:MM` |
| Pending | `N väntar på uppladdning` |
| Failed | `N misslyckades — tryck för detaljer` |
| Offline | `Offline — ändringar sparas på enheten` |
| Back online | `Ansluten — synkar…` |
| Conflict | `Konflikt: ändrat av NAMN medan du var offline` |
| Missing photo | `Foto krävs för det här steget` |
| Pause without reason | `Pausorsak krävs` |
| Close blocked | `N lägenheter är inte klara` |
| Close by technician | `Endast arbetsledare kan avsluta projekt` |
| Not invited | `Ditt konto är inte inbjudet. Kontakta William.` |
| Read-only offline | `Logga in igen för att fortsätta` |
| Sign-out with outbox | `Du har N ändringar som inte är synkade.` |
| Export with outbox | `N ändringar är inte synkade och saknas i exporten.` |
| Storage full | `Lagringen är full. N foton väntar på uppladdning. Anslut till wifi.` |
| No GPS | `Ingen GPS — foto sparat utan position` |
| Project closed | `Projektet är avslutat — kontakta admin` |

### A.4 Tone

Short, factual, never cheerful about a problem. No "Oops!", no exclamation marks, no blame.
Errors say **what happened**, **what was kept**, and **what to do next**.

---

## Appendix B — Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-22 | First complete draft: schema, state machines, sync contract, screens, photo pipeline, search, Excel/PDF contracts, security, NFR budgets, testing, repo/CI, migration, phases, open decisions. |

### B.1 Approval

This document is approved when the owner answers the §19 items that are marked for the current
phase, or explicitly accepts their defaults. Implementation of a phase may not begin before that
phase's open decisions are either decided or defaulted in writing.

