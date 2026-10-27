import { describe, expect, it } from 'vitest';
import {
  apartmentStatus,
  progressPct,
  projectProgress,
  stepProgress,
  type StepStatus,
} from '../src/domain/status';

function steps(...statuses: StepStatus[]) {
  return statuses.map((status) => ({ status }));
}

function unit(apartmentId: string | null, ...statuses: StepStatus[]) {
  return statuses.map((status) => ({ status, apartment_id: apartmentId }));
}

function apartments(...ids: string[]) {
  return ids.map((id) => ({ id }));
}

describe('step progress', () => {
  it('counts delvis as half', () => {
    expect(stepProgress('klar')).toBe(1);
    expect(stepProgress('delvis')).toBe(0.5);
    expect(stepProgress('ej_klar')).toBe(0);
    expect(stepProgress(undefined)).toBe(0);
  });

  it('rounds down, never up', () => {
    // 2 klar + 1 delvis of 4 = 62.5 % -> 62 %
    expect(progressPct(steps('klar', 'klar', 'delvis', 'ej_klar'))).toBe(62);
    // 2 of 3 = 66.6 % -> 66 %
    expect(progressPct(steps('klar', 'klar', 'ej_klar'))).toBe(66);
  });

  it('never reports 100 % while a step is only delvis', () => {
    expect(progressPct(steps('klar', 'delvis'))).toBe(75);
    expect(apartmentStatus(steps('klar', 'delvis'))).toBe('pagaende');
  });

  it('treats an apartment without steps as not started', () => {
    expect(progressPct([])).toBe(0);
    expect(apartmentStatus([])).toBe('ej_paborjad');
  });

  it('ignores deleted steps', () => {
    const withTombstone = [
      { status: 'klar' as StepStatus, deleted_at: null },
      { status: 'ej_klar' as StepStatus, deleted_at: '2026-10-01T10:00:00Z' },
    ];
    expect(progressPct(withTombstone)).toBe(100);
    expect(apartmentStatus(withTombstone)).toBe('klar');
  });

  it('derives the three apartment states', () => {
    expect(apartmentStatus(steps('klar', 'klar'))).toBe('klar');
    expect(apartmentStatus(steps('ej_klar', 'klar'))).toBe('pagaende');
    expect(apartmentStatus(steps('ej_klar', 'ej_klar'))).toBe('ej_paborjad');
  });
});

describe('project progress', () => {
  it('ignores the project-level template rows when no apartment can tick them', () => {
    // createProject copies the template with apartment_id = null; addApartmentRange clones it.
    const all = [...unit(null, 'ej_klar', 'ej_klar', 'ej_klar'), ...unit('a1', 'klar', 'klar', 'klar')];
    expect(projectProgress(all, apartments('a1'))).toEqual({
      pct: 100,
      doneApartments: 1,
      totalApartments: 1,
    });
  });

  it('matches the apartment grid for a single apartment', () => {
    const all = [...unit(null, 'ej_klar'), ...unit('a1', 'klar', 'delvis', 'ej_klar')];
    const result = projectProgress(all, apartments('a1'));
    expect(result.pct).toBe(progressPct(unit('a1', 'klar', 'delvis', 'ej_klar')));
    expect(result.pct).toBe(50);
  });

  it('counts a unit as done only when every step is klar', () => {
    const all = [...unit('a1', 'klar', 'klar'), ...unit('a2', 'klar', 'delvis')];
    expect(projectProgress(all, apartments('a1', 'a2'))).toEqual({
      pct: 87,
      doneApartments: 1,
      totalApartments: 2,
    });
  });

  it('drops steps of deleted apartments, so their work cannot hold the project back', () => {
    const all = [...unit('gone', 'klar', 'klar'), ...unit('a1', 'klar', 'ej_klar')];
    const live = [{ id: 'a1' }, { id: 'gone', deleted_at: '2026-10-20T08:00:00Z' }];
    expect(projectProgress(all, live)).toEqual({
      pct: 50,
      doneApartments: 0,
      totalApartments: 1,
    });
  });

  it('ignores deleted steps and steps of an unknown apartment', () => {
    const all = [
      { status: 'klar' as StepStatus, apartment_id: 'a1', deleted_at: '2026-10-20T08:00:00Z' },
      ...unit('a1', 'klar'),
      ...unit('orphan', 'ej_klar', 'ej_klar'),
    ];
    expect(projectProgress(all, apartments('a1'))).toEqual({
      pct: 100,
      doneApartments: 1,
      totalApartments: 1,
    });
  });

  it('reports nothing to work on before the first apartment exists', () => {
    expect(projectProgress(unit(null, 'klar', 'klar'), [])).toEqual({
      pct: 0,
      doneApartments: 0,
      totalApartments: 0,
    });
  });
});
