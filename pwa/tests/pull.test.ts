import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FieldDB, createProject, type Photo } from '../src/db/db';
import { pullProject, pullProjectList, pushLocal } from '../src/sync/sync';
import { FakeServer } from './fake-server';

let database: FieldDB;
let server: FakeServer;

beforeEach(() => {
  database = new FieldDB(`pull-${crypto.randomUUID()}`);
  server = new FakeServer();
});

afterEach(async () => {
  await database.delete();
});

describe('pull', () => {
  it('replaces the project wholesale, including rows deleted on the server', async () => {
    const project = await createProject(database, {
      name: 'Brädgatan 4',
      projectType: 'cat6',
    });
    await pushLocal(database, server);

    const remoteSteps = server.rows('steps');
    expect(remoteSteps).toHaveLength(11);
    const removed = remoteSteps[0]!;
    const survivor = remoteSteps[1]!;
    survivor.status = 'klar';
    server.remove('steps', String(removed.id));
    server.put('steps', {
      id: 'brand-new',
      project_id: project.id,
      apartment_id: null,
      category: 'Test',
      subcategory: null,
      title: 'Ny rad från annan enhet',
      sort_order: 99,
      status: 'ej_klar',
      skip_reason: null,
      comment: null,
      created_at: '2026-10-23T10:00:00.000Z',
      updated_at: '2026-10-23T10:00:00.000Z',
      deleted_at: null,
    });

    await pullProject(database, server, project.id);

    const localSteps = await database.steps.where('project_id').equals(project.id).toArray();
    expect(localSteps).toHaveLength(11);
    expect(localSteps.some((step) => step.id === removed.id)).toBe(false);
    expect(localSteps.find((step) => step.id === survivor.id)?.status).toBe('klar');
    expect(localSteps.some((step) => step.title === 'Ny rad från annan enhet')).toBe(true);
  });

  it('refuses to pull while this project still has unsynced rows', async () => {
    const project = await createProject(database, { name: 'X', projectType: 'cat6' });
    await expect(pullProject(database, server, project.id)).rejects.toThrow(
      'pull avbruten: osynkade rader finns kvar',
    );
    expect(await database.steps.where('project_id').equals(project.id).count()).toBe(11);
  });

  it('never deletes a local project that still holds unsynced work', async () => {
    const project = await createProject(database, { name: 'Endast lokal', projectType: 'cat6' });
    await pullProjectList(database, server);
    expect(await database.projects.get(project.id)).toBeDefined();
  });

  it('drops a clean local project that the server no longer has', async () => {
    const project = await createProject(database, { name: 'Borttagen', projectType: 'cat6' });
    await pushLocal(database, server);
    server.remove('projects', project.id);

    await pullProjectList(database, server);

    expect(await database.projects.get(project.id)).toBeUndefined();
  });

  it('leaves the open project untouched when the server does not return it', async () => {
    const project = await createProject(database, { name: 'Osynlig', projectType: 'cat6' });
    await pushLocal(database, server);
    server.remove('projects', project.id);

    await expect(pullProject(database, server, project.id)).rejects.toThrow('hittades inte på servern');

    expect(await database.projects.get(project.id)).toBeDefined();
    expect(await database.steps.where('project_id').equals(project.id).count()).toBe(11);
  });

  it('downloads photo blobs that only exist in Storage', async () => {
    const project = await createProject(database, { name: 'X', projectType: 'cat6' });
    await pushLocal(database, server);

    const photo: Photo = {
      id: 'photo-1',
      project_id: project.id,
      apartment_id: null,
      step_id: null,
      storage_path: `${project.id}/photo-1.jpg`,
      caption: null,
      taken_at: null,
      captured_lat: null,
      captured_lng: null,
      gps_accuracy_m: null,
      width: null,
      height: null,
      bytes: null,
      created_at: '2026-10-23T10:00:00.000Z',
      deleted_at: null,
    };
    server.put('photos', { ...photo });

    await pullProject(database, server, project.id);

    expect(await database.blobs.get(photo.id)).toBeDefined();
  });
});
