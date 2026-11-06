import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useStore } from '../store';
import { useT, fmt } from '../i18n';
import { useCanvasPanelPosition } from '../lib/use-canvas-panel-position';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { SelectionPanelContext, type SelectionDraftBoundary } from '../lib/selection-panel-context';
import { isFrameNode } from '../lib/frames';
import { isImeComposing } from '../utils';
import { handleCanvasPanelKeyDown } from '../lib/canvas-shortcuts';
import SelectionToolbar from './SelectionToolbar';
import ConnectionProperties from './ConnectionProperties';
import type { ViewportRectGetter } from './SelectionArrangeMenu';

/** Object kinds choose sections; cardinality never chooses another editor. */
export default function SelectionInspector({ getViewportRect, withDetails, onClose, onLocateNode }: {
  getViewportRect: ViewportRectGetter; withDetails: boolean; onClose: () => void; onLocateNode: (id: string) => void;
}) {
  const t = useT();
  const nodes = useStore(state => state.nodes);
  const selectedIds = useStore(state => state.selectedNodeIds);
  const edges = useStore(state => state.edges);
  const selected = nodes.filter(node => selectedIds.includes(node.id) && !node.hidden);
  const connections = edges.filter(edge => edge.selected && !edge.hidden);
  const frameCount = selected.filter(isFrameNode).length;
  const nodeCount = selected.length - frameCount;
  const signature = JSON.stringify([selected.map(node => node.id).sort(), connections.map(edge => edge.id).sort()]);
  const [collapse, setCollapse] = useState({ signature, collapsed: false });
  if (signature !== collapse.signature) setCollapse({ signature, collapsed: false });
  const ref = useRef<HTMLElement>(null);
  const [drafts] = useState(() => new Map<symbol, SelectionDraftBoundary>());
  const position = useCanvasPanelPosition();
  useDismissableLayer({ open: true, refs: [ref], dismissOnOutside: false, restoreFocus: false,
    onDismiss: () => {
      const dirty = [...drafts.values()].filter(boundary => boundary.dirty);
      if (dirty.length) dirty.forEach(boundary => boundary.cancel());
      else onClose();
    } });
  const summary = [nodeCount ? fmt(t('selection.nodesSelected'), { n: nodeCount }) : '',
    connections.length ? fmt(t('selection.edgesSelected'), { n: connections.length }) : '',
    frameCount ? fmt(t('selection.framesSelected'), { n: frameCount }) : ''].filter(Boolean).join(' · ');
  return <aside ref={ref} className="canvas-tool-panel flex flex-col" style={position}
    aria-label={t('selection.properties')} data-selection-properties data-selection-toolbar data-with-details={withDetails || undefined}
    data-edge-inspector={connections.length === 1 ? '' : undefined} data-batch-edge-inspector={connections.length > 1 ? '' : undefined}
    onKeyDown={handleCanvasPanelKeyDown}>
    <header className="flex items-start shrink-0 border-b border-line">
      <button type="button" className="min-w-0 flex-1 p-4 py-3 flex items-start gap-2 text-left hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent"
        aria-expanded={!collapse.collapsed} aria-label={t(collapse.collapsed ? 'format.expand' : 'format.collapse')}
        data-node-format-close={!collapse.collapsed ? '' : undefined} data-node-format-reopen={collapse.collapsed ? '' : undefined}
        onClick={() => setCollapse({ signature, collapsed: !collapse.collapsed })}
        onKeyDown={event => { if (isImeComposing(event) && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); }}>
        <span className="min-w-0 flex-1"><span className="block text-title font-semibold">{t('selection.properties')}</span>
          <span className="block mt-1 text-control text-ink-muted" data-selection-summary>{summary}</span></span>
        {collapse.collapsed ? <ChevronDown size={16} className="shrink-0 mt-1" /> : <ChevronUp size={16} className="shrink-0 mt-1" />}
      </button>
      <button type="button" className="edge-inspector-icon shrink-0 mr-2 mt-2" aria-label={t('common.close')}
        data-selection-properties-close onClick={onClose}><X size={17} /></button>
    </header>
    <SelectionPanelContext.Provider value={drafts}>
      <div className="min-h-0 overflow-y-auto overscroll-contain" hidden={collapse.collapsed} data-selection-properties-scroll>
        {selected.length > 0 && <SelectionToolbar getViewportRect={getViewportRect} withDetails={withDetails} />}
        {connections.length > 0 && <div className={selected.length ? 'border-t border-line' : undefined}>
          {selected.length > 0 && <h3 className="px-4 pt-3 text-title font-semibold">{fmt(t('selection.edgesSelected'), { n: connections.length })}</h3>}
          <ConnectionProperties selected={connections} onLocateNode={onLocateNode} />
        </div>}
      </div>
    </SelectionPanelContext.Provider>
  </aside>;
}
