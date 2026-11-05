import { useT } from '../../i18n';
import { IN_HARNESS_FRAME } from '../../lib/embedded';
import { useUiStore } from '../../lib/ui-store';
import CanvasToolbarOverflowAction from '../CanvasToolbarOverflowAction';
import { MessageSquare } from 'lucide-react';

// The 对话 | 思维图 switch, as the canvas shows it while it runs inside the
// harness: one control in the canvas's own top bar, right after the canvas
// chip, so it shares the bar's row and never lands on the toolbar at any
// width (the floating pill the harness shows over its chat hides while the
// canvas is up). 思维图 is where we are; 对话 asks the shim to close the
// overlay. Renders nothing outside the harness build.

export default function HarnessViewSwitch() {
  const t = useT();
  // the desktop host's title band carries this switch itself; the canvas shows its own only in a browser tab
  const hostBar = useUiStore((st) => !!st.harnessHost?.bar);
  // the host's sidebar carries the ThoughtDAG entry and its own way back (any session): no switch here
  const hostPanel = useUiStore((st) => !!st.harnessHost?.panel);
  if (!IN_HARNESS_FRAME || hostBar || hostPanel) return null;
  const close = () => window.parent.postMessage({ source: 'dsh-thoughtdag', type: 'td:close' }, window.location.origin);
  return (
    <div className="canvas-toolbar-minimal-secondary bg-card border border-line rounded-control h-8 p-0.5 flex items-center" role="group" aria-label="view switch" data-harness-view-switch>
      <CanvasToolbarOverflowAction label={t('harness.viewChat')} icon={<MessageSquare size={14} />}>
      <button
        type="button"
        onClick={close}
        className="h-full px-3 rounded-tag text-xs font-semibold text-ink-muted hover:bg-wash hover:text-ink transition-colors whitespace-nowrap"
        data-view="dialog"
        aria-pressed={false}
      >
        {t('harness.viewChat')}
      </button>
      </CanvasToolbarOverflowAction>
      <button
        type="button"
        className="h-full px-3 rounded-tag text-xs font-semibold bg-ink text-card whitespace-nowrap cursor-default"
        data-view="map"
        aria-pressed={true}
      >
        {t('harness.viewMap')}
      </button>
    </div>
  );
}
