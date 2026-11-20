import { Position } from '@xyflow/react';
import { useId } from 'react';
import { fmt, useT } from '../i18n';
import { nativeBezier, type EdgeRoutingSettings } from '../lib/edge-path';

const start = { x: 48, y: 18 };
const end = { x: 232, y: 110 };

export default function EdgeCurvePreview({ settings }: { settings: EdgeRoutingSettings }) {
  const t = useT();
  const descriptionId = useId();
  const { route, curve: [, first, last] } = nativeBezier(start, end, Position.Right, Position.Left, settings);
  const angle = Math.atan2(first.y - start.y, first.x - start.x) * 180 / Math.PI;
  const angleLabel = fmt(t('edgeRouting.previewAngle'), { angle: Number(angle.toFixed(1)) });

  return <figure className="canvas-routing-preview" data-routing-preview="curve">
    <svg viewBox="0 0 280 128" role="img" data-routing-curve-preview aria-label={t('edgeRouting.curvePreview')}
      aria-describedby={descriptionId}>
      <desc id={descriptionId} data-preview-angle>{angleLabel}</desc>
      <rect className="routing-preview-node" x="2" y="6" width="46" height="24" rx="4" />
      <rect className="routing-preview-node" x="232" y="98" width="46" height="24" rx="4" />
      <g className="routing-preview-guide">
        <line x1={start.x} y1={start.y} x2={first.x} y2={first.y} />
        <line x1={end.x} y1={end.y} x2={last.x} y2={last.y} />
      </g>
      <path className="routing-preview-path" data-preview-route d={route.path} fill="none" />
      <g className="routing-preview-control">
        <circle data-preview-control cx={first.x} cy={first.y} r="3" />
        <circle data-preview-control cx={last.x} cy={last.y} r="3" />
      </g>
      <g className="routing-preview-port">
        <circle cx={start.x} cy={start.y} r="2.4" />
        <circle cx={end.x} cy={end.y} r="2.4" />
      </g>
    </svg>
  </figure>;
}
