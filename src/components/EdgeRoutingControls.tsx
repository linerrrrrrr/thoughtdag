import { useId, useState } from 'react';
import { useT } from '../i18n';
import { useUiStore } from '../lib/ui-store';
import { useEdgeRoutingPreferences } from '../lib/edge-routing-preferences';

const DRAFT_KEY = 'canvas-edge-routing-inputs';
type RoutingInputs = { clearance: string; curvature: string };
const limits = { clearance: [8, 64], curvature: [0, 100] } as const;
const validNumber = (text: string, min: number, max: number) => text.trim() !== ''
  && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max;
const validInput = (key: keyof RoutingInputs, value: string) => validNumber(value, limits[key][0], limits[key][1]);

function RoutingValue({ name, label, value, applied, min, max, unit, hint, invalidHint, disabled, onChange }: {
  name: string; label: string; value: string; applied: number; min: number; max: number; unit: string;
  hint: string; invalidHint: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  const id = useId();
  const valid = validNumber(value, min, max);
  return <div className="canvas-routing-value" data-disabled={disabled || undefined} {...{ [`data-routing-${name}`]: '' }}>
    <div className="canvas-routing-value-heading">
      <label htmlFor={`${id}-value`} className="text-control font-medium">{label}</label>
      <span className="canvas-routing-number">
        <input id={`${id}-value`} type="number" min={min} max={max} step="any" value={value} disabled={disabled}
          aria-invalid={!valid || undefined} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.value)} />
        <span aria-hidden="true">{unit}</span>
      </span>
    </div>
    <input type="range" min={min} max={max} step="0.1" value={valid ? Number(value) : applied} disabled={disabled}
      aria-label={label} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.value)} />
    <p id={`${id}-hint`} className={`text-control ${valid || disabled ? 'text-ink-muted' : 'text-red-600'}`}>
      {valid || disabled ? hint : invalidHint}
    </p>
  </div>;
}

/** Valid changes update the local preference immediately; incomplete numeric input remains a session draft. */
export default function EdgeRoutingControls() {
  const t = useT();
  const switchId = useId();
  const settings = useEdgeRoutingPreferences(state => state.settings);
  const [inputs, setInputs] = useState<RoutingInputs>(() => {
    const applied = useEdgeRoutingPreferences.getState().settings;
    let pending: Partial<RoutingInputs> = {};
    try { pending = JSON.parse(useUiStore.getState().drafts[DRAFT_KEY] ?? '{}') ?? {}; }
    catch { /* Ignore obsolete session drafts. */ }
    const restore = (key: keyof RoutingInputs, fallback: number) => {
      const value = pending[key];
      return typeof value === 'string' && !validInput(key, value) ? value : String(fallback);
    };
    return { clearance: restore('clearance', applied.obstacleClearance),
      curvature: restore('curvature', Number((applied.curvature * 100).toFixed(4))) };
  });
  const changeValue = (key: keyof RoutingInputs, value: string) => {
    const next = { ...inputs, [key]: value };
    setInputs(next);
    const pending: Partial<RoutingInputs> = {};
    for (const field of ['clearance', 'curvature'] as const) {
      if (!validInput(field, next[field])) pending[field] = next[field];
    }
    useUiStore.getState().setDraft(DRAFT_KEY, Object.keys(pending).length ? JSON.stringify(pending) : '');
    if (!validInput(key, value)) return;
    const preferences = useEdgeRoutingPreferences.getState();
    preferences.setSettings({ ...preferences.settings,
      ...(key === 'clearance' ? { obstacleClearance: Number(value) } : { curvature: Number(value) / 100 }) });
  };
  const changeAvoidance = () => {
    const preferences = useEdgeRoutingPreferences.getState();
    preferences.setSettings({ ...preferences.settings, avoidObstacles: !preferences.settings.avoidObstacles });
  };
  return <div className="canvas-layout-fields canvas-routing-fields" data-routing-settings>
    <p className="text-control text-ink-muted">{t('edgeRouting.scopeHint')}</p>
    <div className="canvas-routing-toggle" data-routing-avoid>
      <span id={switchId} className="text-control font-medium">{t('edgeRouting.avoid')}</span>
      <button type="button" role="switch" aria-checked={settings.avoidObstacles} aria-labelledby={switchId}
        onClick={changeAvoidance} className="canvas-routing-switch">
        <span className="canvas-routing-switch-track"><span /></span>
      </button>
    </div>
    <RoutingValue name="clearance" label={t('edgeRouting.clearance')} value={inputs.clearance} applied={settings.obstacleClearance}
      min={8} max={64} unit="px" hint={t('edgeRouting.clearanceHint')} invalidHint={t('edgeRouting.clearanceInvalid')}
      disabled={!settings.avoidObstacles} onChange={value => changeValue('clearance', value)} />
    <RoutingValue name="curvature" label={t('edgeRouting.curvature')} value={inputs.curvature} applied={settings.curvature * 100}
      min={0} max={100} unit="%" hint={t('edgeRouting.curvatureHint')} invalidHint={t('edgeRouting.curvatureInvalid')}
      onChange={value => changeValue('curvature', value)} />
  </div>;
}
