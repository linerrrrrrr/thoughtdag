import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ControlButton, Controls, useStore as useFlowStore } from '@xyflow/react';
import { Hand } from 'lucide-react';
import { useT } from '../i18n';

interface CanvasControlsProps {
  children?: ReactNode;
  leftDragPans: boolean;
  onTogglePan: () => void;
}

/** Keep the library's controls and names, without its native hover windows. */
export default function CanvasControls({ children, leftDragPans, onTogglePan }: CanvasControlsProps) {
  const boundary = useRef<HTMLDivElement>(null);
  const t = useT();
  const panLabel = t('canvas.panWithLeftButton');
  const interactionLocked = useFlowStore(s => !(s.nodesDraggable || s.nodesConnectable || s.elementsSelectable));
  useLayoutEffect(() => {
    // The built-in lock swaps its glyph but does not expose its toggle state.
    boundary.current?.querySelector('.react-flow__controls-interactive')
      ?.setAttribute('aria-pressed', String(interactionLocked));
  }, [interactionLocked]);
  useLayoutEffect(() => {
    const root = boundary.current;
    if (!root) return;
    const syncLabels = () => {
      root.querySelectorAll<HTMLButtonElement>('.react-flow__controls-button').forEach(button => {
        const label = button.getAttribute('aria-label');
        if (label && button.matches('.react-flow__controls-fitview, .react-flow__controls-interactive')) {
          if (button.dataset.tooltip !== label) button.dataset.tooltip = label;
        }
        button.removeAttribute('title');
      });
      root.querySelectorAll<SVGSVGElement>('.react-flow__minimap-svg').forEach(svg => {
        const title = svg.querySelector('title');
        if (!title?.textContent) return;
        svg.setAttribute('aria-label', title.textContent);
        svg.removeAttribute('aria-labelledby');
        title.textContent = '';
      });
    };
    syncLabels();
    // Observe only library chrome, including label changes after switching
    // languages. No document-wide title rewriting or pointer-time restoration.
    const observer = new MutationObserver(syncLabels);
    observer.observe(root, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['title', 'aria-label', 'aria-labelledby'] });
    return () => observer.disconnect();
  }, []);
  return <div ref={boundary} className="contents" data-canvas-controls data-type-surface="canvas-controls">
    <Controls position="bottom-left">
      <ControlButton className="react-flow__controls-pan" aria-label={panLabel} data-tooltip={panLabel}
        aria-pressed={leftDragPans} onClick={onTogglePan}>
        <Hand size={16} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
      </ControlButton>
    </Controls>
    {children}
  </div>;
}
