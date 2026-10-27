import type { SyncBackend } from '../sync/backend';
import type { SyncErrorPhase, SyncStore } from '../sync/state';
import { runSync } from '../sync/sync';
import { dirtyCount, type FieldDB } from '../db/db';
import { el, isOnline } from '../lib/util';

/** §4: `Uppdaterat HH:MM` for 5 s, then back to `Uppdatera` — the button must be pressable again. */
const SYNCED_LABEL_MS = 5000;
/**
 * A press whose request never settles (online but no usable network, the basement case) must not
 * own the button for the rest of the day. After this long the header hands the decision back.
 */
const SYNC_STALL_MS = 20000;

/** §4 copy table. The header is the record, so every failure keeps its own sentence. */
const ERROR_TEXT: Record<SyncErrorPhase, string> = {
  push: 'Kunde inte skicka. Ändringarna finns kvar på enheten.',
  pull: 'Hämtade inte senaste. Försök igen när du har täckning.',
  timeout: 'Ingen kontakt med servern. Ändringarna finns kvar på enheten.',
};

interface HeaderOptions {
  database: FieldDB;
  backend: SyncBackend;
  store: SyncStore;
  currentProjectId: () => string | null;
  onSynced: () => void;
}

export interface Header {
  el: HTMLElement;
  refresh: () => Promise<void>;
  destroy: () => void;
}

/**
 * §4: the button is a promise about what the press will do, so the label is state, not copy.
 * Nothing here is a toast — the header is the record.
 */
export function createHeader(options: HeaderOptions): Header {
  const { database, backend, store, currentProjectId, onSynced } = options;

  const root = el('header', 'sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur');
  const bar = el('div', 'flex items-center justify-between gap-3 px-4 py-3');
  const titles = el('div');
  const title = el('p', 'text-base font-semibold leading-tight', 'Projektapp');
  const caption = el('p', 'text-xs text-slate-500', '');
  titles.append(title, caption);

  const right = el('div', 'flex items-center gap-2');
  const dot = el('span', 'hidden h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500');
  const button = el('button', 'min-h-11 rounded-xl px-4 text-sm font-semibold');
  button.type = 'button';
  right.append(dot, button);
  bar.append(titles, right);

  const message = el('p', 'hidden px-4 pb-2 text-xs text-amber-700');
  root.append(bar, message);

  let syncedTimer: number | undefined;
  let stallTimer: number | undefined;
  let busy = false;
  /** Identifies the press that currently owns `busy`; a run overtaken by the stall rule must not clear it. */
  let runId = 0;

  function render(): void {
    const state = store.value;
    dot.classList.add('hidden');
    message.classList.add('hidden');
    button.className = 'min-h-11 rounded-xl px-4 text-sm font-semibold';
    caption.textContent = '';

    switch (state.kind) {
      case 'offline':
        button.textContent = 'Offline';
        button.disabled = true;
        button.classList.add('bg-slate-200', 'text-slate-500');
        caption.textContent = 'Ändringar sparas på enheten';
        break;
      case 'idle':
        button.textContent = 'Uppdatera';
        button.disabled = busy;
        button.classList.add('bg-slate-900', 'text-white');
        break;
      case 'pending':
        button.textContent = `Skicka ${state.count} ändringar`;
        button.disabled = busy;
        button.classList.add('bg-slate-900', 'text-white');
        break;
      case 'syncing':
        button.textContent = 'Uppdaterar…';
        button.disabled = true;
        button.classList.add('bg-slate-300', 'text-slate-600');
        break;
      case 'synced':
        button.textContent = `Uppdaterat ${state.at}`;
        button.disabled = true;
        button.classList.add('bg-green-100', 'text-green-800');
        break;
      case 'error':
        button.textContent = 'Försök igen';
        button.disabled = false;
        button.classList.add('bg-amber-500', 'text-white');
        dot.classList.remove('hidden');
        message.textContent = ERROR_TEXT[state.phase];
        message.title = state.message;
        message.classList.remove('hidden');
        break;
    }
  }

  async function refresh(options: { force?: boolean } = {}): Promise<void> {
    if (store.value.kind === 'syncing') return;
    if (!isOnline()) {
      store.set({ kind: 'offline' });
      return;
    }
    const count = await dirtyCount(database);
    // New work wins over the confirmation label: "Uppdaterat 14:32" must never hide a
    // change the technician just made.
    if (count > 0) {
      store.set({ kind: 'pending', count });
      return;
    }
    // `synced` and `error` are the two labels that survive a bare refresh, so the timer that
    // ends the confirmation has to say so — otherwise `Uppdatera` never comes back and the
    // button stays disabled until the page is reloaded (§4).
    if (!options.force && (store.value.kind === 'synced' || store.value.kind === 'error')) return;
    store.set({ kind: 'idle' });
  }

  async function onPress(): Promise<void> {
    if (busy || !isOnline()) return;
    busy = true;
    const mine = ++runId;
    window.clearTimeout(stallTimer);
    stallTimer = window.setTimeout(() => {
      if (mine !== runId || store.value.kind !== 'syncing') return;
      // The request is still out there; the button must not be. A retry is safe — push is
      // written to survive a crash at any step (§3.3), so a second pass is a no-op.
      busy = false;
      store.set({ kind: 'error', phase: 'timeout', message: 'Ingen kontakt med servern.' });
    }, SYNC_STALL_MS);
    const projectId = currentProjectId();
    try {
      await runSync(database, backend, store, projectId);
    } finally {
      // Only the current press owns the button: an abandoned request that answers ten minutes
      // later must not clear the spinner of the retry the technician already started.
      if (mine === runId) {
        window.clearTimeout(stallTimer);
        stallTimer = undefined;
        busy = false;
        render();
      }
    }
    if (store.value.kind === 'synced') {
      onSynced();
      window.clearTimeout(syncedTimer);
      syncedTimer = window.setTimeout(() => {
        void refresh({ force: true }).then(render);
      }, SYNCED_LABEL_MS);
    }
  }

  button.addEventListener('click', () => {
    void onPress();
  });

  const onOnline = (): void => {
    void refresh().then(render);
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOnline);

  const unsubscribe = store.subscribe(() => render());

  return {
    el: root,
    refresh,
    destroy: () => {
      window.clearTimeout(syncedTimer);
      window.clearTimeout(stallTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
      unsubscribe();
      root.remove();
    },
  };
}
