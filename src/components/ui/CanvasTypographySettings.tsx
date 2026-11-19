import { useId, useRef, useState } from 'react';
import { ChevronDown, RotateCcw, Type } from 'lucide-react';
import { fmt, useT } from '../../i18n';
import { canvasTypePreview, DEFAULT_CANVAS_TYPOGRAPHY, normalizeCanvasTypography, type CanvasTypography } from '../../lib/canvas-typography';
import { useCanvasTypographyPreferences } from '../../lib/canvas-typography-preferences';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useUiStore } from '../../lib/ui-store';

const draftKey = 'canvas-typography-settings';
const sameCurve = (a: CanvasTypography, b: CanvasTypography) =>
  a.bodySize === b.bodySize && a.bodyExponent === b.bodyExponent && a.summaryExponent === b.summaryExponent;

function readDraft(raw: string | undefined, applied: CanvasTypography) {
  try { return raw ? normalizeCanvasTypography(JSON.parse(raw)) : applied; }
  catch { return applied; }
}

function ScaleSlider({ field, label, value, valueText, min, max, step, onChange }: {
  field: keyof CanvasTypography | 'zoom'; label: string; value: number; valueText: string;
  min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  const id = useId();
  return <div className="canvas-routing-value">
    <div className="canvas-routing-value-heading">
      <label htmlFor={id} className="text-control font-medium">{label}</label>
      <output htmlFor={id} className="shrink-0 text-control text-ink-muted tabular-nums">{valueText}</output>
    </div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={valueText}
      data-canvas-typography-field={field === 'zoom' ? undefined : field}
      data-canvas-typography-preview-zoom={field === 'zoom' || undefined}
      onChange={event => onChange(event.currentTarget.valueAsNumber)} />
  </div>;
}

export default function CanvasTypographySettings() {
  const t = useT();
  const id = useId();
  const section = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(125);
  const settings = useCanvasTypographyPreferences(state => state.settings);
  const savedDraft = useUiStore(state => state.drafts[draftKey]);
  const draft = readDraft(savedDraft, settings);
  const dirty = !sameCurve(draft, settings);
  const canReset = dirty || !sameCurve(settings, DEFAULT_CANVAS_TYPOGRAPHY);
  const clearDraft = () => useUiStore.getState().setDraft(draftKey, '');
  const change = (field: keyof CanvasTypography, value: number) => {
    const next = { ...draft, [field]: value };
    useUiStore.getState().setDraft(draftKey, sameCurve(next, settings) ? '' : JSON.stringify(next));
  };
  useDismissableLayer({ open, refs: [section], restoreFocusRef: trigger, dismissOnFocusOutside: true, onDismiss: reason => {
    if (reason === 'escape') clearDraft();
    setOpen(false);
  } });
  const sizes = canvasTypePreview(draft, previewZoom / 100);
  const rootSize = open ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 16;
  const px = (size: number) => `${Number((size * rootSize / 16).toFixed(1))} px`;

  return <section ref={section} className="border-t border-line" data-canvas-typography-settings>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls={id}
      className="flex min-h-8 w-full items-center gap-2 px-4 py-2 text-left text-control text-ink hover:bg-wash focus-visible:outline-accent"
      onClick={() => setOpen(!open)} data-canvas-typography-toggle>
      <Type size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-muted" />
      <span className="flex-1">{t('canvasType.title')}</span>
      <ChevronDown size={14} aria-hidden="true" className={`shrink-0 text-ink-muted ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={id} className="grid min-w-0 gap-3 px-4 pt-1 pb-3">
      <div className="grid gap-1">
        <ScaleSlider field="bodySize" label={t('canvasType.bodySize')} value={draft.bodySize} valueText={px(draft.bodySize)}
          min={12} max={24} step={1} onChange={value => change('bodySize', value)} />
        <p className="text-control text-ink-muted">{t('canvasType.ceilingHint')}</p>
      </div>
      <div className="grid gap-2">
        <ScaleSlider field="bodyExponent" label={t('canvasType.bodyExponent')} value={draft.bodyExponent}
          valueText={String(draft.bodyExponent)} min={0} max={1} step={0.05} onChange={value => change('bodyExponent', value)} />
        <ScaleSlider field="summaryExponent" label={t('canvasType.summaryExponent')} value={draft.summaryExponent}
          valueText={String(draft.summaryExponent)} min={0} max={1} step={0.05} onChange={value => change('summaryExponent', value)} />
        <p className="text-control text-ink-muted">{t('canvasType.exponentHint')}</p>
      </div>
      <div className="grid gap-1 border-t border-line pt-3" data-canvas-typography-preview>
        <ScaleSlider field="zoom" label={t('canvasType.previewZoom')} value={previewZoom} valueText={`${previewZoom}%`}
          min={4} max={200} step={1} onChange={setPreviewZoom} />
        <div className="canvas-type-preview">
          {(['body', 'summary'] as const).map(role => <div key={role} className="canvas-type-preview-row">
            <div className="min-w-0">
              <div className="canvas-type-preview-node" style={{ minWidth: `${previewZoom / 2}%` }}>
                <span data-canvas-typography-sample={role}
                  style={{ fontSize: `calc(${sizes[role] / 16}rem / var(--ui-scale))` }}>
                  {t('canvasType.sample')}
                </span>
              </div>
            </div>
            <span className="text-meta text-ink-muted tabular-nums">{fmt(t(role === 'body' ? 'canvasType.bodyReading' : 'canvasType.summaryReading'), { size: px(sizes[role]) })}</span>
          </div>)}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
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
    </div>}
  </section>;
}
