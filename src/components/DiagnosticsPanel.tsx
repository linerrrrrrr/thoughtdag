import { useEffect, useRef, useState } from 'react';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useCanvasPanelPosition } from '../lib/use-canvas-panel-position';
import { useCanvasToolCard } from '../lib/use-canvas-tool-card';
import { Crosshair, Stethoscope, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { runDiagnostics, type Finding } from '../lib/diagnostics';
import { useT, fmt } from '../i18n';

// The whole-graph mirror: on-demand topology check-up (never live linting).
// Tier 1 = deterministic problems with one-click fixes (delete the edge);
// Tier 2 = observations for judgment. Same interaction language as the
// frame navigator: a toolbar button with a dropdown report.

const KIND_KEY: Record<Finding['kind'], string> = {
  'residual-edge': 'diag.residual',
  'shadow-reference': 'diag.shadow',
  'blind-pool-breach': 'diag.breach',
  'pool-asymmetry': 'diag.asym',
  'long-chain': 'diag.longChain',
  'open-branches': 'diag.openBranches',
  'collider-continuation': 'diag.collider',
  'orphan-materials': 'diag.orphans',
  'load-bearing': 'diag.loadBearing',
};

export default function DiagnosticsPanel({ onLocate, openPing = 0, showTrigger = true }: {
  onLocate: (id: string) => void;
  /** Bump to run diagnostics and open the panel from outside (menu entry). */
  openPing?: number;
  /** false = panel only; the trigger lives elsewhere (the ⋯ menu). */
  showTrigger?: boolean;
}) {
  const deleteEdges = useStore((s) => s.deleteEdges);
  const t = useT();
  const [requestedOpen, setOpen] = useState(false);
  const open = useCanvasToolCard('diagnostics', requestedOpen, () => setOpen(false));
  const panelPosition = useCanvasPanelPosition(open, 'right');
  const [findings, setFindings] = useState<Finding[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) panelRef.current?.focus({ preventScroll: true }); }, [open]);

  // external open signal (adjust-during-render, same pattern as ModelPicker)
  const [pingSeen, setPingSeen] = useState(openPing);

  useDismissableLayer({ dismissOnFocusOutside: true, open, refs: [ref], onDismiss: () => setOpen(false) });

  const run = () => {
    const { nodes, edges } = useStore.getState();
    setFindings(runDiagnostics(nodes, edges));
    setOpen(true);
  };
  if (openPing !== pingSeen) {
    setPingSeen(openPing);
    run();
  }

  const fix = (f: Finding) => {
    deleteEdges(f.edgeIds);
    const { nodes, edges } = useStore.getState();
    setFindings(runDiagnostics(nodes, edges));
  };

  const tier1 = findings.filter((f) => f.tier === 1);
  const tier2 = findings.filter((f) => f.tier === 2);

  const row = (f: Finding, i: number) => (
    <div key={`${f.kind}-${i}`} className="px-3 py-2 border-b border-line/50 last:border-0 flex items-start gap-2">
      <span className={`w-1.5 h-1.5 shape-circle mt-1.5 shrink-0 ${f.tier === 1 ? 'bg-red-400' : 'bg-amber-400'}`} />
      <span className="text-control text-ink-muted flex-1 min-w-0">
        {fmt(t(KIND_KEY[f.kind] as Parameters<typeof t>[0]), f.params)}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {f.nodeIds.length > 0 && (
          <button
            onClick={() => onLocate(f.nodeIds[0])}
            title={t('diag.locate')}
            aria-label={t('diag.locate')}
            className="w-6 h-6 rounded-control text-ink-faint hover:text-accent hover:bg-wash flex items-center justify-center transition-colors"
          >
            <Crosshair size={13} strokeWidth={1.75} />
          </button>
        )}
        {f.fixable && (
          <button
            onClick={() => fix(f)}
            title={t('diag.fix')}
            aria-label={t('diag.fix')}
            className="w-6 h-6 rounded-control flex items-center justify-center transition-colors object-action-danger" data-icon-only
          >
            <Trash2 size={13} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div ref={ref} className="relative">
      {showTrigger && (
        <button
          onClick={() => (open ? setOpen(false) : run())}
          className={`bg-card border rounded-control w-8 h-8 flex items-center justify-center transition-colors ${
            open ? 'border-accent/40 text-accent' : 'border-line text-ink-faint hover:bg-wash'
          }`}
          title={t('toolbar.diagnose')}
          aria-label={t('toolbar.diagnose')}
        >
          <Stethoscope size={15} strokeWidth={1.75} />
        </button>
      )}
      {open && (
        <div ref={panelRef} tabIndex={-1} className="canvas-tool-panel canvas-tool-menu py-1" style={panelPosition} data-diagnostics-panel>
          <div className="px-3 py-1.5 text-title font-semibold text-ink-muted border-b border-line">
            {t('diag.title')}
            <span className="text-meta text-ink-faint font-normal ml-2">
              {findings.length === 0 ? '' : fmt(t('diag.summary'), { a: tier1.length, b: tier2.length })}
            </span>
          </div>
          {findings.length === 0 && (
            <p className="px-3 py-3 text-control text-ink-faint italic">{t('diag.clean')}</p>
          )}
          {tier1.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-control font-semibold text-red-500">{t('diag.tier1')}</p>
              {tier1.map(row)}
            </>
          )}
          {tier2.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-control font-semibold text-amber-600">{t('diag.tier2')}</p>
              {tier2.map(row)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
