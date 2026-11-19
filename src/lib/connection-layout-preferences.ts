import { create } from 'zustand';
import { appSettings } from './disk-storage';

export const CONNECTION_LAYOUTS = ['sidebar', 'top', 'dock'] as const;
export type ConnectionLayout = typeof CONNECTION_LAYOUTS[number];
export interface ConnectionLayoutSettings {
  enabled: boolean;
  layout: ConnectionLayout;
  showAttachments: boolean;
}

const KEY = 'thoughtdag.connectionLayout';

function normalize(value: unknown): ConnectionLayoutSettings {
  const saved = (value ?? {}) as Partial<ConnectionLayoutSettings>;
  return {
    enabled: saved.enabled === true,
    layout: CONNECTION_LAYOUTS.find(layout => layout === saved.layout) ?? 'sidebar',
    showAttachments: saved.showAttachments !== false,
  };
}

function readSettings(): ConnectionLayoutSettings {
  try { return normalize(JSON.parse(appSettings.getItem(KEY) ?? '{}')); }
  catch { return normalize({}); }
}

export const useConnectionLayoutPreferences = create<{
  settings: ConnectionLayoutSettings;
  setSettings: (patch: Partial<ConnectionLayoutSettings>) => void;
}>((set, get) => ({
  settings: readSettings(),
  setSettings: patch => {
    const settings = normalize({ ...get().settings, ...patch });
    try { appSettings.setItem(KEY, JSON.stringify(settings)); } catch { /* Keep using the preference for this session. */ }
    set({ settings });
  },
}));
