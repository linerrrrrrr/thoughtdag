import { useId, useState } from 'react';
import { useT } from '../i18n';
import { useUiStore } from '../lib/ui-store';
import { useEdgeRoutingPreferences } from '../lib/edge-routing-preferences';
import CanvasLayoutChoices from './CanvasLayoutChoices';
import CanvasSettingSwitch from './CanvasSettingSwitch';
import EdgeAvoidancePreview from './EdgeAvoidancePreview';
import EdgeCurvePreview from './EdgeCurvePreview';

const DRAFT_KEY = 'canvas-edge-routing-inputs';
const fields = ['clearance', 'curvature', 'endpointPerpendicularity'] as const;
type RoutingInputs = Record<typeof fields[number], string>;
const limits = { clearance: [8, 64], curvature: [0, 100], endpointPerpendicularity: [0, 100] } as const;
const percent = (value: number) => Number((value * 100).toFixed(4));
const validNumber = (text: string, min: number, max: number) => text.trim() !== ''
  && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max;
const validInput = (key: keyof RoutingInputs, value: string) => validNumber(value, limits[key][0], limits[key][1]);

function RoutingValue({ name, label, value, applied, min, max, unit, invalidHint, onChange }: {
  name: string; label: string; value: string; applied: number; min: number; max: number; unit: string;
  invalidHint: string; onChange: (value: string) => void;
}) {
  const id = useId();
  const valid = validNumber(value, min, max);
  return <div className="canvas-routing-value" {...{ [`data-routing-${name}`]: '' }}>
    <div className="canvas-routing-value-heading">
      <label htmlFor={`${id}-value`} className="text-control font-medium">{label}</label>
      <span className="canvas-routing-number">
        <input id={`${id}-value`} type="number" min={min} max={max} step="any" value={value}
          aria-invalid={!valid || undefined} aria-describedby={valid ? undefined : `${id}-error`} onChange={event => onChange(event.target.value)} />
        <span aria-hidden="true">{unit}</span>
      </span>
    </div>
    <input type="range" min={min} max={max} step="0.1" value={valid ? Number(value) : applied}
      aria-label={label} onChange={event => onChange(event.target.value)} />
    {!valid && <span className="sr-only" id={`${id}-error`}>{invalidHint}</span>}
  </div>;
}

/** Valid changes update the local preference immediately; incomplete numeric input remains a session draft. */
export default function EdgeRoutingControls() {
  const t = useT();
  const avoidanceId = useId();
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
    return {
      clearance: restore('clearance', applied.obstacleClearance),
      curvature: restore('curvature', percent(applied.curvature)),
      endpointPerpendicularity: restore('endpointPerpendicularity', percent(applied.endpointPerpendicularity)),
    };
  });
  const changeValue = (key: keyof RoutingInputs, value: string) => {
    const next = { ...inputs, [key]: value };
    setInputs(next);
    const pending: Partial<RoutingInputs> = {};
    for (const field of fields) {
      if (!validInput(field, next[field])) pending[field] = next[field];
    }
    useUiStore.getState().setDraft(DRAFT_KEY, Object.keys(pending).length ? JSON.stringify(pending) : '');
    if (!validInput(key, value)) return;
    const preferences = useEdgeRoutingPreferences.getState();
    preferences.setSettings({ ...preferences.settings,
      ...(key === 'clearance' ? { obstacleClearance: Number(value) } : { [key]: Number(value) / 100 }) });
  };
  const changeAvoidance = () => {
    const preferences = useEdgeRoutingPreferences.getState();
    preferences.setSettings({ ...preferences.settings, avoidObstacles: !preferences.settings.avoidObstacles });
  };
  return <div className="canvas-layout-fields canvas-routing-fields" data-routing-settings>
    <section className="canvas-routing-group" aria-label={t('edgeRouting.defaultRoute')}>
      <div className="settings-route-controls">
        <CanvasLayoutChoices data-routing-mode="" label={t('edgeRouting.defaultRoute')} value={settings.defaultRoute}
          choices={[{ value: 'curve', label: t('edgeEditor.routeCurve') }, { value: 'orthogonal', label: t('edgeEditor.routeOrthogonal') }]}
          onChange={defaultRoute => {
            const preferences = useEdgeRoutingPreferences.getState();
            preferences.setSettings({ ...preferences.settings, defaultRoute });
          }} />
        {settings.defaultRoute === 'curve' && <>
          <RoutingValue name="curvature" label={t('edgeRouting.curvature')} value={inputs.curvature} applied={settings.curvature * 100}
            min={0} max={100} unit="%" invalidHint={t('edgeRouting.percentInvalid')} onChange={value => changeValue('curvature', value)} />
          <RoutingValue name="endpoint-perpendicularity" label={t('edgeRouting.endpointPerpendicularity')}
            value={inputs.endpointPerpendicularity} applied={settings.endpointPerpendicularity * 100}
            min={0} max={100} unit="%" invalidHint={t('edgeRouting.percentInvalid')} onChange={value => changeValue('endpointPerpendicularity', value)} />
        </>}
      </div>
      {settings.defaultRoute === 'curve' && <EdgeCurvePreview settings={settings} />}
    </section>
    <section className="canvas-routing-group settings-section-divider" aria-label={t('edgeRouting.avoid')}>
      <div className="settings-route-controls">
        <div data-routing-avoid>
          <CanvasSettingSwitch label={t('edgeRouting.avoid')} checked={settings.avoidObstacles}
            aria-controls={settings.avoidObstacles ? avoidanceId : undefined} onChange={changeAvoidance} />
        </div>
        {settings.avoidObstacles && <div id={avoidanceId}>
          <RoutingValue name="clearance" label={t('edgeRouting.clearance')} value={inputs.clearance} applied={settings.obstacleClearance}
            min={8} max={64} unit="px" invalidHint={t('edgeRouting.clearanceInvalid')} onChange={value => changeValue('clearance', value)} />
        </div>}
      </div>
      {settings.avoidObstacles && <EdgeAvoidancePreview routeMode={settings.defaultRoute} obstacleClearance={settings.obstacleClearance} />}
    </section>
  </div>;
}
