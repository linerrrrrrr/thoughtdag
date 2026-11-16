import { KeyRound, SquareTerminal } from 'lucide-react';
import { useT } from '../../i18n';
import { useUiStore } from '../../lib/ui-store';
import { useCanvasToolCards } from '../../lib/use-canvas-tool-card';
import CanvasToolbarOverflowAction from '../CanvasToolbarOverflowAction';

/** Agent execution and API credentials have separate entry points and pages. */
export default function ConnectionEntries() {
  const t = useT();
  const requestedOpen = useUiStore(state => state.apiKeyModalOpen);
  const section = useUiStore(state => state.apiKeyModalSection);
  const setOpen = useUiStore(state => state.setApiKeyModalOpen);
  const activeCard = useCanvasToolCards(state => state.active?.name);
  return <>{(['agents', 'providers'] as const).map(kind => {
    const agent = kind === 'agents';
    const label = t(agent ? 'connection.agent' : 'connection.api');
    const Icon = agent ? SquareTerminal : KeyRound;
    const active = requestedOpen && activeCard === 'connection' && (agent ? section === 'agents' : section !== 'agents');
    return <CanvasToolbarOverflowAction key={kind} label={label} icon={<Icon size={14} strokeWidth={1.75} />}>
      <button type="button" className="canvas-toolbar-button canvas-toolbar-icon"
        data-connection-entry={kind} aria-label={label} aria-expanded={active}
        data-tooltip={label} data-tooltip-icon-only onClick={() => setOpen(!active, kind)}>
        <Icon size={16} strokeWidth={1.75} />
        <span className="canvas-toolbar-label">{label}</span>
      </button>
    </CanvasToolbarOverflowAction>;
  })}</>;
}
