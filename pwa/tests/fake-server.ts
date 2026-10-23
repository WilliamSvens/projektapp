import type { Row, SyncBackend } from '../src/sync/backend';
import type { TableName } from '../src/db/db';

/** PostgREST-shaped stand-in: last write wins, notes reject a second insert, rev is a column. */
export class FakeServer implements SyncBackend {
  readonly tables = new Map<TableName, Map<string, Row>>();
  readonly uploads: string[] = [];
  failNextUpsert = false;

  private table(name: TableName): Map<string, Row> {
    let found = this.tables.get(name);
    if (!found) {
      found = new Map<string, Row>();
      this.tables.set(name, found);
    }
    return found;
  }

  rows(name: TableName): Row[] {
    return [...this.table(name).values()];
  }

  put(name: TableName, row: Row): void {
    this.table(name).set(String(row.id), { ...row });
  }

  remove(name: TableName, id: string): void {
    this.table(name).delete(id);
  }

  setRev(projectId: string, rev: number): void {
    const row = this.table('projects').get(projectId);
    if (row) row.rev = rev;
  }

  async upsert(
    table: TableName,
    rows: Row[],
    options?: { ignoreDuplicates?: boolean },
  ): Promise<void> {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error('nätverket försvann');
    }

    const target = this.table(table);
    for (const row of rows) {
      const id = String(row.id);
      const existing = target.get(id);
      if (options?.ignoreDuplicates && existing) continue;
      // `rev` has a column default of 0 server-side and is never taken from the client.
      target.set(id, { ...existing, ...row, ...(table === 'projects' ? { rev: existing?.rev ?? 0 } : {}) });
    }
  }

  async pull(table: TableName, projectId: string): Promise<Row[]> {
    return this.rows(table).filter((row) =>
      table === 'projects' ? row.id === projectId : row.project_id === projectId,
    );
  }

  async pullProjects(): Promise<Row[]> {
    return this.rows('projects');
  }

  async bumpRev(projectId: string, rev: number): Promise<number | null> {
    const row = this.table('projects').get(projectId);
    if (!row) return null;
    const current = typeof row.rev === 'number' ? row.rev : 0;
    if (current !== rev) return null;
    const next = current + 1;
    row.rev = next;
    return next;
  }

  async fetchRev(projectId: string): Promise<number | null> {
    const row = this.table('projects').get(projectId);
    return typeof row?.rev === 'number' ? row.rev : null;
  }

  async uploadPhoto(path: string): Promise<void> {
    if (!this.uploads.includes(path)) this.uploads.push(path);
  }

  async downloadPhoto(): Promise<Blob> {
    return new Blob(['jpeg'], { type: 'image/jpeg' });
  }
}
