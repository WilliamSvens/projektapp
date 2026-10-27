// The header is the record: there are no disappearing toasts for sync (docs/SPEC-V1.md §4).
/** `timeout` is not a server answer: the press never settled, so the button is handed back. */
export type SyncErrorPhase = 'push' | 'pull' | 'timeout';

export type SyncState =
  | { kind: 'offline' }
  | { kind: 'idle' }
  | { kind: 'pending'; count: number }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: string }
  | { kind: 'error'; phase: SyncErrorPhase; message: string };

type Listener = (state: SyncState) => void;

export class SyncStore {
  #value: SyncState = { kind: 'idle' };
  #listeners = new Set<Listener>();

  get value(): SyncState {
    return this.#value;
  }

  set(next: SyncState): void {
    this.#value = next;
    for (const listener of this.#listeners) listener(next);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#value);
    return () => this.#listeners.delete(listener);
  }
}

export const syncStore = new SyncStore();
