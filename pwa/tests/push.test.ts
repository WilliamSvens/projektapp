import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FieldDB,
  addNote,
  createProject,
  markDirty,
  setStepStatus,
  type Photo,
} from '../src/db/db';
import { pushLocal } from '../src/sync/sync';
import { FakeServer } from './fake-server';

let database: FieldDB;
let server: FakeServer;

beforeEach(() => {
  database = new FieldDB(`push-${crypto.randomUUID()}`);
  server = new FakeServer();
});

afterEach(async () => {
  await database.delete();
});

function jpeg(): Blob {
  return new Blob(['jpeg'], { type: 'image/jpeg' });
}

describe('push', () => {
  it('sends the project and its 36 template steps, then bumps rev once', async () => {
    const project = await createProject(database, {
      name: 'Brädgatan 4',
      projectType: 'fiber_apartment',
    });
    expect(await database.dirty.count()).toBe(37);

    const pushed = await pushLocal(database, server);

    expect(pushed).toBe(37);
    expect(await database.dirty.count()).toBe(0);
    expect(server.rows('steps')).toHaveLength(36);
    expect(server.rows('projects')).toHaveLength(1);
    expect(server.rows('projects')[0]!.rev).toBe(1);
    expect((await database.projects.get(project.id))?.rev).toBe(1);
  });

  it('keeps every dirty flag when an upsert fails, then drains on retry', async () => {
    await createProject(database, { name: 'Brädgatan 4', projectType: 'fiber_apartment' });
    server.failNextUpsert = true;

    await expect(pushLocal(database, server)).rejects.toThrow('nätverket försvann');
    expect(await database.dirty.count()).toBe(37);
    expect(server.rows('steps')).toHaveLength(0);

    await pushLocal(database, server);
    expect(await database.dirty.count()).toBe(0);
    expect(server.rows('steps')).toHaveLength(36);
  });

  it('pushes a single status change and bumps rev again', async () => {
    const project = await createProject(database, {
      name: 'Brädgatan 4',
      projectType: 'fiber_apartment',
    });
    await pushLocal(database, server);

    const step = (await database.steps.where('project_id').equals(project.id).toArray())[0]!;
    await setStepStatus(database, step, 'delvis');
    expect(await database.dirty.count()).toBe(1);

    await pushLocal(database, server);

    const remote = server.rows('steps').find((row) => row.id === step.id);
    expect(remote?.status).toBe('delvis');
    expect((await database.projects.get(project.id))?.rev).toBe(2);
  });

  it('does not queue anything when the active state is tapped again', async () => {
    const project = await createProject(database, { name: 'X', projectType: 'cat6' });
    await pushLocal(database, server);
    const step = (await database.steps.where('project_id').equals(project.id).toArray())[0]!;

    expect(await setStepStatus(database, step, 'klar')).toBe(true);
    const fresh = (await database.steps.get(step.id))!;
    expect(await setStepStatus(database, fresh, 'klar')).toBe(false);
    expect(await database.dirty.count()).toBe(1);
  });

  it('re-sending a note is a no-op instead of a duplicate', async () => {
    const project = await createProject(database, { name: 'X', projectType: 'cat6' });
    const note = await addNote(database, {
      projectId: project.id,
      apartmentId: null,
      stepId: null,
      body: 'Hyresgäst ej hemma',
      authorEmail: 'svenwilliamsvens@gmail.com',
    });

    await pushLocal(database, server);
    await markDirty(database, 'notes', note.id, project.id);
    await pushLocal(database, server);

    expect(server.rows('notes')).toHaveLength(1);
  });

  it('uploads a photo once, at a deterministic path, even after a crash', async () => {
    const project = await createProject(database, { name: 'X', projectType: 'cat6' });
    await pushLocal(database, server);

    const photo: Photo = {
      id: crypto.randomUUID(),
      project_id: project.id,
      apartment_id: null,
      step_id: null,
      storage_path: null,
      caption: null,
      taken_at: '2026-10-23T10:00:00.000Z',
      captured_lat: null,
      captured_lng: null,
      gps_accuracy_m: null,
      width: 1600,
      height: 1200,
      bytes: 240_000,
      created_at: '2026-10-23T10:00:00.000Z',
      deleted_at: null,
    };
    await database.photos.put(photo);
    await database.blobs.put({ id: photo.id, blob: jpeg() });
    await markDirty(database, 'photos', photo.id, project.id);

    await pushLocal(database, server);

    const path = `${project.id}/${photo.id}.jpg`;
    expect(server.uploads).toEqual([path]);
    expect((await database.photos.get(photo.id))?.storage_path).toBe(path);
    expect(server.rows('photos')).toHaveLength(1);

    // Simulates dying between "row accepted" and "dirty cleared": the retry must not re-upload.
    await markDirty(database, 'photos', photo.id, project.id);
    await pushLocal(database, server);

    expect(server.uploads).toEqual([path]);
    expect(server.rows('photos')).toHaveLength(1);
  });

  it('adopts the server rev when another device pushed first', async () => {
    const project = await createProject(database, { name: 'X', projectType: 'cat6' });
    await pushLocal(database, server);
    server.setRev(project.id, 5);

    const step = (await database.steps.where('project_id').equals(project.id).toArray())[0]!;
    await setStepStatus(database, step, 'klar');
    await pushLocal(database, server);

    expect((await database.projects.get(project.id))?.rev).toBe(6);
    expect(await database.dirty.count()).toBe(0);
  });
});
