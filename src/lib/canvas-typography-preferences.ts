import { create } from 'zustand';
import { DEFAULT_CANVAS_TYPOGRAPHY, normalizeCanvasTypography, type CanvasTypography } from './canvas-typography';
import { appSettings } from './disk-storage';

const KEY = 'thoughtdag.canvasTypography';

function readSettings(): CanvasTypography {
  try { return normalizeCanvasTypography(JSON.parse(appSettings.getItem(KEY) ?? '{}')); }
  catch { return DEFAULT_CANVAS_TYPOGRAPHY; }
}

export const useCanvasTypographyPreferences = create<{
  settings: CanvasTypography;
  setSettings: (value: CanvasTypography) => void;
  reset: () => void;
}>((set, get) => ({
  settings: readSettings(),
  setSettings: value => {
    const settings = normalizeCanvasTypography(value);
    try { appSettings.setItem(KEY, JSON.stringify(settings)); } catch { /* Retain the session preference. */ }
    set({ settings });
  },
  reset: () => get().setSettings(DEFAULT_CANVAS_TYPOGRAPHY),
}));
