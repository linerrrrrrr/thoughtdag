import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Frame, Maximize, MousePointer2, Trash2, X } from 'lucide-react';
import type { ThoughtNode } from '../types';
import { useStore } from '../store';
import { FRAME_COLORS } from '../lib/constants';
import { frameContentIds, frameMembers, resolveCarriedNodeIds } from '../lib/frames';
import { canvasGroupId } from '../lib/node-groups';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';
import { confirmDialog } from '../lib/ui-store';
import { isImeComposing } from '../utils';
import { useT, fmt } from '../i18n';

const actionClass = 'w-full min-h-8 px-2.5 py-1.5 rounded-control text-xs text-ink-muted hover:bg-wash transition-colors flex items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed';
const colorLabels = {
  gray: 'frame.colorGray', violet: 'frame.colorViolet', amber: 'frame.colorAmber',
  green: 'frame.colorGreen', sky: 'frame.colorSky', rose: 'frame.colorRose',
} as const;

function FrameName({ frame }: { frame: ThoughtNode }) {
  const t = useT();
  const editor = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(frame.data.question);
  const cancel = () => { setEditing(false); setDraft(frame.data.question); };
  const commit = () => {
    useStore.getState().setFrameProperties([frame.id], { title: draft });
    setEditing(false);
  };
  const dismiss = useInlineEditDismiss({ active: editing, ref: editor, onOutside: commit, onCancel: cancel });
  return <div ref={editor} onBlur={dismiss.onBlur} className="space-y-2">
    <label className="block space-y-1.5">
      <span className="text-xs text-ink-muted">{t('frame.settingsName')}</span>
      <input data-frame-name aria-label={t('frame.settingsName')} type="text" maxLength={120}
        value={editing ? draft : frame.data.question} placeholder={t('frame.titlePlaceholder')}
        onFocus={() => { setDraft(frame.data.question); setEditing(true); }}
        onChange={event => { setDraft(event.target.value); setEditing(true); }}
        onKeyDown={event => { if (event.key === 'Enter' && !isImeComposing(event)) { event.preventDefault(); event.stopPropagation(); commit(); } }}
        className="h-9 w-full rounded-control border border-line bg-card px-2.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:ring-1 focus:ring-accent" />
    </label>
    {editing && draft !== frame.data.question && <div className="flex justify-end gap-1">
      <button type="button" className={`${actionClass} !w-auto`} onClick={cancel} aria-label={t('common.cancel')}><X size={14} /></button>
      <button type="button" className={`${actionClass} !w-auto text-accent`} onClick={commit}><Check size={14} />{t('format.apply')}</button>
    </div>}
  </div>;
}

/** Frame-only fields share the inspector but never implicitly select contents. */
export default function FrameSettings({ frames, children }: { frames: ThoughtNode[]; children: ReactNode }) {
  const t = useT();
  const nodes = useStore(state => state.nodes);
  const carryInput = useRef<HTMLInputElement>(null);
  const ids = frames.map(frame => frame.id);
  const contentIds = new Set(frameContentIds(nodes, ids));
  const content = nodes.filter(node => contentIds.has(node.id));
  const groups = new Set(content.map(canvasGroupId).filter(Boolean));
  const allMemberIds = new Set(frameContentIds(nodes, ids, true));
  const nestedFrames = nodes.filter(node => allMemberIds.has(node.id) && node.data.stepKind === 'frame').length;
  const movingIds = new Set(resolveCarriedNodeIds(nodes, ids));
  const movingCount = nodes.filter(node => movingIds.has(node.id) && node.data.stepKind !== 'frame').length;
  const carried = frames.filter(frame => frame.data.frameCarry !== false);
  const mixedCarry = carried.length > 0 && carried.length < frames.length;
  const allCarry = carried.length === frames.length;
  const colors = new Set(frames.map(frame => frame.data.frameColor ?? 'gray'));
  const canFit = frames.some(frame => frameMembers(frame, nodes).length > 0);
  useEffect(() => { if (carryInput.current) carryInput.current.indeterminate = mixedCarry; }, [mixedCarry]);
  return <>
    <section className="px-4 py-3 space-y-3" aria-label={t('frame.settingsBasic')} data-frame-settings>
      {frames.length === 1 ? <FrameName key={frames[0].id} frame={frames[0]} />
        : <p className="text-xs text-ink-muted leading-relaxed">{t('frame.namesIndependent')}</p>}
      <div className="space-y-2">
        <div className="flex gap-2 items-center text-xs text-ink-muted">
          <span>{t('frame.settingsColor')}</span>
          {colors.size > 1 && <span className="text-ink-faint">{t('format.mixed')}</span>}
        </div>
        <div className="flex gap-1.5" role="group" aria-label={t('frame.settingsColor')}>
          {Object.entries(FRAME_COLORS).map(([name, color]) => <button key={name} type="button"
            data-frame-color={name} aria-label={t(colorLabels[name as keyof typeof colorLabels])}
            title={t(colorLabels[name as keyof typeof colorLabels])} aria-pressed={colors.size === 1 && colors.has(name)}
            onClick={() => useStore.getState().setFrameProperties(ids, { color: name })}
            className={`w-8 h-8 flex items-center justify-center rounded-control border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${colors.size === 1 && colors.has(name) ? 'border-accent' : 'border-transparent hover:bg-wash'}`}>
            <span className={`w-4 h-4 rounded-tag ${color.dot}`} aria-hidden="true" />
          </button>)}
        </div>
      </div>
    </section>
    <div className="border-t border-line">{children}</div>
    <section className="px-4 py-3 border-t border-line space-y-3" aria-label={t('frame.settingsMovement')}>
      <h3 className="text-xs font-medium text-ink">{t('frame.settingsMovement')}</h3>
      <label className="flex items-start gap-2 text-xs text-ink-muted cursor-pointer min-h-6 leading-5">
        <input ref={carryInput} type="checkbox" checked={allCarry} aria-checked={mixedCarry ? 'mixed' : allCarry}
          data-frame-carry onChange={event => useStore.getState().setFrameProperties(ids, { carry: event.target.checked })}
          className="h-3.5 w-3.5 mt-0.5 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
        <span>{t('frame.moveContents')}{mixedCarry && <span className="ml-1 text-ink-faint">{t('frame.partlyLinked')}</span>}</span>
      </label>
      <p className="text-xs text-ink-muted" data-frame-moving-count>{fmt(t('frame.movingCount'), { n: movingCount })}</p>
      <p className="text-xs text-ink-faint leading-relaxed">{t('frame.resizeBoundaryHint')}</p>
    </section>
    <section className="px-4 py-3 border-t border-line space-y-2" aria-label={t('frame.settingsRange')}>
      <h3 className="text-xs font-medium text-ink">{t('frame.settingsRange')}</h3>
      <p className="text-xs text-ink-muted leading-relaxed" data-frame-content-count>
        {fmt(t('frame.contentCount'), { nodes: content.length, groups: groups.size })}
        {nestedFrames > 0 && <span className="block">{fmt(t('frame.nestedCount'), { n: nestedFrames })}</span>}
      </p>
      <p className="text-xs text-ink-faint leading-relaxed">{t('frame.fullContainmentHint')}</p>
      <div className="-mx-2 space-y-0.5">
        <button type="button" className={actionClass} data-frame-select-contents disabled={!content.length}
          onClick={() => useStore.getState().selectFrameContents(ids, false)}><MousePointer2 size={14} className="shrink-0" />{t('frame.selectContents')}</button>
        <button type="button" className={actionClass} data-frame-select-all
          onClick={() => useStore.getState().selectFrameContents(ids, true)}><Frame size={14} className="shrink-0" />{t('frame.selectWithContents')}</button>
        <button type="button" className={actionClass} data-frame-fit disabled={!canFit} title={t('frame.fitHint')}
          onClick={() => useStore.getState().fitFramesToContents(ids)}><Maximize size={14} className="shrink-0" />{t('frame.fitContents')}</button>
      </div>
    </section>
  </>;
}

export function FrameObjectActions({ frames, allowDelete = true }: { frames: ThoughtNode[]; allowDelete?: boolean }) {
  const t = useT();
  const ids = frames.map(frame => frame.id);
  return <section className="px-2 py-2 border-t border-line space-y-0.5" aria-label={t('frame.settingsActions')}>
    <button type="button" className={actionClass} data-frame-copy="only"
      onClick={() => useStore.getState().duplicateFrames(ids, false)}><Copy size={14} />{t('frame.copyOnly')}</button>
    <button type="button" className={actionClass} data-frame-copy="contents"
      onClick={() => useStore.getState().duplicateFrames(ids, true)}><Copy size={14} />{t('frame.copyWithContents')}</button>
    {allowDelete && <button type="button" className={`${actionClass} text-watch`} data-frame-delete
      onClick={() => {
        void confirmDialog({ title: t('frame.deleteOnly'), message: fmt(t('frame.deleteOnlyConfirm'), { n: ids.length }), confirmLabel: t('common.delete'), danger: true })
          .then(ok => { if (ok) useStore.getState().batchDelete(ids); });
      }}><Trash2 size={14} />{t('frame.deleteOnly')}</button>}
  </section>;
}
