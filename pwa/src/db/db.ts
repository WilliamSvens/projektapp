import Dexie, { type Table } from 'dexie';
import type { StepStatus } from '../domain/status';
import { stepsForType } from '../data/templates';
import { newId, nowIso } from '../lib/util';

export type ProjectStatus = 'pagaende' | 'pausad' | 'klart';

export interface Project {
  id: string;
  name: string;
  project_type: string;
  customer: string | null;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: ProjectStatus;
  paused_reason: string | null;
  paused_note: string | null;
  paused_at: string | null;
  resume_on: string | null;
  closed_at: string | null;
  notes: string | null;
  rev: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Apartment {
  id: string;
  project_id: string;
  building: string | null;
  stairwell: string | null;
  unit_number: string;
  floor: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Step {
  id: string;
  project_id: string;
  apartment_id: string | null;
  category: string;
  subcategory: string | null;
  title: string;
  sort_order: number;
  status: StepStatus;
  skip_reason: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Note {
  id: string;
  project_id: string;
  apartment_id: string | null;
  step_id: string | null;
  body: string;
  author_email: string;
  created_at: string;
}

export interface Photo {
  id: string;
  project_id: string;
  apartment_id: string | null;
  step_id: string | null;
  storage_path: string | null;
  caption: string | null;
  taken_at: string | null;
  captured_lat: number | null;
  captured_lng: number | null;
  gps_accuracy_m: number | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  created_at: string;
  deleted_at: string | null;
}

export interface Measurement {
  id: string;
  project_id: string;
  apartment_id: string | null;
  step_id: string | null;
  link_id: string | null;
  measurement_type: string;
  wavelength_nm: number | null;
  length_m: number | null;
  splice_count: number | null;
  connector_count: number | null;
  value_db: number | null;
  budget_db: number | null;
  passed: boolean | null;
  instrument: string | null;
  measured_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const BUSINESS_TABLES = [
  'projects',
  'apartments',
  'steps',
  'notes',
  'photos',
  'measurements',
] as const;

export type TableName = (typeof BUSINESS_TABLES)[number];

/** A row is either dirty or it is not — no op_id, no base_version, no batching (§3.2). */
export interface DirtyRow {
  key: string;
  table: TableName;
  id: string;
  project_id: string;
  queued_at: string;
}

export interface BlobRecord {
  id: string;
  blob: Blob;
}

export interface MetaRow {
  key: string;
  value: string;
}

export class FieldDB extends Dexie {
  projects!: Table<Project, string>;
  apartments!: Table<Apartment, string>;
  steps!: Table<Step, string>;
  notes!: Table<Note, string>;
  photos!: Table<Photo, string>;
  measurements!: Table<Measurement, string>;
  dirty!: Table<DirtyRow, string>;
  blobs!: Table<BlobRecord, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'projektapp') {
    super(name);
    this.version(1).stores({
      projects: 'id, status, updated_at',
      apartments: 'id, project_id, [project_id+unit_number]',
      steps: 'id, project_id, apartment_id, [project_id+sort_order]',
      notes: 'id, project_id, step_id, created_at',
      photos: 'id, project_id, step_id',
      measurements: 'id, project_id, step_id',
      dirty: 'key, project_id, table',
      blobs: 'id',
      meta: 'key',
    });
  }
}

export const db = new FieldDB();

// ---------------------------------------------------------------------------
// Repository helpers — every mutation marks the row dirty and touches updated_at.
// ---------------------------------------------------------------------------

export async function markDirty(
  database: FieldDB,
  table: TableName,
  id: string,
  projectId: string,
): Promise<void> {
  await database.dirty.put({
    key: `${table}:${id}`,
    table,
    id,
    project_id: projectId,
    queued_at: nowIso(),
  });
}

export async function dirtyCount(database: FieldDB = db): Promise<number> {
  return database.dirty.count();
}

export async function dirtyProjectIds(database: FieldDB = db): Promise<string[]> {
  const rows = await database.dirty.toArray();
  return [...new Set(rows.map((row) => row.project_id))];
}

export async function getMeta(database: FieldDB, key: string): Promise<string | null> {
  const row = await database.meta.get(key);
  return row?.value ?? null;
}

export async function setMeta(database: FieldDB, key: string, value: string): Promise<void> {
  await database.meta.put({ key, value });
}

export async function setStepStatus(
  database: FieldDB,
  step: Step,
  status: StepStatus,
): Promise<boolean> {
  // Tapping the active state does nothing — no cycling, nothing destroyed in one tap (§2.1).
  if (step.status === status) return false;
  await database.steps.update(step.id, { status, updated_at: nowIso() });
  await markDirty(database, 'steps', step.id, step.project_id);
  return true;
}

export async function setStepComment(
  database: FieldDB,
  step: Step,
  comment: string,
): Promise<void> {
  const trimmed = comment.trim();
  if ((step.comment ?? '') === trimmed) return;
  await database.steps.update(step.id, { comment: trimmed, updated_at: nowIso() });
  await markDirty(database, 'steps', step.id, step.project_id);
}

export async function addNote(
  database: FieldDB,
  input: {
    projectId: string;
    apartmentId: string | null;
    stepId: string | null;
    body: string;
    authorEmail: string;
  },
): Promise<Note> {
  const note: Note = {
    id: newId(),
    project_id: input.projectId,
    apartment_id: input.apartmentId,
    step_id: input.stepId,
    body: input.body.trim(),
    author_email: input.authorEmail,
    created_at: nowIso(),
  };
  await database.notes.put(note);
  await markDirty(database, 'notes', note.id, note.project_id);
  return note;
}

export async function createProject(
  database: FieldDB,
  input: { name: string; projectType: string; customer?: string; address?: string },
): Promise<Project> {
  const stamp = nowIso();
  const project: Project = {
    id: newId(),
    name: input.name.trim(),
    project_type: input.projectType,
    customer: input.customer?.trim() || null,
    address: input.address?.trim() || null,
    contact_name: null,
    contact_phone: null,
    status: 'pagaende',
    paused_reason: null,
    paused_note: null,
    paused_at: null,
    resume_on: null,
    closed_at: null,
    notes: null,
    rev: 0,
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
  };

  const rows: Step[] = stepsForType(project.project_type).map((item, index) => ({
    id: newId(),
    project_id: project.id,
    apartment_id: null,
    category: item.category,
    subcategory: item.subcategory,
    title: item.title,
    sort_order: index,
    status: 'ej_klar',
    skip_reason: null,
    comment: null,
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
  }));

  await database.transaction(
    'rw',
    database.projects,
    database.steps,
    database.dirty,
    async () => {
      await database.projects.put(project);
      await markDirty(database, 'projects', project.id, project.id);
      if (rows.length > 0) {
        await database.steps.bulkPut(rows);
        await database.dirty.bulkPut(
          rows.map((row) => ({
            key: `steps:${row.id}`,
            table: 'steps' as const,
            id: row.id,
            project_id: project.id,
            queued_at: stamp,
          })),
        );
      }
    },
  );

  return project;
}

/**
 * Bulk add by range (`1001–1040`, §5 screen 3). Each apartment gets a copy of the project's
 * template steps, so its status and progress are derived rather than stored.
 */
export async function addApartmentRange(
  database: FieldDB,
  projectId: string,
  from: number,
  to: number,
): Promise<number> {
  const stamp = nowIso();
  const template = await database.steps
    .where('project_id')
    .equals(projectId)
    .filter((step) => step.apartment_id === null && !step.deleted_at)
    .toArray();

  const apartments: Apartment[] = [];
  const steps: Step[] = [];
  const dirty: DirtyRow[] = [];

  for (let n = from; n <= to; n += 1) {
    const apartment: Apartment = {
      id: newId(),
      project_id: projectId,
      building: null,
      stairwell: null,
      unit_number: String(n),
      floor: null,
      notes: null,
      created_at: stamp,
      updated_at: stamp,
      deleted_at: null,
    };
    apartments.push(apartment);
    dirty.push({
      key: `apartments:${apartment.id}`,
      table: 'apartments',
      id: apartment.id,
      project_id: projectId,
      queued_at: stamp,
    });

    for (const source of template) {
      const step: Step = {
        ...source,
        id: newId(),
        apartment_id: apartment.id,
        status: 'ej_klar',
        comment: null,
        created_at: stamp,
        updated_at: stamp,
        deleted_at: null,
      };
      steps.push(step);
      dirty.push({
        key: `steps:${step.id}`,
        table: 'steps',
        id: step.id,
        project_id: projectId,
        queued_at: stamp,
      });
    }
  }

  await database.transaction(
    'rw',
    database.apartments,
    database.steps,
    database.dirty,
    async () => {
      await database.apartments.bulkPut(apartments);
      if (steps.length > 0) await database.steps.bulkPut(steps);
      await database.dirty.bulkPut(dirty);
    },
  );

  return apartments.length;
}
