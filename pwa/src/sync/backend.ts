import type { SupabaseClient } from '@supabase/supabase-js';
import type { TableName } from '../db/db';

export type Row = Record<string, unknown>;

/**
 * The whole surface the sync code needs from the server. Narrow on purpose: the sync
 * semantics in §3.3/§3.4 can then be tested against an in-memory fake with no network,
 * and swapping PostgREST for anything else touches only this file.
 */
export interface SyncBackend {
  upsert(
    table: TableName,
    rows: Row[],
    options?: { ignoreDuplicates?: boolean },
  ): Promise<void>;
  pull(table: TableName, projectId: string): Promise<Row[]>;
  pullProjects(): Promise<Row[]>;
  bumpRev(projectId: string, rev: number): Promise<number | null>;
  fetchRev(projectId: string): Promise<number | null>;
  uploadPhoto(path: string, blob: Blob): Promise<void>;
  downloadPhoto(path: string): Promise<Blob>;
}

export function createSupabaseBackend(client: SupabaseClient): SyncBackend {
  return {
    async upsert(table, rows, options) {
      const { error } = await client
        .from(table)
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: options?.ignoreDuplicates ?? false });
      if (error) throw new Error(`${table}: ${error.message}`);
    },

    async pull(table, projectId) {
      // `projects` is keyed by its own id; every other table hangs off project_id.
      const column = table === 'projects' ? 'id' : 'project_id';
      const { data, error } = await client.from(table).select('*').eq(column, projectId);
      if (error) throw new Error(`${table}: ${error.message}`);
      return (data ?? []) as Row[];
    },

    async pullProjects() {
      const { data, error } = await client.from('projects').select('*');
      if (error) throw new Error(`projects: ${error.message}`);
      return (data ?? []) as Row[];
    },

    async bumpRev(projectId, rev) {
      // 0 rows updated returns null: another device pushed first (§3.3 step 4).
      const { data, error } = await client.rpc('bump_project_rev', {
        p_project: projectId,
        p_rev: rev,
      });
      if (error) throw new Error(`rev: ${error.message}`);
      return typeof data === 'number' ? data : null;
    },

    async fetchRev(projectId) {
      const { data, error } = await client
        .from('projects')
        .select('rev')
        .eq('id', projectId)
        .maybeSingle();
      if (error) throw new Error(`rev: ${error.message}`);
      const rev = (data as { rev?: number } | null)?.rev;
      return typeof rev === 'number' ? rev : null;
    },

    async uploadPhoto(path, blob) {
      // `upsert: true` plus a deterministic path is what makes a killed upload resume
      // as one object instead of two (§9 acceptance test).
      const { error } = await client.storage
        .from('photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(`photo ${path}: ${error.message}`);
    },

    async downloadPhoto(path) {
      const { data, error } = await client.storage.from('photos').download(path);
      if (error) throw new Error(`photo ${path}: ${error.message}`);
      return data;
    },
  };
}
