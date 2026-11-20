import { useEffect, useEffectEvent, useId, useRef, useState, type CSSProperties } from 'react';
import { LocateFixed, Pause, Play } from 'lucide-react';
import { useT } from '../../i18n';
import { canvasTypeVariables, type CanvasTypography } from '../../lib/canvas-typography';
import { screenToUi } from '../../lib/ui-scale';
import './CanvasTypographyPreview.css';

interface Props {
  settings: CanvasTypography;
  zoom: number;
  onZoom: (percent: number) => void;
  playing: boolean;
  onPlayingChange: (value: boolean) => void;
}

const minZoom = 4;
const maxZoom = 200;
const center = { x: 0, y: 0 };

export default function CanvasTypographyPreview({ settings, zoom, onZoom, playing, onPlayingChange }: Props) {
  const t = useT();
  const zoomId = useId();
  const titleId = useId();
  const stage = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState(center);
  const drag = useRef<{ id: number; x: number; y: number; origin: typeof center } | null>(null);
  const factor = zoom / 100;
  const manualZoom = (percent: number) => {
    onPlayingChange(false);
    onZoom(Math.max(minZoom, Math.min(maxZoom, percent)));
  };
  const wheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.deltaY) return;
    const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
    const next = zoom * 2 ** (-event.deltaY * unit);
    manualZoom(next > zoom ? Math.ceil(next) : Math.floor(next));
  });
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const listener = (event: WheelEvent) => wheel(event);
    element.addEventListener('wheel', listener, { passive: false });
    return () => element.removeEventListener('wheel', listener);
  }, []);

  const currentZoom = useEffectEvent(() => zoom);
  const advance = useEffectEvent((value: number) => onZoom(value));
  useEffect(() => {
    if (!playing) return;
    const start = currentZoom() - minZoom;
    const span = maxZoom - minZoom;
    const startedAt = performance.now();
    let last = currentZoom();
    let frame = requestAnimationFrame(tick);
    function tick(time: number) {
      const phase = (start + (time - startedAt) * 0.04) % (2 * span);
      const value = Math.round(maxZoom - Math.abs(span - phase));
      if (value !== last) advance(value);
      last = value;
      frame = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const playbackLabel = t(playing ? 'canvasType.pause' : 'canvasType.play');
  return <section className="type-demo" aria-labelledby={titleId} data-canvas-typography-preview>
    <h5 id={titleId} className="text-control font-medium">{t('canvasType.previewTitle')}</h5>
    <div className="type-demo-frame">
      <div ref={stage} className="type-demo-stage" data-canvas-typography-stage role="group" tabIndex={0}
        aria-labelledby={titleId} aria-description={t('canvasType.previewPanHint')}
        style={{ backgroundPosition: `calc(50% + ${pan.x}px) calc(50% + ${pan.y}px)`, backgroundSize: `${Math.max(5, 18 * factor)}px ${Math.max(5, 18 * factor)}px` }}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: pan };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          setPan({ x: start.origin.x + screenToUi(event.clientX - start.x), y: start.origin.y + screenToUi(event.clientY - start.y) });
        }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => {
          const delta = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key];
          if (!delta) return;
          event.preventDefault();
          setPan(({ x, y }) => ({ x: x + delta[0], y: y + delta[1] }));
        }}>
        <div className="type-demo-world" data-type-surface="type-preview-camera" style={{
          ...canvasTypeVariables(settings, factor),
          '--preview-scale': factor,
          '--preview-pan-x': `${pan.x}px`,
          '--preview-pan-y': `${pan.y}px`,
        } as CSSProperties}>
          {(['body', 'summary'] as const).map(role => <div key={role} className="type-demo-node"
            data-canvas-typography-node={role === 'body' ? 'full' : 'summary'} data-type-surface="type-preview">
            <span className="type-demo-node-level">{t(role === 'body' ? 'detail.full' : 'detail.summary')}</span>
            <strong>{t('canvasType.previewQuestion')}</strong>
            <p data-canvas-typography-sample={role}>{t('canvasType.previewAnswer')}</p>
          </div>)}
        </div>
      </div>
      <div className="type-demo-controls">
        <button type="button" aria-label={playbackLabel} data-tooltip={playbackLabel}
          aria-pressed={playing} data-canvas-type-play onClick={() => onPlayingChange(!playing)}>
          {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
        <input id={zoomId} type="range" min={minZoom} max={maxZoom} step={1} value={zoom}
          aria-label={t('canvasType.previewZoom')} aria-valuetext={`${zoom}%`} data-canvas-typography-preview-zoom
          onChange={event => manualZoom(event.currentTarget.valueAsNumber)} />
        <output className="text-control font-medium tabular-nums" htmlFor={zoomId} aria-live="off">{zoom}%</output>
        <button type="button" aria-label={t('canvasType.recenter')} data-tooltip={t('canvasType.recenter')}
          onClick={() => setPan(center)}>
          <LocateFixed size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  </section>;
}
