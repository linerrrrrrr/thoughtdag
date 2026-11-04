import { useUiStore } from './ui-store';

/** Ephemeral text only: callers scope keys by project and entity. Never use for secrets. */
export function useSessionDraft(key: string, initial = ''): [string, (value: string) => void] {
  const value = useUiStore(state => state.drafts[key] ?? initial);
  return [value, value => useUiStore.getState().setDraft(key, value, true)];
}
