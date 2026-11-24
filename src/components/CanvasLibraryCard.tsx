import { FolderInput, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fmt, useDateLocale, useT } from '../i18n';
import { readStoredCanvas } from '../lib/canvas-library-files';
import { canvasLibraryPreview, type CanvasLibraryPreview } from '../lib/canvas-library-preview';
import { useStore } from '../store';
import type { ProjectMeta } from '../store/projects';
import './CanvasLibrary.css';

interface Props {
  project: ProjectMeta;
  active: boolean;
  onOpen: () => void;
  onMove: () => void;
}

const pending = new Map<string, Promise<CanvasLibraryPreview>>();

function readPreview(id: string, updatedAt: number) {
  const key = JSON.stringify([id, updatedAt]);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = readStoredCanvas(id)
    .then(({ nodes, edges }) => canvasLibraryPreview(nodes, edges))
    .finally(() => { pending.delete(key); });
  pending.set(key, request);
  return request;
}

export default function CanvasLibraryCard({ project, active, onOpen, onMove }: Props) {
  const t = useT(), locale = useDateLocale(), arrowId = useId(), infoId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [loaded, setLoaded] = useState<{ id: string; updated: number; preview: CanvasLibraryPreview | null } | null>(null);
  const nodes = useStore(state => active && visible ? state.nodes : null);
  const edges = useStore(state => active && visible ? state.edges : null);
  const live = useMemo(() => nodes && edges ? canvasLibraryPreview(nodes, edges) : undefined, [nodes, edges]);
  const saved = loaded?.id === project.id && loaded.updated === project.updatedAt ? loaded.preview : undefined;
  const preview = active ? live : saved;
  const date = new Date(project.updatedAt ?? project.createdAt);

  useEffect(() => {
    if (visible || !cardRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (active || !visible) return;
    let current = true;
    const show = (value: CanvasLibraryPreview | null) => {
      if (current) setLoaded({ id: project.id, updated: project.updatedAt, preview: value });
    };
    void readPreview(project.id, project.updatedAt).then(show, () => show(null));
    return () => { current = false; };
  }, [active, visible, project.id, project.updatedAt]);

  const moveLabel = fmt(t('library.moveCanvas'), { name: project.name });
  return (
    <article className="canvas-library-card" ref={cardRef} data-canvas-library-card={project.id}>
      <button type="button" className="canvas-library-card-open" onClick={onOpen}
        aria-current={active ? 'page' : undefined} aria-label={fmt(t('library.openCanvas'), { name: project.name })} aria-describedby={infoId}>
        <span className="canvas-library-preview" aria-hidden="true">
          {preview === undefined ? <LoaderCircle size={17} className="canvas-library-loading" />
            : !preview?.cards.length ? <span className="text-meta">{t(preview?.count === 0 ? 'library.emptyCanvas' : 'library.previewFailed')}</span>
            : <svg viewBox="0 0 220 112" preserveAspectRatio="xMidYMid meet" focusable="false">
              <defs><marker id={arrowId} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3" markerHeight="3" orient="auto">
                <path d="M0 0 6 3 0 6z" className="canvas-library-map-arrow" />
              </marker></defs>
              {preview.cards.filter(card => card.kind === 'frame').map(card => (
                <rect key={card.id} className="canvas-library-map-frame" x={card.x} y={card.y} width={card.width} height={card.height} rx="2.5" />
              ))}
              {preview.wires.map(wire => <path key={wire.id} className="canvas-library-map-edge" d={wire.path}
                strokeDasharray={wire.reference ? '2.4 1.8' : undefined} markerEnd={`url(#${arrowId})`} />)}
              {preview.cards.filter(card => card.kind !== 'frame').map(card => {
                const {width, height} = card;
                return <g key={card.id} className={`canvas-library-map-node is-${card.kind}`} transform={`translate(${card.x} ${card.y})`}>
                  <rect className="canvas-library-map-shell" width={width} height={height} rx={Math.min(2.6, width / 6, height / 6)} />
                  {width > 8 && height > 6 && <>
                    <path className="canvas-library-map-title" d={`M${width*.09} ${height*.2}h${width*.55}`} />
                    <path className="canvas-library-map-rule" d={`M0 ${height*.34}h${width}`} />
                    {card.question && <rect className="canvas-library-map-question" x={width*.29} y={height*.45} width={width*.62} height={height*.13} rx=".7" />}
                    {card.answer && <path className="canvas-library-map-answer" d={`M${width*.09} ${height*.73}h${width*.7}m-${width*.7} ${height*.12}h${width*.43}`} />}
                  </>}
                </g>;
              })}
            </svg>}
          {active && <span className="canvas-library-card-flag text-meta">{t('library.currentCanvas')}</span>}
        </span>
        <span className="canvas-library-card-body">
          <span className="canvas-library-card-name text-title font-semibold">{project.name}</span>
          <span id={infoId} className="canvas-library-card-meta text-meta">
            {preview && <span>{fmt(t('library.nodeCount'), { n: preview.count })}</span>}
            {Number.isFinite(date.getTime()) && <time dateTime={date.toISOString()}>{date.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>}
          </span>
        </span>
      </button>
      <button type="button" className="canvas-library-card-move canvas-library-icon-button" onClick={onMove} aria-label={moveLabel} data-tooltip={moveLabel}>
        <FolderInput size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </article>
  );
}
