import { getCanvasForEditing, saveEditedCanvas, del as idbDel } from './disk-storage';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

// Debounced object storage: IndexedDB by default, or the configured local
// disk service after its verified migration. The adapter serializes disk
// records only when this debounce flushes, never for each streamed chunk.
// Page hide and visibility changes attempt a final asynchronous flush.
const WRITE_DELAY_MS = 1000;

let pending: { name: string; value: unknown } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSave: Promise<void> = Promise.resolve();

export function flushPendingWrites(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending) {
    const snapshot = pending;
    pending = null;
    const write = saveEditedCanvas(snapshot.name, snapshot.value);
    lastSave = write;
    void write.catch(() => {
      // A later flush retries a failed save. Never replace a newer edit.
      if (!pending && lastSave === write) pending = snapshot;
    });
  }
  return lastSave;
}

function flush() {
  void flushPendingWrites().catch((error) => console.error('[thoughtdag] canvas save failed:', error));
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/** Object-level persist storage. Generic over the persisted shape. */
export function createIdbObjectStorage<S>(): PersistStorage<S> {
  return {
    getItem: async (name) => {
      const v = await getCanvasForEditing(name);
      if (v == null) return null;
      // Back-compat: earlier builds stored the JSON string createJSONStorage wrote
      if (typeof v === 'string') {
        try { return JSON.parse(v) as StorageValue<S>; } catch { return null; }
      }
      return v as StorageValue<S>;
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, WRITE_DELAY_MS);
    },
    removeItem: async (name) => {
      pending = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await idbDel(name);
    },
  };
}
