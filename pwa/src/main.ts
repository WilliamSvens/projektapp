import './style.css';
import { dirtyCount, db, type FieldDB } from './db/db';
import { el, isOnline } from './lib/util';
import { currentEmail, signInWithGoogle, signOut, supabase } from './lib/supabase';
import { createSupabaseBackend } from './sync/backend';
import { syncStore } from './sync/state';
import { createHeader } from './ui/header';
import { renderChecklist } from './ui/checklist';
import { renderProject } from './ui/project';
import { renderProjects } from './ui/projects';
import type { Ctx } from './ui/context';

const host = document.getElementById('app');
if (!host) throw new Error('#app saknas i index.html');

const database: FieldDB = db;
const backend = createSupabaseBackend(supabase);

let currentProjectId: string | null = null;
let main: HTMLElement | null = null;
let header: ReturnType<typeof createHeader> | null = null;
let email = '';

function renderSignIn(message = ''): void {
  host!.replaceChildren();
  const wrap = el('div', 'mx-auto max-w-md space-y-4 px-6 py-16 text-center');
  const title = el('h1', 'text-2xl font-bold', 'Projektapp');
  const body = el(
    'p',
    'text-sm text-slate-600',
    'Logga in med Google för att se dina fiber- och CAT6-projekt. Inloggningen behövs en gång — sedan fungerar appen utan täckning.',
  );
  const button = el(
    'button',
    'min-h-12 w-full rounded-xl bg-slate-900 text-base font-semibold text-white',
    'Logga in med Google',
  );
  button.type = 'button';
  button.addEventListener('click', () => {
    void signInWithGoogle().catch((error: unknown) => {
      renderSignIn(error instanceof Error ? error.message : 'Inloggningen misslyckades.');
    });
  });

  wrap.append(title, body);
  if (message) wrap.append(el('p', 'text-sm text-amber-700', message));
  wrap.append(button);
  host!.append(wrap);
}

function parseRoute(): { projectId: string | null; apartmentId: string | null } {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] !== 'p' || !parts[1]) return { projectId: null, apartmentId: null };
  const apartmentId = parts[2] === 'a' && parts[3] ? parts[3] : null;
  return { projectId: parts[1], apartmentId };
}

async function render(): Promise<void> {
  if (!main) return;
  const { projectId, apartmentId } = parseRoute();
  currentProjectId = projectId;

  const ctx: Ctx = {
    database,
    email,
    navigate: (hash: string) => {
      if (location.hash === hash) void render();
      else location.hash = hash;
    },
    refreshHeader: async () => {
      if (header) await header.refresh();
    },
  };

  main.replaceChildren();
  if (!projectId) {
    await renderProjects(main, ctx);
  } else if (apartmentId) {
    await renderChecklist(main, ctx, projectId, apartmentId);
  } else {
    await renderProject(main, ctx, projectId);
  }
  await header?.refresh();
}

async function renderApp(): Promise<void> {
  host!.replaceChildren();
  email = await currentEmail();

  header?.destroy();
  header = createHeader({
    database,
    backend,
    store: syncStore,
    currentProjectId: () => currentProjectId,
    onSynced: () => {
      void render();
    },
  });
  main = el('main', 'pb-16');

  const footer = el('footer', 'px-4 pb-6');
  const signOutLink = el('button', 'text-xs text-slate-400 underline', `Inloggad som ${email} · Logga ut`);
  signOutLink.type = 'button';
  signOutLink.addEventListener('click', () => {
    void (async () => {
      const pending = await dirtyCount(database);
      if (pending > 0) {
        window.alert(`Du har ${pending} ändringar som inte är synkade. Skicka dem först.`);
        return;
      }
      await signOut();
      syncStore.set({ kind: 'idle' });
      renderSignIn('Du är utloggad.');
    })();
  });
  footer.append(signOutLink);

  host!.append(header.el, main, footer);
  if (!isOnline()) syncStore.set({ kind: 'offline' });
  await render();
}

window.addEventListener('hashchange', () => {
  void render();
});

supabase.auth.onAuthStateChange((event: string) => {
  if (event === 'SIGNED_OUT') renderSignIn();
});

async function boot(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    await renderApp();
  } else {
    renderSignIn();
  }

  // The service worker makes the shell open in a basement. Dev never registers it:
  // stale cached modules are a debugging trap, and `pnpm preview` is the real test.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js');
    });
  }
}

void boot();
