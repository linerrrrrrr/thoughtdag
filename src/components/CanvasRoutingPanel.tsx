import { useRef } from 'react';
import { X } from 'lucide-react';
import { useT } from '../i18n';
import { handleCanvasPanelKeyDown } from '../lib/canvas-shortcuts';
import { useCanvasPanelPosition } from '../lib/use-canvas-panel-position';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { restoreCanvasToolbarFocus } from '../lib/use-responsive-canvas-header';
import EdgeRoutingControls from './EdgeRoutingControls';
import './CanvasLayoutPanel.css';

export default function CanvasRoutingPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const panelPosition = useCanvasPanelPosition();
  useDismissableLayer({ open: true, refs: [panel], onDismiss: reason => {
    onClose();
    if (reason === 'escape') restoreCanvasToolbarFocus(document.querySelector('[data-routing-entry]'));
  }, dismissOnOutside: false, restoreFocus: false });

  return <div ref={panel} style={panelPosition} className="canvas-tool-panel canvas-layout-panel nodrag nopan nowheel"
    role="dialog" aria-labelledby="canvas-routing-title" data-canvas-routing-panel onKeyDown={handleCanvasPanelKeyDown}>
    <div className="canvas-layout-header flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-line">
      <h2 id="canvas-routing-title" className="text-title font-semibold">{t('edgeRouting.title')}</h2>
      <button type="button" onClick={onClose} className="flex h-7 w-7 -mr-1 items-center justify-center rounded-control text-ink-muted hover:bg-wash hover:text-ink transition-colors focus-visible:outline-2 focus-visible:outline-accent" aria-label={t('common.close')}><X size={16} /></button>
    </div>
    <EdgeRoutingControls />
  </div>;
}
