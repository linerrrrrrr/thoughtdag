import { useId, useState } from 'react';
import { useT } from '../i18n';
import { useUiStore } from '../lib/ui-store';
import { useEdgeRoutingPreferences } from '../lib/edge-routing-preferences';

const DRAFT_KEY = 'canvas-edge-routing';
type RoutingDraft = { avoidObstacles: boolean; obstacleClearance: string; curvature: string };
const validNumber = (text: string, min: number, max: number) => text.trim() !== ''
  && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max;

function RoutingValue({ name, label, value, min, max, unit, hint, disabled, onChange }: {
  name: string; label: string; value: string; min: number; max: number; unit: string; hint: string;
  disabled?: boolean; onChange: (value: string) => void;
}) {
  const id = useId();
  const valid = validNumber(value, min, max);
  return <fieldset className="canvas-layout-field canvas-routing-value" disabled={disabled} {...{ [`data-routing-${name}`]: '' }}>
    <legend>{label}</legend>
    <div className="canvas-routing-inputs">
      <input type="range" min={min} max={max} step="0.1" value={valid ? Number(value) : min}
        aria-label={label} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.value)} />
      <label className="canvas-routing-number">
        <input type="number" min={min} max={max} step="any" value={value} aria-label={label}
          aria-invalid={!valid || undefined} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.value)} />
        <span aria-hidden="true">{unit}</span>
      </label>
    </div>
    <p id={`${id}-hint`} className="text-control text-ink-muted">{hint}</p>
  </fieldset>;
}

/** Global connection preferences have their own draft and explicit commit. */
export default function EdgeRoutingControls({ onClose }: { onClose: () => void }) {
  const t = useT();
  const groupName = useId();
  const [draft, setDraft] = useState<RoutingDraft>(() => {
    try {
      const stored = JSON.parse(useUiStore.getState().drafts[DRAFT_KEY] ?? 'null');
      if (stored && typeof stored.avoidObstacles === 'boolean' && typeof stored.obstacleClearance === 'string'
        && typeof stored.curvature === 'string') return stored;
    } catch { /* Ignore obsolete session drafts. */ }
    const settings = useEdgeRoutingPreferences.getState().settings;
    return { avoidObstacles: settings.avoidObstacles, obstacleClearance: String(settings.obstacleClearance),
      curvature: String(Number((settings.curvature * 100).toFixed(4))) };
  });
  const change = <K extends keyof RoutingDraft>(key: K, value: RoutingDraft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    useUiStore.getState().setDraft(DRAFT_KEY, JSON.stringify(next), true);
  };
  const valid = (!draft.avoidObstacles || validNumber(draft.obstacleClearance, 8, 64)) && validNumber(draft.curvature, 0, 100);
  const apply = () => {
    if (!valid) return;
    useEdgeRoutingPreferences.getState().setSettings({
      avoidObstacles: draft.avoidObstacles,
      obstacleClearance: validNumber(draft.obstacleClearance, 8, 64) ? Number(draft.obstacleClearance)
        : useEdgeRoutingPreferences.getState().settings.obstacleClearance,
      curvature: Number(draft.curvature) / 100,
    });
    useUiStore.getState().setDraft(DRAFT_KEY, '');
    onClose();
  };
  return <>
    <div className="canvas-layout-fields" role="tabpanel" id="canvas-layout-routing" aria-labelledby="canvas-layout-tab-routing" data-routing-settings>
      <p className="text-control text-ink-muted">{t('edgeRouting.scopeHint')}</p>
      <fieldset className="canvas-layout-field" data-routing-avoid>
        <legend>{t('edgeRouting.avoid')}</legend>
        <div className="canvas-layout-choices grid-cols-2">
          {(['on', 'off'] as const).map(value => <label key={value} className="canvas-layout-choice">
            <input type="radio" name={groupName} value={value} checked={draft.avoidObstacles === (value === 'on')}
              onChange={() => change('avoidObstacles', value === 'on')} />
            <span>{t(value === 'on' ? 'edgeRouting.on' : 'edgeRouting.off')}</span>
          </label>)}
        </div>
      </fieldset>
      <RoutingValue name="clearance" label={t('edgeRouting.clearance')} value={draft.obstacleClearance}
        min={8} max={64} unit="px" hint={t('edgeRouting.clearanceHint')} disabled={!draft.avoidObstacles}
        onChange={value => change('obstacleClearance', value)} />
      <RoutingValue name="curvature" label={t('edgeRouting.curvature')} value={draft.curvature}
        min={0} max={100} unit="%" hint={t('edgeRouting.curvatureHint')} onChange={value => change('curvature', value)} />
      {!valid && <p className="text-control text-red-600" role="alert">{t('edgeRouting.invalid')}</p>}
    </div>
    <div className="canvas-layout-footer flex shrink-0 flex-wrap justify-end gap-1 border-t border-line px-2 py-2">
      <button type="button" className="min-h-8 px-2.5 rounded-control text-control text-ink-muted hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => { useUiStore.getState().setDraft(DRAFT_KEY, ''); onClose(); }} data-routing-cancel>{t('canvasLayout.cancel')}</button>
      <button type="button" disabled={!valid} onClick={apply} data-routing-apply
        className="text-control bg-action text-white px-3 min-h-8 rounded-control hover:bg-action-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{t('edgeRouting.apply')}</button>
    </div>
  </>;
}
