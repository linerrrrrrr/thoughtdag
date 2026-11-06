import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Controls } from '@xyflow/react';

/** Keep the library's controls and names, without its native hover windows. */
export default function CanvasControls({ children }: { children?: ReactNode }) {
  const boundary = useRef<HTMLDivElement>(null);
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
  return <div ref={boundary} className="contents"><Controls position="bottom-left" />{children}</div>;
}
