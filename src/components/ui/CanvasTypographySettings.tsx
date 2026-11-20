import { useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useT } from '../../i18n';
import { DEFAULT_CANVAS_TYPOGRAPHY, normalizeCanvasTypography, type CanvasTypography } from '../../lib/canvas-typography';
import { canvasTypographyDraftKey, useCanvasTypographyPreferences } from '../../lib/canvas-typography-preferences';
import { useUiStore } from '../../lib/ui-store';
import CanvasTypographyCurve from './CanvasTypographyCurve';
import CanvasTypographyPreview from './CanvasTypographyPreview';

const clearDraft = () => useUiStore.getState().setDraft(canvasTypographyDraftKey, '');
const sameCurve = (a: CanvasTypography, b: CanvasTypography) =>
  a.bodySize === b.bodySize && a.bodyExponent === b.bodyExponent && a.summaryExponent === b.summaryExponent;

function readDraft(raw: string | undefined, applied: CanvasTypography) {
  try { return raw ? normalizeCanvasTypography(JSON.parse(raw)) : applied; }
  catch { return applied; }
}

export default function CanvasTypographySettings() {
  const t = useT();
  const titleId = useId();
  const [previewZoom, setPreviewZoom] = useState(100);
  const [playing, setPlaying] = useState(false);
  const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const settings = useCanvasTypographyPreferences(state => state.settings);
  const savedDraft = useUiStore(state => state.drafts[canvasTypographyDraftKey]);
  const draft = readDraft(savedDraft, settings);
  const dirty = !sameCurve(draft, settings);
  const canReset = dirty || !sameCurve(settings, DEFAULT_CANVAS_TYPOGRAPHY);
  const change = (field: keyof CanvasTypography, value: number) => {
    const next = { ...draft, [field]: value };
    useUiStore.getState().setDraft(canvasTypographyDraftKey, sameCurve(next, settings) ? '' : JSON.stringify(next));
  };
  return <section className="settings-field-section" aria-labelledby={titleId} data-canvas-typography-settings>
    <h4 id={titleId} className="text-title font-semibold">{t('canvasType.title')}</h4>
    <div className="canvas-type-workspace">
      <CanvasTypographyPreview settings={draft} zoom={previewZoom} onZoom={setPreviewZoom}
        playing={playing} onPlayingChange={setPlaying} />
      <CanvasTypographyCurve settings={draft} rootSize={rootSize} zoom={previewZoom} onChange={change}
        onZoom={percent => { setPlaying(false); setPreviewZoom(percent); }} />
    </div>
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" disabled={!canReset} data-canvas-typography-reset
        className="flex min-h-8 items-center gap-1.5 rounded-control px-2 py-1 text-control text-ink-muted hover:bg-wash focus-visible:outline-accent disabled:opacity-40"
        onClick={() => { useCanvasTypographyPreferences.getState().reset(); clearDraft(); }}>
        <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />{t('canvasType.reset')}
      </button>
      <button type="button" disabled={!dirty} data-canvas-typography-apply
        className="min-h-8 rounded-control bg-action px-3 py-1 text-control text-white hover:bg-action-strong focus-visible:outline-accent disabled:opacity-40"
        onClick={() => { useCanvasTypographyPreferences.getState().setSettings(draft); clearDraft(); }}>
        {t('format.apply')}
      </button>
    </div>
  </section>;
}
