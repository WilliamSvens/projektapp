import { setStepComment, setStepStatus } from '../db/db';
import {
  APARTMENT_LABEL,
  apartmentStatus,
  progressPct,
  STEP_LABEL,
  STEP_STATUSES,
  type StepStatus,
} from '../domain/status';
import { el } from '../lib/util';
import type { Ctx } from './context';
import { attachPhoto } from './step-photo';

const ACTIVE_CLASS: Record<StepStatus, string> = {
  klar: 'border-green-600 bg-green-600 text-white',
  delvis: 'border-amber-500 bg-amber-500 text-white',
  ej_klar: 'border-slate-400 bg-slate-400 text-white',
};

/** Tapping the active state does nothing, so this never cycles (§2.1). */
function paintButtons(group: HTMLElement, active: StepStatus): void {
  for (const button of group.querySelectorAll<HTMLButtonElement>('button[data-status]')) {
    const status = button.dataset.status as StepStatus;
    const isActive = status === active;
    button.className = isActive
      ? `state-button ${ACTIVE_CLASS[status]}`
      : 'state-button border-slate-300 bg-white text-slate-700';
    button.setAttribute('aria-checked', String(isActive));
  }
}

export async function renderChecklist(
  host: HTMLElement,
  ctx: Ctx,
  projectId: string,
  apartmentId: string,
): Promise<void> {
  const { database } = ctx;
  const apartment = await database.apartments.get(apartmentId);
  const wrap = el('div', 'px-4 py-4 space-y-4');

  if (!apartment) {
    wrap.append(el('p', 'text-sm text-slate-500', 'Lägenheten finns inte på enheten.'));
    host.append(wrap);
    return;
  }

  const back = el('button', 'text-sm font-semibold text-slate-600', '‹ Lägenheter');
  back.type = 'button';
  back.addEventListener('click', () => ctx.navigate(`#/p/${projectId}`));

  const title = el('h1', 'text-xl font-bold', `Lägenhet ${apartment.unit_number}`);
  const progressText = el('p', 'text-xs text-slate-500', '');
  const bar = el('div', 'h-1.5 w-full overflow-hidden rounded-full bg-slate-200');
  const fill = el('div', 'h-full rounded-full bg-slate-900');
  bar.append(fill);
  wrap.append(back, title, progressText, bar);

  async function refreshProgress(): Promise<void> {
    const current = (await database.steps.where('apartment_id').equals(apartmentId).toArray()).filter(
      (step) => !step.deleted_at,
    );
    progressText.textContent = `${APARTMENT_LABEL[apartmentStatus(current)]} · ${progressPct(current)}% klart`;
    fill.style.width = `${progressPct(current)}%`;
  }

  const steps = (await database.steps.where('apartment_id').equals(apartmentId).toArray())
    .filter((step) => !step.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order);

  let currentCategory = '';
  for (const step of steps) {
    if (step.category !== currentCategory) {
      currentCategory = step.category;
      wrap.append(el('h2', 'pt-2 text-xs font-bold uppercase tracking-wide text-slate-500', currentCategory));
    }

    const card = el('div', 'card space-y-3');
    const heading = el('div');
    const stepTitle = el('p', 'text-sm font-semibold', step.title);
    heading.append(stepTitle);
    if (step.subcategory) {
      heading.append(el('p', 'text-[11px] text-slate-500', step.subcategory));
    }

    const group = el('div', 'flex gap-2');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', step.title);

    for (const status of STEP_STATUSES) {
      const button = el('button', 'state-button');
      button.type = 'button';
      button.dataset.status = status;
      button.setAttribute('role', 'radio');
      button.textContent = STEP_LABEL[status];
      button.addEventListener('click', () => {
        void (async () => {
          const fresh = await database.steps.get(step.id);
          if (!fresh) return;
          const changed = await setStepStatus(database, fresh, status);
          if (!changed) return;
          paintButtons(group, status);
          await refreshProgress();
          await ctx.refreshHeader();
        })();
      });
      group.append(button);
    }
    paintButtons(group, step.status);

    const secondary = el('div', 'flex items-center gap-2');
    const comment = el('input', 'field text-sm');
    comment.placeholder = 'Kommentar';
    comment.value = step.comment ?? '';
    comment.addEventListener('change', () => {
      void (async () => {
        const fresh = await database.steps.get(step.id);
        if (!fresh) return;
        await setStepComment(database, fresh, comment.value);
        await ctx.refreshHeader();
      })();
    });

    const photoSlot = el('div', 'flex flex-wrap gap-2');
    secondary.append(comment);
    card.append(heading, group, secondary, photoSlot);
    wrap.append(card);

    void attachPhoto({
      ctx,
      step,
      container: photoSlot,
      anchor: secondary,
    });
  }

  host.append(wrap);
  await refreshProgress();
}
