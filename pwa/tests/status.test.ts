import { describe, expect, it } from 'vitest';
import {
  apartmentStatus,
  progressPct,
  stepProgress,
  type StepStatus,
} from '../src/domain/status';

function steps(...statuses: StepStatus[]) {
  return statuses.map((status) => ({ status }));
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
