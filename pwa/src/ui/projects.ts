import { PROJECT_TYPES } from '../data/templates';
import { createProject, type Project } from '../db/db';
import { progressPct } from '../domain/status';
import { el } from '../lib/util';
import type { Ctx } from './context';

const PROJECT_STATUS_LABEL: Record<Project['status'], string> = {
  pagaende: 'Pågående',
  pausad: 'Pausad',
  klart: 'Klart',
};

const PROJECT_STATUS_CLASS: Record<Project['status'], string> = {
  pagaende: 'bg-blue-100 text-blue-800',
  pausad: 'bg-amber-100 text-amber-800',
  klart: 'bg-green-100 text-green-800',
};

export async function renderProjects(host: HTMLElement, ctx: Ctx): Promise<void> {
  const { database } = ctx;
  const projects = (await database.projects.toArray())
    .filter((project) => !project.deleted_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const wrap = el('div', 'px-4 py-4 space-y-4');

  const filter = el('input', 'field');
  filter.type = 'search';
  filter.placeholder = 'Filtrera projekt';
  filter.setAttribute('aria-label', 'Filtrera projekt');

  const list = el('div', 'space-y-3');

  const form = el('form', 'card hidden space-y-3');
  const nameInput = el('input', 'field');
  nameInput.placeholder = 'Projektnamn';
  nameInput.required = true;
  const typeSelect = el('select', 'field');
  for (const [value, label] of Object.entries(PROJECT_TYPES)) {
    const option = el('option', undefined, label);
    option.value = value;
    typeSelect.append(option);
  }
  typeSelect.value = 'fiber_apartment';
  const customerInput = el('input', 'field');
  customerInput.placeholder = 'Beställare (frivilligt)';
  const addressInput = el('input', 'field');
  addressInput.placeholder = 'Adress (frivilligt)';
  const submit = el('button', 'min-h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white', 'Skapa projekt');
  submit.type = 'submit';
  form.append(nameInput, typeSelect, customerInput, addressInput, submit);

  const newButton = el('button', 'min-h-11 w-full rounded-xl border border-slate-300 bg-white text-sm font-semibold', 'Nytt projekt');
  newButton.type = 'button';
  newButton.addEventListener('click', () => form.classList.toggle('hidden'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!nameInput.value.trim()) return;
    const project = await createProject(database, {
      name: nameInput.value,
      projectType: typeSelect.value,
      customer: customerInput.value,
      address: addressInput.value,
    });
    await ctx.refreshHeader();
    ctx.navigate(`#/p/${project.id}`);
  });

  async function paint(): Promise<void> {
    const needle = filter.value.trim().toLowerCase();
    list.replaceChildren();

    if (projects.length === 0) {
      list.append(el('p', 'text-sm text-slate-500', 'Inga projekt än. Skapa det första ovan.'));
      return;
    }

    for (const project of projects) {
      if (needle && !project.name.toLowerCase().includes(needle)) continue;
      const steps = await database.steps.where('project_id').equals(project.id).toArray();
      const apartments = await database.apartments
        .where('project_id')
        .equals(project.id)
        .toArray();

      const card = el('button', 'card w-full text-left');
      card.type = 'button';
      card.addEventListener('click', () => ctx.navigate(`#/p/${project.id}`));

      const top = el('div', 'flex items-start justify-between gap-3');
      const name = el('p', 'text-base font-semibold', project.name);
      const chip = el('span', `chip ${PROJECT_STATUS_CLASS[project.status]}`, PROJECT_STATUS_LABEL[project.status]);
      top.append(name, chip);

      const pct = progressPct(steps);
      const meta = el('p', 'mt-1 text-xs text-slate-500', `${apartments.length} lägenheter · ${pct}%`);

      const bar = el('div', 'mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200');
      const fill = el('div', 'h-full rounded-full bg-slate-900');
      fill.style.width = `${pct}%`;
      bar.append(fill);

      card.append(top, meta, bar);
      list.append(card);
    }
  }

  filter.addEventListener('input', () => {
    void paint();
  });

  wrap.append(newButton, form, filter, list);
  host.append(wrap);
  await paint();
}
