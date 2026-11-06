import { create } from 'zustand';
import { normalizeEdgeRoutingSettings, type EdgeRoutingSettings } from './edge-path';

const KEY = 'thoughtdag.edgeRouting';

function readSettings(): EdgeRoutingSettings {
  try { return normalizeEdgeRoutingSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}); }
  catch { return normalizeEdgeRoutingSettings(); }
}

/** Local viewing preferences apply across projects without editing graph data. */
export const useEdgeRoutingPreferences = create<{
  settings: EdgeRoutingSettings;
  setSettings: (settings: EdgeRoutingSettings) => void;
}>((set) => ({
  settings: readSettings(),
  setSettings: (settings) => {
    const next = normalizeEdgeRoutingSettings(settings);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Keep the session preference when storage is unavailable. */ }
    set({ settings: next });
  },
}));
