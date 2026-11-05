import { useRef, useState } from 'react';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { createPortal } from 'react-dom';
import { useUiStore, confirmDialog, toast } from '../../lib/ui-store';
import { useStore } from '../../store';
import { RECALL_SCALES, reachEstimate, type RecallReach, type RecallScale } from '../../lib/recall';
import { judgeConfigured } from '../../lib/judge';
import { whyBridge } from '../../lib/why-bridge';
import { useT, fmt } from '../../i18n';

// Recall, as a quiet chip beside the two search icons: its name, and when on,
// its reach. The chip opens a small menu: the switch, the reach, the amount.
// What is changed there holds for the next ask only (the ask spends it);
// "set as default" writes it back to the defaults the judge page shows.
// With a `nodeId` the chip is that node's own snapshot (its question editor):
// the menu edits the node, which its re-asks then run with; no default row.
export default function RecallChip({ nodeId }: { nodeId?: string } = {}) {
  const t = useT();
  const enabled = useUiStore((s) => s.recallEnabled);
  const reachDefault = useUiStore((s) => s.recallReach);
  const scaleDefault = useUiStore((s) => s.recallScale);
  const override = useUiStore((s) => s.recallOverride);
  const setOverride = useUiStore((s) => s.setRecallOverride);
  const setEnabled = useUiStore((s) => s.setRecallEnabled);
  const setReachDefault = useUiStore((s) => s.setRecallReach);
  const setScaleDefault = useUiStore((s) => s.setRecallScale);
  const judgeCfg = useUiStore((s) => s.judge);
  const judged = judgeConfigured(judgeCfg);
  const node = useStore((s) => (nodeId ? s.nodes.find((n) => n.id === nodeId)?.data : undefined));
  const on = nodeId ? (node?.recall ?? enabled) : (override?.enabled ?? enabled);
  const reach = nodeId ? (node?.recallReach ?? reachDefault) : (override?.reach ?? reachDefault);
  const scale = nodeId ? (node?.recallScale ?? scaleDefault) : (override?.scale ?? scaleDefault);
  // a choice goes to the next ask's override, or, for a node, into the node itself
  const apply = (p: { enabled?: boolean; reach?: RecallReach; scale?: RecallScale }) => {
    if (!nodeId) { setOverride(p); return; }
    useStore.setState((s) => ({ nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...(p.enabled !== undefined ? { recall: p.enabled } : {}), ...(p.reach ? { recallReach: p.reach } : {}), ...(p.scale ? { recallScale: p.scale } : {}) } } : n)) }));
  };
  // the menu is a portal on the body, placed by the chip's rect at open time: inside a card it would
  // otherwise sit in the node's stacking context, under the next card
  const [open, setOpen] = useState<{ left: number; bottom: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDismissableLayer({ dismissOnFocusOutside: true, open: !!open, refs: [root, menu], onDismiss: () => setOpen(null) });
  const reachLabel = (r: RecallReach) => t(r === 'light' ? 'recall.reachLight' : r === 'deep' ? 'recall.reachDeep' : 'recall.reachFullShort');
  const scaleLabel = (s: RecallScale) => t(s === 'lean' ? 'recall.scaleLean' : s === 'standard' ? 'recall.scaleStandard' : 'recall.scaleGenerous');
  const pickReach = async (r: RecallReach) => {
    if (r === 'full') {
      const counted = await Promise.resolve().then(() => whyBridge()?.turns({ limit: 0 })).then((x) => ({ total: x?.total ?? 0, refreshing: !!x?.refreshing })).catch(() => ({ total: 0, refreshing: false }));
      // a stale index rebuilds in the background (#57): say so, no number to show yet
      if (counted.refreshing) { toast('info', t('recall.reachFullRefreshing'), 6000); return; }
      const total = counted.total;
      // nothing to hand to the judge (an empty index): full has no meaning yet, and a dialog pricing 0 turns at
      // $0.00 would only look broken
      if (!total) { toast('info', t('recall.reachFullEmpty'), 6000); return; }
      const est = reachEstimate(total);
      // the wait is named, not numbered: it is tens of seconds either way and the number only invited quibbles
      const ok = await confirmDialog({ title: t('recall.reachFullTitle'), message: fmt(t('recall.reachFullMsg'), { n: total.toLocaleString(), c: est.dollars.toFixed(2) }), confirmLabel: t('recall.reachFullOk') });
      if (!ok) return;
    }
    apply({ reach: r });
  };
  const changed = !nodeId && !!override && ((override.enabled !== undefined && override.enabled !== enabled) || (override.reach !== undefined && override.reach !== reachDefault) || (override.scale !== undefined && override.scale !== scaleDefault));
  const setDefault = () => {
    setEnabled(on); setReachDefault(reach); setScaleDefault(scale); setOverride(null);
    toast('success', t('recall.menuDefaultDone'), 3000);
    setOpen(null);
  };
  const seg = (key: string, active: boolean, disabled: boolean, label: string, onClick: () => void, title?: string) => (
    // greyed, not disabled: a disabled button gets no hover, and the hover is where the reason lives
    <button key={key} type="button" aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick} title={title} className={`px-2 py-0.5 rounded-tag text-control whitespace-nowrap transition-colors ${active ? 'bg-action text-white' : disabled ? 'text-ink-faint opacity-50 cursor-default' : 'text-ink-muted hover:bg-wash'}`} data-recall-menu-option={key}>{label}</button>
  );
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        // inside a card the click must not select the node (that opens the panel and swaps the composer away)
        onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setOpen((v) => (v ? null : { left: Math.max(8, Math.min(r.right - 296, window.innerWidth - 304)), bottom: window.innerHeight - r.top + 8 })); }}
        aria-expanded={!!open}
        title={on ? t('toolbar.recall') : t('toolbar.recallOff')}
        className={`h-8 px-2.5 rounded-control flex items-center gap-1.5 text-control font-medium transition-colors ${on ? 'text-accent bg-accent/15 ring-1 ring-accent/40 hover:bg-accent/25' : 'text-ink-muted opacity-60 hover:opacity-100 hover:bg-line'}`}
        data-recall-toggle
        data-recall-on={on ? 'on' : 'off'}
        data-recall-reach={on ? reach : undefined}
      >
        {on && <span className="w-1.5 h-1.5 shape-circle bg-accent" aria-hidden />}
        <span>{on ? fmt(t('recall.chipOn'), { r: reachLabel(reach) }) : t('recall.chip')}</span>
      </button>
      {open && createPortal(
        // mousedown is swallowed AND defaulted away: inside a question editor the textarea must keep its focus (its blur closes the editor)
        <div ref={menu} style={{ position: 'fixed', left: open.left, bottom: open.bottom }} className="w-[296px] rounded-overlay border border-line bg-card shadow-lg p-3 z-[90] text-control space-y-2.5" data-recall-menu data-recall-menu-scope={nodeId ? 'node' : 'ask'} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink font-medium">{t('recall.menuOn')}</span>
            <button type="button" role="switch" aria-checked={on} onClick={() => apply({ enabled: !on })} className={`relative w-9 h-5 rounded-control transition-colors shrink-0 ${on ? 'bg-accent' : 'bg-line-strong'}`} data-recall-menu-switch>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 shape-circle bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-faint whitespace-nowrap" title={t('recall.reachHint')}>{t('recall.menuReach')}</span>
            <div className="flex gap-0.5" data-recall-menu-reach>
              {(['light', 'deep', 'full'] as RecallReach[]).map((r) => seg(r, reach === r, !on || (!judged && r !== 'light'), reachLabel(r), () => void pickReach(r), on && !judged && r !== 'light' ? t('recall.menuNeedsJudge') : undefined))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-faint whitespace-nowrap" title={t('recall.scaleHint')}>{t('recall.menuScale')}</span>
            <div className="flex gap-0.5" data-recall-menu-scale>
              {(['lean', 'standard', 'generous'] as RecallScale[]).map((s) => seg(s, scale === s, !on, `${scaleLabel(s)} ${RECALL_SCALES[s].budget / 1000}k`, () => apply({ scale: s })))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-line/70">
            <span className="text-control text-ink-faint">{t(nodeId ? 'recall.menuNode' : 'recall.menuOnce')}</span>
            {!nodeId && <button type="button" onClick={setDefault} disabled={!changed} className="text-control text-accent hover:underline disabled:opacity-40 disabled:no-underline" data-recall-menu-default>{t('recall.menuDefault')}</button>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
