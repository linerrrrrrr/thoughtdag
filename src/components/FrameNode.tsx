import { useLayoutEffect, useRef, useState } from 'react';
import { NodeResizer, useStore as useRfStore, type NodeProps } from '@xyflow/react';
import { Link2, Link2Off } from 'lucide-react';
import type { ThoughtNode as ThoughtNodeType } from '../types';
import { useStore } from '../store';
import { isImeComposing } from '../utils';
import { FRAME_COLORS } from '../lib/constants';
import { useT } from '../i18n';
import { isViewerMode } from '../lib/viewer';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';
import { frameHeaderScale, FRAME_HEADER_INSET, FRAME_MIN_WIDTH, FRAME_MIN_HEIGHT } from '../lib/frame-sizing';

// Frame: a labeled background region — THE spatial annotation. No handles
// (it can never be wired, so it can never touch context), ignored by
// autoLayout, sits behind nodes (zIndex -1). Drag by the title bar; the
// title stays readable when zoomed out (same semantic-zoom trick as cards).
// Color is a FIXED palette (no picker): frames are pure navigation objects,
// so color is function, not decoration (palette lives in lib/constants).

/** Resizing is a step of its own: settle before, record after. */
const recordStep = () => useStore.getState().pushHistory();

export default function FrameNode({ id, data, selected }: NodeProps<ThoughtNodeType>) {
  const t = useT();
  const setFrameProperties = useStore((s) => s.setFrameProperties);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const zoom = useRfStore(s => s.transform[2]);
  const width = useRfStore(s => {
    const node = s.nodeLookup.get(id);
    return node?.width ?? node?.measured.width ?? FRAME_MIN_WIDTH;
  });
  // Read rendered geometry so previews and manual resizing use the same
  // header boundary, without writing any measurement back to the graph.
  const topSpace = useRfStore(s => {
    const frame = s.nodeLookup.get(id);
    if (!frame) return FRAME_MIN_HEIGHT;
    const origin = frame.internals.positionAbsolute;
    const frameWidth = frame.width ?? frame.measured.width ?? FRAME_MIN_WIDTH;
    const frameHeight = frame.height ?? frame.measured.height ?? FRAME_MIN_HEIGHT;
    let space = frameHeight;
    for (const node of s.nodeLookup.values()) {
      if (node.id === id) continue;
      const position = node.internals.positionAbsolute;
      const w = node.width ?? node.measured.width ?? 0;
      const h = node.height ?? node.measured.height ?? 0;
      if (w > 0 && h > 0 && position.x >= origin.x && position.y >= origin.y
        && position.x + w <= origin.x + frameWidth + 0.01 && position.y + h <= origin.y + frameHeight + 0.01) {
        space = Math.min(space, position.y - origin.y);
      }
    }
    return space;
  });

  const [editing, setEditing] = useState(!isViewerMode && !data.question);
  const [draft, setDraft] = useState(data.question);
  const titleRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 160, height: 24 });
  const label = (editing ? draft : data.question) || t('frame.titlePlaceholder');
  useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.scrollWidth + (isViewerMode ? 0 : 32) + 8, height: Math.max(24, element.offsetHeight) };
      setNaturalSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [label, editing]);
  const barScale = frameHeaderScale(zoom, width, topSpace, naturalSize.width, naturalSize.height);

  const color = FRAME_COLORS[data.frameColor ?? 'gray'] ?? FRAME_COLORS.gray;
  // Carry: dragging the frame moves the nodes inside it. Absent = linked
  // (legacy frames keep the behavior); new frames spawn unlinked so they can
  // be resized / positioned over their nodes first, then linked.
  const carry = data.frameCarry !== false;

  const commit = () => {
    setEditing(false);
    if (draft === data.question) return;
    setFrameProperties([id], { title: draft });
  };
  const titleEdit = useInlineEditDismiss({
    active: editing, ref: titleRef, onOutside: commit,
    onCancel: () => { setDraft(data.question); setEditing(false); },
  });

  return (
    <div
      data-frame-node
      className={`relative w-full h-full pointer-events-none rounded-content border border-dashed flex flex-col transition-colors ${color.border} ${color.bg} ${
        selected ? 'node-selected' : ''
      }`}
      onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) setSelectedNodeId(id); }}
    >
      <span ref={measureRef} aria-hidden="true" className={`absolute invisible pointer-events-none whitespace-nowrap font-semibold ${editing ? 'text-title' : 'text-control'}`}>{label}</span>
      {/* The label adapts to existing space; it never expands the region. */}
      <div
        data-frame-header
        className="absolute drag-handle pointer-events-auto cursor-grab active:cursor-grabbing flex items-center gap-2 min-w-0"
        style={{ left: FRAME_HEADER_INSET, top: FRAME_HEADER_INSET, transform: `scale(${barScale})`, transformOrigin: 'top left', width: Math.max(0, width - FRAME_HEADER_INSET * 2) / barScale }}
      >
        {editing ? (
          <input
            ref={titleRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={titleEdit.onBlur}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isImeComposing(e)) { e.preventDefault(); e.stopPropagation(); commit(); } }}
            placeholder={t('frame.titlePlaceholder')}
            autoFocus
            className="flex-1 min-w-0 bg-transparent text-title font-semibold text-ink-muted focus:outline-none placeholder-ink-faint nodrag"
            data-frame-title-editor
          />
        ) : (
          <span
            onDoubleClick={() => { if (isViewerMode) return; setDraft(data.question); setEditing(true); }}
            className="flex-1 min-w-0 truncate font-semibold text-ink-muted/80 select-none text-control"
            title={data.question || t('frame.titlePlaceholder')}
          >
            {data.question || <span className="text-ink-faint normal-case tracking-normal">{t('frame.titlePlaceholder')}</span>}
          </span>
        )}
        {/* Carry toggle — always visible: it changes what dragging does, and
            dragging doesn't require selecting first */}
        {!isViewerMode && <button
          onClick={(e) => { e.stopPropagation(); setFrameProperties([id], { carry: !carry }); }}
          title={carry ? t('frame.carryOn') : t('frame.carryOff')}
          aria-label={carry ? t('frame.carryOn') : t('frame.carryOff')}
          aria-pressed={carry}
          data-frame-carry-toggle
          className={`rounded-control w-6 h-6 flex items-center justify-center transition-colors shrink-0 nodrag ${
            carry ? 'text-ink-muted hover:text-ink' : 'text-ink-faint/60 hover:text-ink-muted'
          }`}
        >
          {carry ? <Link2 size={13} strokeWidth={1.75} /> : <Link2Off size={13} strokeWidth={1.75} />}
        </button>}
      </div>
      {/* Empty space passes through to the canvas so it can start a marquee. */}
      <div className="flex-1" data-frame-background />
      {/* Edge strips: the border is a drag handle too, so a large frame can be
          moved without reaching its title bar. Rendered BEFORE the resizer so
          the resizer's handles win when the frame is selected. */}
      <div data-frame-border className="drag-handle pointer-events-auto absolute inset-x-0 bottom-0 h-2.5 cursor-grab active:cursor-grabbing" />
      <div data-frame-border className="drag-handle pointer-events-auto absolute inset-y-0 left-0 w-2.5 cursor-grab active:cursor-grabbing" />
      <div data-frame-border className="drag-handle pointer-events-auto absolute inset-y-0 right-0 w-2.5 cursor-grab active:cursor-grabbing" />
      {/* resize handles: NO manual scaling — React Flow's autoScale already
          counter-scales them (Math.max(1/zoom, 1)), so they keep a constant
          screen size; scaling here again would compound to huge squares */}
      <NodeResizer isVisible={selected && !isViewerMode} minWidth={FRAME_MIN_WIDTH} minHeight={FRAME_MIN_HEIGHT} keepAspectRatio={!!data.lockAspectRatio} onResizeStart={recordStep} onResizeEnd={recordStep} lineClassName="!border-accent/40 !pointer-events-auto" handleClassName="!bg-accent !w-2.5 !h-2.5 !rounded-[2px] !pointer-events-auto" />
    </div>
  );
}
