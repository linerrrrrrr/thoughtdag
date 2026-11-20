import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmt, useT } from '../../i18n';
import { canvasTypePreview, type CanvasTypography } from '../../lib/canvas-typography';
import './CanvasTypographyCurve.css';

type Field = keyof CanvasTypography;
type Series = keyof ReturnType<typeof canvasTypePreview>;
type Target = Field | 'zoom';

const minZoom = 4, maxZoom = 200, maxSize = 24;
const anchors = { bodySize: 100, bodyExponent: 50, summaryExponent: 200 } as const;
const seriesLabels = {
  body: 'canvasType.curveBody', summary: 'canvasType.curveSummary', compact: 'canvasType.curveCompact',
} as const;
const series: Series[] = ['body', 'summary', 'compact'];
const fields: Field[] = ['bodyExponent', 'bodySize', 'summaryExponent'];
const roleFor = (field: Field) => field === 'summaryExponent' ? 'summary' : 'body';
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const rounded = (n: number, digits: number) => Number(n.toFixed(digits));

interface Props {
  settings: CanvasTypography;
  zoom: number;
  rootSize: number;
  onChange: (field: Field, value: number) => void;
  onZoom: (percent: number) => void;
}

export default function CanvasTypographyCurve({ settings, zoom, rootSize, onChange, onZoom }: Props) {
  const t = useT();
  const title = useId(), hint = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [focused, setFocused] = useState<Field | null>(null);
  const [hovered, setHovered] = useState<Field | null>(null);
  const [{ width, height }, setSize] = useState({ width: 300, height: 160 });
  useLayoutEffect(() => {
    const element = svg.current!;
    const resize = () => setSize({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const plot = { left: 29, right: width - 23, top: 17, bottom: height - 24 };
  const plotX = (z: number) => plot.left + (z - minZoom) / (maxZoom - minZoom) * (plot.right - plot.left);
  const plotY = (size: number) => plot.bottom - size / maxSize * (plot.bottom - plot.top);
  const drag = useRef<{ pointerId: number; target: Target; offsetY: number } | null>(null);
  const sizes = canvasTypePreview(settings, zoom / 100);
  const screenSize = (size: number) => rounded(size * rootSize / 16, 2);
  const sizeAtAnchor = (field: Field) => canvasTypePreview(settings, anchors[field] / 100)[roleFor(field)];
  const summaryBase = canvasTypePreview(settings, 1).summary;
  const bounds = (field: Field): [number, number] => {
    if (field === 'bodySize') return [12, 24];
    if (field === 'bodyExponent') return [settings.bodySize / 2, settings.bodySize];
    return [summaryBase, summaryBase * 2];
  };
  function changeField(field: Field, value: number) {
    const next = field === 'bodySize' ? clamp(Math.round(value), 12, 24)
      : clamp(rounded(Math.round(value * 20) / 20, 2), 0, 1);
    if (next !== settings[field]) onChange(field, next);
  }
  function changeSize(field: Field, size: number) {
    const [min, max] = bounds(field);
    const target = clamp(size, min, max);
    if (field === 'bodySize') changeField(field, target);
    else if (field === 'bodyExponent') changeField(field, Math.log(target / settings.bodySize) / Math.log(.5));
    else changeField(field, Math.log2(target / summaryBase));
  }
  function point(event: PointerEvent<SVGElement>) {
    const rect = svg.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height };
  }
  function scrub(x: number) {
    const percent = minZoom + (x - plot.left) / (plot.right - plot.left) * (maxZoom - minZoom);
    onZoom(clamp(Math.round(percent), minZoom, maxZoom));
  }
  function start(event: PointerEvent<SVGElement>, target: Target) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const pos = point(event);
    const offsetY = target === 'zoom' ? 0 : pos.y - plotY(sizeAtAnchor(target));
    drag.current = { pointerId: event.pointerId, target, offsetY };
    svg.current!.setPointerCapture(event.pointerId);
    if (target === 'zoom') scrub(pos.x);
    else onZoom(anchors[target]);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const pos = point(event);
    if (active.target === 'zoom') scrub(pos.x);
    else changeSize(active.target, (plot.bottom - pos.y + active.offsetY) * maxSize / (plot.bottom - plot.top));
  }
  function stop(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function key(event: KeyboardEvent<SVGElement>, target: Target) {
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    event.stopPropagation();
    setHovered(null);
    if (target === 'zoom') {
      onZoom(clamp(direction ? zoom + direction : event.key === 'Home' ? minZoom : maxZoom, minZoom, maxZoom));
    } else {
      onZoom(anchors[target]);
      if (direction) {
        const step = target === 'bodySize' ? 1 : target === 'bodyExponent' ? -.05 : .05;
        changeField(target, settings[target] + direction * step);
      } else {
        const [min, max] = bounds(target);
        changeSize(target, event.key === 'Home' ? min : max);
      }
    }
  }
  // Include both compensation thresholds and 100% so the kinks stay exact.
  const paths: Record<Series, string[]> = { body: [], summary: [], compact: [] };
  for (let percent = minZoom; percent <= maxZoom; percent += 2) {
    const sample = canvasTypePreview(settings, percent / 100);
    for (const role of series) paths[role].push(`${rounded(plotX(percent), 2)},${rounded(plotY(sample[role]), 2)}`);
  }
  const highlighted = hovered ?? focused;
  const valueLabel = highlighted && `${screenSize(sizeAtAnchor(highlighted))} px`;
  return <figure className="canvas-type-curve" aria-labelledby={title} data-canvas-typography-curve>
    <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
      <span id={title} className="text-control font-medium">{t('canvasType.curveTitle')}</span>
      <span className="text-meta text-ink-muted">{t('canvasType.curveY')}</span>
    </figcaption>
    <svg ref={svg} viewBox={`0 0 ${width} ${height}`} data-canvas-type-chart data-cursor="neutral" role="group"
      aria-labelledby={title} aria-describedby={hint} onPointerMove={move}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
      <desc id={hint}>{t('canvasType.curveHint')}</desc>
      <g className="curve-grid" aria-hidden="true">
        {[0, 6, 12, 18, 24].map(n => <g key={n}>
          <line x1={plot.left} x2={plot.right} y1={plotY(n)} y2={plotY(n)} />
          <text x={plot.left - 5} y={plotY(n)} textAnchor="end" dominantBaseline="central">{screenSize(n)}</text>
        </g>)}
        {[minZoom, 50, 100, 150, maxZoom].map(n => <text key={n} x={plotX(n)} y={height - 6} textAnchor="middle">{n}%</text>)}
      </g>
      <g className="curve-data" aria-hidden="true">
        {series.map(role => <polyline key={role} data-series={role} points={paths[role].join(' ')} />)}
        <line className="curve-guide" x1={plotX(zoom)} x2={plotX(zoom)} y1={plot.top} y2={plot.bottom} />
        {(['body', 'summary'] as const).map(role => <circle key={role} data-series={role}
          cx={plotX(zoom)} cy={plotY(sizes[role])} r="2.75" />)}
      </g>
      <rect x={plot.left - 8} y={plot.top - 8} width={Math.max(1, plot.right - plot.left + 16)} height={plot.bottom - plot.top + 18}
        className="curve-scrubber" data-cursor="resize-width" tabIndex={0} role="slider" aria-orientation="horizontal"
        aria-label={t('canvasType.previewZoom')} aria-valuemin={minZoom} aria-valuemax={maxZoom}
        aria-valuenow={zoom} aria-valuetext={`${zoom}%`} aria-describedby={hint} data-canvas-type-scrubber
        onPointerDown={event => start(event, 'zoom')} onKeyDown={event => key(event, 'zoom')} />
      {fields.map(field => {
        const [min, max] = bounds(field);
        const n = anchors[field], value = screenSize(sizeAtAnchor(field));
        const label = fmt(t('canvasType.pointLabel'), { zoom: n, role: t(seriesLabels[roleFor(field)]) });
        return <g key={field} transform={`translate(${plotX(n)} ${plotY(sizeAtAnchor(field))})`}
          className="curve-handle" data-cursor="resize-height" data-series={roleFor(field)} data-canvas-type-handle={field}
          tabIndex={0} role="slider" aria-label={label} aria-orientation="vertical" aria-describedby={hint}
          aria-valuemin={screenSize(min)} aria-valuemax={screenSize(max)} aria-valuenow={value} aria-valuetext={`${value} px`}
          onFocus={() => { setFocused(field); setHovered(null); }} onBlur={() => setFocused(null)}
          onPointerEnter={() => setHovered(field)} onPointerLeave={() => setHovered(null)}
          onPointerDown={event => start(event, field)} onKeyDown={event => key(event, field)}>
          <rect x="-16" y="-16" width="32" height="32" fill="transparent" />
          <circle className="curve-focus-ring" r="8.5" />
          <circle className="curve-anchor" r="4.5" />
        </g>;
      })}
      {highlighted && valueLabel && <g className="curve-value" aria-hidden="true" data-canvas-type-point-value={highlighted}
        transform={`translate(${plotX(anchors[highlighted]) + (highlighted === 'summaryExponent' ? -39 : 39)} ${plotY(sizeAtAnchor(highlighted))})`}>
        <rect x="-29" y="-10" width="58" height="20" rx="4" />
        <text textAnchor="middle" dominantBaseline="central">{valueLabel}</text>
      </g>}
    </svg>
    <dl className="canvas-type-curve-legend">
      {series.map(role => <div key={role} data-series={role}>
        <dt><i aria-hidden="true" />{t(seriesLabels[role])}</dt>
        <dd><b>{screenSize(sizes[role])} px</b></dd>
      </div>)}
    </dl>
  </figure>;
}
