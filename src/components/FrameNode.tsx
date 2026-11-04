import { useRef, useState } from 'react';
import { NodeResizer, useStore as useRfStore, type NodeProps } from '@xyflow/react';
import { Link2, Link2Off } from 'lucide-react';
import type { ThoughtNode as ThoughtNodeType } from '../types';
import { useStore } from '../store';
import { isImeComposing } from '../utils';
import { FRAME_COLORS } from '../lib/constants';
import { useT } from '../i18n';
import { isViewerMode } from '../lib/viewer';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';

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
  // High-level info stays SCREEN-size constant: the title and carry state
  // counter-scale against zoom-out, so region
  // names and their controls remain readable AND operable on the map.
  // Quantized to 0.1 steps so zooming doesn't re-render every frame.
  const barScale = useRfStore((s) => Math.min(5, Math.max(1, Math.round(10 / s.transform[2]) / 10)));

  const [editing, setEditing] = useState(!isViewerMode && !data.question);
  const [draft, setDraft] = useState(data.question);
  const titleRef = useRef<HTMLInputElement>(null);

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
      {/* Title bar — drag surface; counter-scaled width keeps it spanning the frame */}
      <div
        data-frame-header
        className="drag-handle pointer-events-auto cursor-grab active:cursor-grabbing px-5 py-2 flex items-center gap-2 min-w-0"
        style={barScale > 1 ? { transform: `scale(${barScale})`, transformOrigin: 'top left', width: `${100 / barScale}%` } : undefined}
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
            className="flex-1 min-w-24 bg-transparent text-sm font-semibold text-ink-muted focus:outline-none placeholder-ink-faint nodrag"
            data-frame-title-editor
          />
        ) : (
          /* min-w floor: on a deep zoom-out the scaled controls must not squeeze
             the region name to nothing — the row overflows the frame edge
             instead (the title is the higher-value signal on the map) */
          <span
            onDoubleClick={() => { if (isViewerMode) return; setDraft(data.question); setEditing(true); }}
            className={`flex-1 min-w-24 truncate font-semibold text-ink-muted/80 select-none text-xs ${barScale > 1 ? 'normal-case' : 'uppercase tracking-wider'}`}
            title={t('content.noteEditTitle')}
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
      <NodeResizer isVisible={selected && !isViewerMode} minWidth={280} minHeight={180} keepAspectRatio={!!data.lockAspectRatio} onResizeStart={recordStep} onResizeEnd={recordStep} lineClassName="!border-accent/40 !pointer-events-auto" handleClassName="!bg-accent !w-2.5 !h-2.5 !rounded-[2px] !pointer-events-auto" />
    </div>
  );
}
