# Projektapp Field — v1 specification (solo)

**Status:** draft for approval
**Version:** 0.3
**Scope owner:** William Svens (one technician, fiber/coax, Swedish apartment complexes)
**Supersedes for v1:** `SPEC.md` §5.2 (users/membership), §7.5 (merge policy), §7.7 (realtime),
§7.9 (ordering matrix), §10 (search engine), §15–16 (test/CI gates), §18 Phases 3–4.
**Keeps from `SPEC.md`:** §6.1 (pause with reason), §6.4 (measurement formula), §11.1 (Excel
rules, verbatim), Appendix A (Swedish copy).

---

## 1. What v1 is

A phone-first PWA that works in a basement with no signal, records what was installed with
photos, measurements and notes, and produces an Excel file the bookkeeping macro can read
without rework.

| In v1 | Later (not now) |
|---|---|
| Projects, apartments, checklist, notes, photos, measurements | Roles, membership, per-project permissions |
| Offline capture for everything above | Conflict merge matrix, per-field groups |
| One manual **`Uppdatera`** button to sync and reload | Realtime, 60 s polling, push notifications |
| Excel export with fixed headers | PDF protocols, sign-off, markup, QR labels |
| Pause/close project with reason | Nightly server export, activity log, Papperskorg |
| Search as a plain filter over local rows | MiniSearch / typo tolerance |
| One user, one device at a time | Two technicians editing one project simultaneously |

**The one requirement that forces this architecture:** §1.2 of `SPEC.md` — no network in a
basement. Streamlit cannot do that; every tick is a websocket round-trip. Everything else on
the list is cheap.

---

## 2. Data model (6 tables)

All ids are **UUIDs generated on the device**, so an offline insert is addressable before it
ever reaches the server.

```sql
projects     (id, name, project_type, customer, address, contact_name, contact_phone,
              status, paused_reason, paused_note, paused_at, resume_on,
              closed_at, notes, rev, created_at, updated_at, deleted_at)

apartments   (id, project_id, building, stairwell, unit_number, floor,
              notes, created_at, updated_at, deleted_at)
              -- no `done` column: apartment status is derived from its steps (§2.1)

steps        (id, project_id, apartment_id, category, subcategory, title, sort_order,
              status, skip_reason, comment, created_at, updated_at, deleted_at)
              -- status is one of 'klar' | 'delvis' | 'ej_klar' (§2.1)
              -- skip_reason is reserved for a future 'ej_aktuellt' state, unused in v1

notes        (id, project_id, apartment_id, step_id, body, author_email, created_at)
              -- append-only: never updated, never deleted

photos       (id, project_id, apartment_id, step_id, storage_path, caption,
              taken_at, captured_lat, captured_lng, gps_accuracy_m,
              width, height, bytes, created_at, deleted_at)

measurements (id, project_id, apartment_id, step_id, link_id, measurement_type,
              wavelength_nm, length_m, splice_count, connector_count, value_db,
              budget_db, passed, instrument, measured_at, created_at, updated_at,
              deleted_at)
```

`projects.rev` is the only version number in the system. It is bumped by every push.

**The checklist template is not a table.** `src/templates.py` already holds it as data; on
project creation the rows are copied into `steps` with `apartment_id = null` (project-level) and
then cloned per apartment. Editing the template later must not rewrite an existing job.

### 2.1 Step status — three states

A step has exactly three states. No checkbox, no dropdown: three buttons in a row, one tap each.

| Stored / exported | Swedish label | Meaning | Progress value |
|---|---|---|---|
| `klar` | Klar | finished, holds up at handover | `1.0` |
| `delvis` | Delvis klar | started, real work remains | `0.5` |
| `ej_klar` | Ej klar | not done — the default for every new step | `0.0` |

**Why three and not two.** A basement job is rarely binary: cable pulled but not terminated,
stativ mounted but not jordad. A checkbox forces either a lie (`klar`) or a step that reads as
untouched, and the technician's only remaining option is a free-text note nobody parses. Half
done is a real state and it must be visible in the unit grid and in the export.

**Rules**

- New steps start at `ej_klar`. There is no "unset" fourth state.
- Tapping the state that is already active does nothing — no cycling, nothing destroyed in one tap.
- Colours match the unit chips: green `klar`, amber `delvis`, grey `ej_klar`.
- Every status change sets `updated_at` and marks the row dirty (LWW per row, §3.1).
- `delvis` never counts as complete: it cannot make an apartment `klar`, and it cannot satisfy a
  close-project check.

**Derived apartment status** (`SPEC.md` §6.2, minus the states v1 does not have):

| Apartment status | Condition |
|---|---|
| `klar` | at least one step and every non-deleted step is `klar` |
| `pagaende` | at least one step is `klar` or `delvis`, but not all are `klar` |
| `ej_paborjad` | every step is `ej_klar` |

**Derived progress** = `sum(progress) / count(steps)`, rounded down, shown as a percentage on
screens 1, 2 and 3. A unit at 2 of 4 steps `klar` and 1 `delvis` reads `62%`, not `50%` — the
half-done step counts for what it is.

**Scope of the project percentage.** On screens 1 and 2 the sum runs over the *apartments'*
steps only. The project-level rows (`apartment_id = null`, §2) are the cloning template, and no
screen can tick them: counting them would leave a finished one-apartment job at `50%` and dilute
every real step by one extra copy of the template. Because the percentage is step-weighted, a
40-apartment job moves about `0.06%` per step, so screens 1 and 2 also carry
`<klara> av <alla> lägenheter klara` — the counter that changes the moment a unit is finished.

**The one thing three states cannot express:** a step that does not apply at all (`monteras ej`).
Such a step stays `delvis` or `ej_klar` and is explained in `comment`. If that turns out to
happen often, add a fourth value `ej_aktuellt` plus the existing `skip_reason` column — an enum
value and no schema change, which is why `skip_reason` is already reserved above.

**Migration from the Streamlit app** (SQLite `steps.done INTEGER`): `done = 1 → klar`,
`done = 0 → ej_klar`. There is no historic "delvis" to invent.

---

## 3. Sync model

### 3.1 Rules

1. **Server is truth, device is a cache.** Never delete local work because of a network error.
2. **Notes are append-only**, so "keep both versions" costs zero code: two devices insert two
   rows with different ids.
3. **Single-value fields are last-write-wins per row** (`steps.status`, `steps.comment`,
   `measurements.*`). Setting a step to `klar`, `delvis` or `ej_klar` is a deliberate act; the
   later one wins. No field groups, no `409` payloads, no prompt UI.
4. **Push before pull, always.** Pulling first would overwrite unsynced edits with the server's
   older copy.
5. **No automatic refresh of an open screen.** The only thing that pulls is the `Uppdatera`
   button (§4). Nothing moves under the technician's thumb.
6. **Photos upload before their row is inserted**, so a row never points at a missing file.

### 3.2 Local store

Dexie/IndexedDB, one store per table above, plus:

```ts
dirty: Table<{ table: string; id: string }>   // rows with unsynced changes
blobs: Table<{ id: string; blob: Blob }>      // photos waiting for upload
meta:  Table<{ key: string; value: string }>  // device_id, last_sync_at
```

There is **no outbox envelope**: no `op_id`, no `base_version`, no batching, no backoff table.
A row is either dirty or it is not. Retry is the button.

### 3.3 Push (only runs when online)

```
1. rows := dirty rows for this project (steps, apartments, notes, measurements, photos)
2. upload blobs for those photos first  → storage_path
3. upsert rows by id                    (notes: insert only, never update)
4. rev := server rev of this project
   update projects set rev = rev + 1 where id = :id and rev = :rev
   → 0 rows updated means another device pushed first; take its rev and continue
5. clear dirty flags only for rows the server accepted
```

A failed step stops the sequence and changes nothing locally. Nothing is discarded.

### 3.4 Pull (only runs when online, after a successful push)

```
1. select * from <table> where project_id = :id      -- whole project, ~1,200 rows worst case
2. replace the local copy of that project wholesale
3. last_sync_at := now()
```

Wholesale replace is safe **because push ran first and left no dirty rows**. Deleted rows come
back with `deleted_at` set, so the device can show `"Borttagen"` rather than silently losing it.

If the payload ever exceeds ~1 MB, switch to `updated_at > cursor`. That is the only reason a
cursor exists, and it is not v1 work.

---

## 4. The `Uppdatera` button (v1's only sync control)

**Placement:** fixed header, right side, next to the sync badge. Always visible on every screen,
never inside a menu, reachable with the thumb of the hand holding the phone.

**The label is a promise about what the press will do:**

| State | When | Label | Enabled |
|---|---|---|---|
| `offline` | `navigator.onLine === false` | `Offline` | no |
| `offline-caption` | idem | caption `Ändringar sparas på enheten` | — |
| `idle` | online, nothing dirty | `Uppdatera` | **yes** |
| `pending` | online, N dirty rows | `Skicka N ändringar` | **yes** |
| `syncing` | after press | `Uppdaterar…` | no |
| `synced` | push + pull ok | `Uppdaterat HH:MM` for 5 s, then `idle` | no |
| `error` | push or pull failed | `Försök igen` + amber dot | **yes** |

A press that has not settled after 20 s is not the technician's problem: the header drops to
`error` (`Ingen kontakt med servern.`) and the button becomes `Försök igen`. The request may still
be in flight — a retry is safe because push is written to survive a crash at any step (§3.3), and
a lost press must never cost the walk back to the van and a reload.

**Behaviour on press:**

1. Offline → nothing happens; the button is disabled and the tap never reaches the handler.
2. Push (§3.3). If push fails → `error`, every local row kept, the server message shown under
   the header, and **no pull**.
3. Pull (§3.4), then re-render the current screen **in place**: same route, same scroll
   position, same open sheet. No navigation, no app-shell reload.
4. Show `Uppdaterat HH:MM`, then fade back to `Uppdatera`.

**Reconnect:** listen for the browser `online` event and flip the header from `Offline` to
`Uppdatera` immediately — that is the moment the button becomes usable. The app may push
automatically on reconnect when the checklist is **not** open, but it must never pull on its
own: an open checklist must not change under the technician's thumb.

**Copy** (Appendix A tone: what happened, what was kept, what to do next):

| Situation | Text |
|---|---|
| Offline | `Offline — ändringar sparas på enheten` |
| Waiting | `3 ändringar väntar på uppladdning` |
| Success | `Uppdaterat 14:32` |
| Push failed | `Kunde inte skicka. Ändringarna finns kvar på enheten.` |
| Pull failed | `Hämtade inte senaste. Försök igen när du har täckning.` |
| No answer after 20 s | `Ingen kontakt med servern. Ändringarna finns kvar på enheten.` |
| Rev moved on another device | `Projektet ändrades på en annan enhet 09:12.` |
| Storage full | `Lagringen är full. 4 foton väntar.` |

Nothing about sync is ever a disappearing toast: the header state is the record.

---

## 5. Screens (6)

| # | Screen | Contents |
|---|---|---|
| 1 | `Projekt` | List with status chip and progress; `Uppdatera` in the header; text filter |
| 2 | `Projekt` detail | Header data, pause/close with reason, unit-grid entry, measurement summary |
| 3 | `Lägenheter` | Grid of unit chips (grey `ej påbörjad`, amber `pågående`, green `klar`); bulk add by range (`1001–1040`) |
| 4 | `Checklista` | Steps grouped by category; each row has the three-state control (§2.1), note, photo, measurement |
| 5 | `Steg` sheet | Half-sheet over the checklist: full-size state buttons, note, photo, measurement |
| 6 | `Export` | Excel download; warns `3 ändringar är inte synkade och saknas i exporten.` |

**Checklist row layout.** Title on its own line; the three state buttons full-width beneath it,
equal widths, minimum 44 px tall, text labels — no icon-only toggle; note / photo / measurement
as a small secondary row. Three visible buttons beat one control you have to long-press: with
gloves on, a long-press is a gamble and a mis-tap is invisible.

Not in v1: `Idag`, `Sök` (screen 1 filters instead), `Mer`, `Dokument`, `Material & tid`.

---

## 6. Photos

```
<input type="file" accept="image/*" capture="environment">
  → draw to canvas, longest side 2000 px, JPEG q0.85
  → blob into IndexedDB + dirty row
  → badge "Väntar på uppladdning"
  → on Uppdatera: upload, then insert the row
```

- **GPS:** `getCurrentPosition` with a 3 s cap; on timeout save `captured_lat = null` and show
  `Ingen GPS — foto sparat utan position`. A photo without GPS is still evidence; a photo not
  taken because GPS hung is not.
- `taken_at` from the device clock, with the server's `created_at` beside it.
- No markup, no annotated copy, no HEIC path in v1. HEIC is rejected with `Använd JPEG` — the
  current Python app accepts it and then fails to render, which is worse than refusing it.
- No delete in one tap: `deleted_at` is set and the file is kept for 30 days.

---

## 7. Measurements

`passed` is computed, never typed (`SPEC.md` §6.4):

```
budget_db = length_km × attenuation_db_per_km + 0.10 × splice_count + 0.30 × connector_count
passed    = value_db <= budget_db
```

Defaults: single-mode 1310 nm `0.35 dB/km`, 1550 nm `0.20 dB/km`; multimode 850 nm `3.0 dB/km`.
Show `GODKÄNT` / `NÄRA GRÄNSEN` (≤ 0.5 dB margin) / `EJ GODKÄNT`. A failed measurement never
blocks setting the step to `klar`, but it is counted on screen 2 and in the export.

---

## 8. Excel export

All ten rules in `SPEC.md` §11.1 apply unchanged, including: ASCII-safe sheet names, one header
row, stable column order, values only, `YYYY-MM-DD` text dates, `JA`/`NEJ` booleans, and **no
URLs and no local file paths**. Empty cells are empty, never `"None"`.

v1 sheets, in this order:

`Exportinfo`, `Projekt`, `Lägenheter`, `Steg`, `Kommentarer`, `Mätningar`, `Foton`

Columns: `SPEC.md` §11.3 minus the fields v1 has no tables for. Macro-safety is proven by
opening the file in Excel with no repair prompt and reading a column by header name.

**Step status in the export.** `Steg.status` carries the stored code — `klar`, `delvis` or
`ej_klar` — never the Swedish label, so a macro can compare strings. Next to it,
`Steg.progress` is a number (`1.00` / `0.50` / `0.00`), so a macro can `SUM` a column instead of
counting three codes. `Lägenheter.status` carries the derived status from §2.1
(`klar` / `pagaende` / `ej_paborjad`) and `Lägenheter.progress` the derived percentage as a
number. The Swedish labels live in `Exportinfo`-adjacent documentation only — the workbook
shows codes, the technician sees `Klar` / `Delvis klar` / `Ej klar`.

The export is built from **local rows**, so it works offline; if dirty rows exist, screen 6 says
so instead of pretending the file is complete.

---

## 9. Acceptance criteria

- [ ] Airplane mode: app shell opens, a project opens, a step is set to `delvis`, a photo is
      taken, a measurement is saved — no errors, nothing lost on reload.
- [ ] Every step shows exactly three buttons; one tap sets `klar` / `delvis klar` / `ej klar`,
      reload keeps the choice, and the row turns green / amber / grey.
- [ ] A unit with every step `klar` reads `klar`; one `delvis` step keeps it `pagaende` and stops
      the project from closing; two steps where one is `delvis` read `25%`.
- [ ] Export: `Steg.status` contains only `klar`, `delvis` or `ej_klar`, and `Steg.progress`
      sums to the same percentage the phone shows.
- [ ] Back online: the header flips `Offline` → `Uppdatera` without a manual reload; pressing it
      applies everything, and a second device sees it after pressing its own button.
- [ ] With 5 unsynced changes the button already reads `Skicka 5 ändringar` before it is pressed.
- [ ] Pressing the button with the checklist open keeps the same scroll position and open sheet.
- [ ] Kill the app mid-upload: reopening and pressing the button sends the photo once, not twice
      (same row id, same storage path).
- [ ] Two notes written on two devices both survive; a conflicting step status resolves to the
      later one with no prompt and no lost note.
- [ ] Export opens in Excel with no repair prompt, headers match `SPEC.md` §11.3, and no cell
      contains `data/`, `file://` or a signed URL.
- [ ] The only network calls the app makes are the `Uppdatera` button and the auth refresh.

---

## 10. Open questions (answer before building)

| # | Question | Default if unanswered |
|---|---|---|
| V1 | Is a PDF protocol required **on site**, or are Excel + photos enough for v1? | no PDF in v1 |
| V2 | Will more than one device/technician touch the same project in a week? | no; LWW per row, no merge UI |
| V3 | Does the bookkeeping macro read a file from a fixed path, or is a download enough? | download; fixed path in Phase 3 |

---

## Appendix — Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-23 | First draft: 6 tables, snapshot push/pull, last-write-wins with append-only notes, manual `Uppdatera` button as the only sync control, 6 screens, explicit deferral list. |
| 0.2 | 2026-10-23 | Steps get three states (`klar` / `delvis` / `ej_klar`) instead of a checkbox; apartment status and progress are derived, so `apartments.done` is removed; export carries `status` codes plus a numeric `progress`; `skip_reason` reserved for a later `ej_aktuellt`. |
| 0.3 | 2026-10-27 | Project progress on screens 1–2 sums only apartment steps (the project-level template rows are not work) and carries a "X av Y lägenheter klara" counter, so finishing one unit of forty is visible. |
| 0.4 | 2026-10-27 | The `Uppdaterat HH:MM` label really expires after 5 s (§4 said so; the refresh path kept the state and the button stayed disabled until a reload), and a press that has not settled in 20 s falls back to `Försök igen` instead of owning the button forever. |


