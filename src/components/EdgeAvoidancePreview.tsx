import { useId, useMemo } from 'react';
import { useT } from '../i18n';
import { avoidanceExample, avoidanceExamplePath } from '../lib/edge-routing-examples';
import type { EdgeRouteMode } from '../lib/edge-path';

export default function EdgeAvoidancePreview({ obstacleClearance, routeMode }: {
  obstacleClearance: number; routeMode: Exclude<EdgeRouteMode, 'auto'>;
}) {
  const t = useT();
  const descriptionId = useId();
  const path = useMemo(() => avoidanceExamplePath(routeMode, obstacleClearance), [routeMode, obstacleClearance]);
  const { viewBox, source, target, obstacle, start, end } = avoidanceExample;
  const guideY = obstacle.y - obstacleClearance;
  return <figure className="canvas-routing-preview">
    <svg className="routing-avoidance-diagram" viewBox={viewBox} role="img" data-routing-avoidance-preview
      aria-label={t('edgeRouting.avoidancePreview')} aria-describedby={descriptionId}>
      <desc id={descriptionId}>{t('edgeRouting.clearanceGuide')} {obstacleClearance} px</desc>
      <rect className="routing-preview-node" {...source} rx="9" />
      <rect className="routing-preview-node" {...target} rx="9" />
      <rect className="routing-preview-node" {...obstacle} rx="9" data-preview-obstacle />
      <path className="routing-preview-guide" fill="none"
        d={`M ${obstacle.x} ${obstacle.y} V ${guideY} h ${obstacle.width} V ${obstacle.y}`} />
      <path className="routing-preview-path" fill="none" d={path} data-preview-route />
      <g className="routing-preview-port">
        <circle cx={start.x} cy={start.y} r="5.4" />
        <circle cx={end.x} cy={end.y} r="5.4" />
      </g>
    </svg>
  </figure>;
}
