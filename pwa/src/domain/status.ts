// Three-state step status (docs/SPEC-V1.md §2.1). Stored codes are ASCII and never the
// Swedish label, so the Excel macro can compare strings and progress can be summed.

export type StepStatus = 'klar' | 'delvis' | 'ej_klar';
export type ApartmentStatus = 'klar' | 'pagaende' | 'ej_paborjad';

export const STEP_STATUSES: readonly StepStatus[] = ['klar', 'delvis', 'ej_klar'];

export const STEP_LABEL: Record<StepStatus, string> = {
  klar: 'Klar',
  delvis: 'Delvis klar',
  ej_klar: 'Ej klar',
};

export const STEP_PROGRESS: Record<StepStatus, number> = {
  klar: 1,
  delvis: 0.5,
  ej_klar: 0,
};

export const STATUS_COLOR: Record<StepStatus, 'green' | 'amber' | 'grey'> = {
  klar: 'green',
  delvis: 'amber',
  ej_klar: 'grey',
};

export const APARTMENT_LABEL: Record<ApartmentStatus, string> = {
  klar: 'Klar',
  pagaende: 'Pågående',
  ej_paborjad: 'Ej påbörjad',
};

export function isStepStatus(value: unknown): value is StepStatus {
  return value === 'klar' || value === 'delvis' || value === 'ej_klar';
}

export function stepProgress(status: StepStatus | null | undefined): number {
  return STEP_PROGRESS[status ?? 'ej_klar'];
}

type StepLike = { status: StepStatus | string | null; deleted_at?: string | null };

function live(statuses: StepLike[]): StepStatus[] {
  return statuses
    .filter((s) => !s.deleted_at)
    .map((s) => (isStepStatus(s.status) ? s.status : 'ej_klar'));
}

/**
 * `delvis` never counts as complete: it cannot make an apartment `klar` and cannot satisfy
 * a close-project check (§2.1). An apartment with no steps at all is `ej_paborjad`, not `klar`.
 */
export function apartmentStatus(steps: StepLike[]): ApartmentStatus {
  const statuses = live(steps);
  if (statuses.length === 0) return 'ej_paborjad';
  if (statuses.every((s) => s === 'klar')) return 'klar';
  if (statuses.some((s) => s === 'klar' || s === 'delvis')) return 'pagaende';
  return 'ej_paborjad';
}

/** Rounded down, so 2 `klar` + 1 `delvis` of 4 steps reads 62 %, never 63 %. */
export function progressPct(steps: StepLike[]): number {
  const statuses = live(steps);
  if (statuses.length === 0) return 0;
  const sum = statuses.reduce((acc, s) => acc + stepProgress(s), 0);
  return Math.floor((sum / statuses.length) * 100);
}
