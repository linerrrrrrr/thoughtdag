import { useSyncExternalStore } from 'react';

export interface FileEditPreview { before: string; after: string }
const previews = new Map<string, FileEditPreview>();
const listeners = new Set<() => void>();
const keyOf = (project: string, node: string, attachment: string) => JSON.stringify([project, node, attachment]);
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export function fileEditPreview(project: string, node: string, attachment: string, value: FileEditPreview | null) {
  const key = keyOf(project, node, attachment);
  if (value) previews.set(key, value);
  else if (!previews.delete(key)) return;
  listeners.forEach(fn => fn());
}

export function useFileEditPreview(project: string, node: string, attachment: string) {
  const key = keyOf(project, node, attachment);
  return useSyncExternalStore(subscribe, () => previews.get(key), () => undefined);
}

export function previewTextParts(source: string, preview?: FileEditPreview) {
  if (!preview?.before) return null;
  const at = source.indexOf(preview.before);
  if (at < 0 || source.indexOf(preview.before, at + 1) >= 0) return null;
  return { leading: source.slice(0, at), original: preview.before, replacement: preview.after, trailing: source.slice(at + preview.before.length) };
}
