import { useId } from 'react';
import type { EdgeEditSettings } from '../lib/edge-edit';
import { useT } from '../i18n';

const routes = [
  { value: 'curve', label: 'edgeEditor.routeCurve', path: 'M8 25 C30 25 30 7 52 7' },
  { value: 'orthogonal', label: 'edgeEditor.routeOrthogonal', path: 'M8 25 H25 Q30 25 30 20 V12 Q30 7 35 7 H52' },
] as const;

export function EdgeRelationOptions({ value, canContinue = true, batch = false, onChange }: {
  value: EdgeEditSettings['relation'] | '';
  canContinue?: boolean;
  batch?: boolean;
  onChange: (value: EdgeEditSettings['relation']) => void;
}) {
  const t = useT();
  const name = useId();
  return <div className="edge-inspector-relations">
    {(['continue', 'reference'] as const).map(relation => <label key={relation} className="edge-inspector-relation"
      data-selected={value === relation} data-disabled={relation === 'continue' && !canContinue}>
      <input type="radio" name={name} value={relation} checked={value === relation}
        disabled={relation === 'continue' && !canContinue}
        data-edge-relation={batch ? undefined : relation} data-batch-edge-relation={batch ? relation : undefined}
        onChange={() => onChange(relation)} />
      <span><strong>{t(relation === 'continue' ? 'edgeEditor.continue' : 'edgeEditor.reference')}</strong>
        <span className="edge-inspector-relation-hint">{t(relation === 'continue' ? 'edgeEditor.continueHint' : 'edgeEditor.referenceHint')}</span></span>
    </label>)}
  </div>;
}

export function EdgeRouteOptions({ value, batch = false, onChange }: {
  value: 'curve' | 'orthogonal' | '';
  batch?: boolean;
  onChange: (value: 'curve' | 'orthogonal') => void;
}) {
  const t = useT();
  return <div className="edge-inspector-routes" role="group" aria-label={t('edgeEditor.route')}>
    {routes.map(({ value: route, label, path }) => <button type="button" key={route}
      data-edge-route={batch ? undefined : route} data-batch-edge-route={batch ? route : undefined}
      aria-pressed={value === route} onClick={() => onChange(route)}>
      <svg width="60" height="32" viewBox="0 0 60 32" fill="none" aria-hidden="true">
        <path d={path} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="8" cy="25" r="2.5" fill="currentColor" /><circle cx="52" cy="7" r="2.5" fill="currentColor" />
      </svg><span>{t(label)}</span>
    </button>)}
  </div>;
}
