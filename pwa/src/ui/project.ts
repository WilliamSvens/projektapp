import { addApartmentRange } from '../db/db';
import { APARTMENT_LABEL, apartmentStatus, progressPct, projectProgress } from '../domain/status';
import { el } from '../lib/util';
import type { Ctx } from './context';

const APARTMENT_CLASS = {
  klar: 'bg-green-600 text-white',
  pagaende: 'bg-amber-500 text-white',
  ej_paborjad: 'bg-slate-200 text-slate-700',
} as const;

export async function renderProject(
  host: HTMLElement,
  ctx: Ctx,
  projectId: string,
): Promise<void> {
  const { database } = ctx;
  const project = await database.projects.get(projectId);
  const wrap = el('div', 'px-4 py-4 space-y-4');

  if (!project) {
    wrap.append(el('p', 'text-sm text-slate-500', 'Projektet finns inte på enheten.'));
    host.append(wrap);
    return;
  }

  const steps = await database.steps.where('project_id').equals(projectId).toArray();
  const apartments = (await database.apartments.where('project_id').equals(projectId).toArray())
    .filter((apartment) => !apartment.deleted_at)
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, 'sv-SE', { numeric: true }));

  const back = el('button', 'text-sm font-semibold text-slate-600', '‹ Projekt');
  back.type = 'button';
  back.addEventListener('click', () => ctx.navigate('#/'));

  const title = el('h1', 'text-xl font-bold', project.name);
  const meta = el(
    'p',
    'text-xs text-slate-500',
    [project.customer, project.address].filter(Boolean).join(' · ') || 'Ingen beställare angiven',
  );

  const progress = projectProgress(steps, apartments);
  const pct = progress.pct;
  const progressRow = el('div', 'space-y-1');
  const progressText = el(
    'p',
    'text-xs text-slate-500',
    progress.totalApartments === 0
      ? 'Inga lägenheter än'
      : `${progress.doneApartments} av ${progress.totalApartments} lägenheter klara · ${pct}% klart`,
  );
  const bar = el('div', 'h-1.5 w-full overflow-hidden rounded-full bg-slate-200');
  const fill = el('div', 'h-full rounded-full bg-slate-900');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  progressRow.append(progressText, bar);

  // --- bulk add by range -----------------------------------------------------
  const form = el('form', 'card space-y-3');
  const formTitle = el('p', 'text-sm font-semibold', 'Lägg till lägenheter');
  const rangeRow = el('div', 'flex items-end gap-2');
  const fromInput = el('input', 'field');
  fromInput.type = 'number';
  fromInput.placeholder = 'Från';
  fromInput.value = apartments.length > 0 ? String(Number(apartments[apartments.length - 1]!.unit_number) + 1) : '1001';
  const toInput = el('input', 'field');
  toInput.type = 'number';
  toInput.placeholder = 'Till';
  toInput.value = fromInput.value;
  const addButton = el('button', 'min-h-11 shrink-0 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white', 'Lägg till');
  addButton.type = 'submit';
  rangeRow.append(fromInput, toInput, addButton);
  form.append(formTitle, rangeRow);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const from = Number(fromInput.value);
    const to = Number(toInput.value);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return;
    await addApartmentRange(database, projectId, from, to);
    await ctx.refreshHeader();
    ctx.navigate(`#/p/${projectId}`);
  });

  // --- unit grid -------------------------------------------------------------
  const grid = el('div', 'grid grid-cols-3 gap-2');
  const stepsByApartment = new Map<string, typeof steps>();
  for (const step of steps) {
    if (!step.apartment_id || step.deleted_at) continue;
    const list = stepsByApartment.get(step.apartment_id) ?? [];
    list.push(step);
    stepsByApartment.set(step.apartment_id, list);
  }

  if (apartments.length === 0) {
    grid.append(el('p', 'col-span-3 text-sm text-slate-500', 'Inga lägenheter än.'));
  }

  for (const apartment of apartments) {
    const apartmentSteps = stepsByApartment.get(apartment.id) ?? [];
    const status = apartmentStatus(apartmentSteps);
    const unitPct = progressPct(apartmentSteps);

    const chip = el('button', `min-h-[64px] rounded-xl p-2 text-left ${APARTMENT_CLASS[status]}`);
    chip.type = 'button';
    chip.setAttribute('aria-label', `Lägenhet ${apartment.unit_number}, ${APARTMENT_LABEL[status]}`);
    chip.addEventListener('click', () => ctx.navigate(`#/p/${projectId}/a/${apartment.id}`));

    const unitNumber = el('p', 'text-sm font-bold', apartment.unit_number);
    const unitMeta = el('p', 'text-[11px] opacity-90', `${APARTMENT_LABEL[status]}`);
    const unitPctEl = el('p', 'text-[11px] opacity-90', `${unitPct}%`);
    chip.append(unitNumber, unitMeta, unitPctEl);
    grid.append(chip);
  }

  wrap.append(back, title, meta, progressRow, form, grid);
  host.append(wrap);
}
