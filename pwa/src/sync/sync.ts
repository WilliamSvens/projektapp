import type { Table } from 'dexie';
import {
  BUSINESS_TABLES,
  FieldDB,
  setMeta,
  type TableName,
} from '../db/db';
import { clockHHMM, isOnline, nowIso } from '../lib/util';
import type { Row, SyncBackend } from './backend';
import type { SyncStore } from './state';

async function loadRows(database: FieldDB, table: TableName, ids: string[]): Promise<Row[]> {
  const ref = database[table] as unknown as Table<Row, string>;
  const rows = await ref.bulkGet(ids);
  // Rows deleted locally between queueing and pushing are simply skipped.
  return rows.filter((row): row is Row => Boolean(row));
}

/**
 * §3.3. Order is load-bearing: photos upload before their row exists, rows before the rev
 * bump, and the rev bump before any dirty flag is cleared. A failure anywhere throws and
 * leaves every local row exactly where it was.
 */
export async function pushLocal(database: FieldDB, backend: SyncBackend): Promise<number> {
  const dirty = await database.dirty.toArray();
  if (dirty.length === 0) return 0;

  const idsByTable = new Map<TableName, string[]>();
  for (const entry of dirty) {
    const list = idsByTable.get(entry.table) ?? [];
    list.push(entry.id);
    idsByTable.set(entry.table, list);
  }

  // 1. Blobs first, at a deterministic path, so a retry cannot create a second object.
  for (const id of idsByTable.get('photos') ?? []) {
    const photo = await database.photos.get(id);
    if (!photo || photo.storage_path) continue;
    const stored = await database.blobs.get(id);
    if (!stored) continue;
    const path = `${photo.project_id}/${photo.id}.jpg`;
    await backend.uploadPhoto(path, stored.blob);
    await database.photos.update(id, { storage_path: path });
  }

  // 2. Rows. Notes are insert-only; ignoreDuplicates makes a retry after a crash a no-op
  //    instead of a duplicate-key error.
  for (const table of BUSINESS_TABLES) {
    const ids = idsByTable.get(table) ?? [];
    if (ids.length === 0) continue;
    const rows = await loadRows(database, table, ids);
    if (rows.length === 0) continue;
    if (table === 'projects') {
      // `rev` is server-owned: sending a stale value would rewind it.
      for (const row of rows) delete row.rev;
    }
    await backend.upsert(table, rows, { ignoreDuplicates: table === 'notes' });
  }

  // 3. One rev bump per touched project.
  for (const projectId of new Set(dirty.map((entry) => entry.project_id))) {
    await bumpOnce(database, backend, projectId);
  }

  // 4. Only now is the work safe to forget.
  await database.dirty.bulkDelete(dirty.map((entry) => entry.key));
  return dirty.length;
}

async function bumpOnce(
  database: FieldDB,
  backend: SyncBackend,
  projectId: string,
): Promise<void> {
  const local = await database.projects.get(projectId);
  const current = local?.rev ?? 0;
  let next = await backend.bumpRev(projectId, current);

  if (next === null) {
    // Another device pushed first: take its rev and continue (§3.3 step 4).
    const serverRev = await backend.fetchRev(projectId);
    if (serverRev === null) return;
    next = await backend.bumpRev(projectId, serverRev);
  }

  if (next !== null) await database.projects.update(projectId, { rev: next });
}

/**
 * §3.4. Wholesale replace is only safe because push ran first and left no dirty rows for
 * this project — so the guard is an assertion, not a warning.
 */
export async function pullProject(
  database: FieldDB,
  backend: SyncBackend,
  projectId: string,
): Promise<void> {
  const dirtyLeft = await database.dirty.where('project_id').equals(projectId).count();
  if (dirtyLeft > 0) throw new Error('pull avbruten: osynkade rader finns kvar');

  const payload = new Map<TableName, Row[]>();
  for (const table of BUSINESS_TABLES) {
    payload.set(table, await backend.pull(table, projectId));
  }

  // An empty `projects` payload means the row is gone *or* invisible to this account. Both
  // must fail loudly rather than silently deleting the open project from the device.
  if ((payload.get('projects') ?? []).length === 0) {
    throw new Error('Projektet hittades inte på servern. Kontrollera inloggning och behörighet.');
  }

  await database.transaction(
    'rw',
    [database.projects, database.apartments, database.steps, database.notes, database.photos, database.measurements],
    async () => {
      for (const table of BUSINESS_TABLES) {
        const rows = payload.get(table) ?? [];
        const ref = database[table] as unknown as Table<Row, string>;
        const keyPath = table === 'projects' ? 'id' : 'project_id';
        const localIds = await ref.where(keyPath).equals(projectId).primaryKeys();
        const serverIds = new Set(rows.map((row) => String(row.id)));
        const stale = localIds.filter((id) => !serverIds.has(String(id)));
        if (stale.length > 0) await ref.bulkDelete(stale);
        if (rows.length > 0) await ref.bulkPut(rows as never);
      }
    },
  );

  await setMeta(database, 'last_sync_at', nowIso());

  await downloadMissingPhotos(database, backend, projectId);
}

/**
 * Photos captured on another device live only in Storage. Fetching them is part of the pull,
 * so the acceptance rule "the only network calls are the button and the auth refresh" still
 * holds — nothing here is triggered by scrolling.
 */
async function downloadMissingPhotos(
  database: FieldDB,
  backend: SyncBackend,
  projectId: string,
): Promise<void> {
  const photos = await database.photos.where('project_id').equals(projectId).toArray();
  for (const photo of photos) {
    if (!photo.storage_path || photo.deleted_at) continue;
    const existing = await database.blobs.get(photo.id);
    if (existing) continue;
    try {
      const blob = await backend.downloadPhoto(photo.storage_path);
      await database.blobs.put({ id: photo.id, blob });
    } catch {
      // A missing thumbnail must never block the rest of the pull; the next press retries.
    }
  }
}

/** Screen 1 has no open project, so it only refreshes the list. */
export async function pullProjectList(
  database: FieldDB,
  backend: SyncBackend,
): Promise<void> {
  const rows = await backend.pullProjects();
  const serverIds = new Set(rows.map((row) => String(row.id)));
  const dirtyProjects = new Set((await database.dirty.toArray()).map((row) => row.project_id));

  await database.transaction('rw', database.projects, async () => {
    const localIds = await database.projects.toCollection().primaryKeys();
    // Never delete a project that still holds unsynced work.
    const stale = localIds.filter(
      (id) => !serverIds.has(String(id)) && !dirtyProjects.has(String(id)),
    );
    if (stale.length > 0) await database.projects.bulkDelete(stale);
    if (rows.length > 0) await database.projects.bulkPut(rows as never);
  });

  await setMeta(database, 'last_sync_at', nowIso());
}

/** Push before pull, always. No pull after a failed push (§3.1 rules 4 and 5). */
export async function runSync(
  database: FieldDB,
  backend: SyncBackend,
  store: SyncStore,
  projectId: string | null,
): Promise<void> {
  if (!isOnline()) {
    store.set({ kind: 'offline' });
    return;
  }

  store.set({ kind: 'syncing' });

  try {
    await pushLocal(database, backend);
  } catch (error) {
    store.set({ kind: 'error', phase: 'push', message: messageOf(error) });
    return;
  }

  try {
    if (projectId) await pullProject(database, backend, projectId);
    else await pullProjectList(database, backend);
  } catch (error) {
    store.set({ kind: 'error', phase: 'pull', message: messageOf(error) });
    return;
  }

  store.set({ kind: 'synced', at: clockHHMM() });
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

