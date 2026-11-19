import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleDashed, Loader2, RefreshCw, SquareTerminal } from 'lucide-react';
import { useT, fmt } from '../../i18n';
import { availableExecutionModels, ensureAgentsFresh, recheckAgents, useModels } from '../../lib/use-models';
import { canRetryAgentHost } from '../../lib/agents/host';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import AgentCwdChip from './AgentCwdChip';
import AgentPermissionChip from './AgentPermissionChip';
import '../ConversationSurface.css';
import './AgentConnectionSection.css';

/** Connection discovery never starts a model turn or changes canvas permissions. */
export default function AgentConnectionSection() {
  const t = useT();
  const data = useModels();
  const available = !!window.desktopAgents;
  const models = availableExecutionModels(data, 'codex');
  const status = data?.runtimes?.codex;
  const [checking, setChecking] = useState(true);
  const pending = checking || !!data?.agentsPending;
  const connected = models.length > 0;
  const [setting, setSetting] = useState<'cwd' | 'approvals'>('cwd');
  const [settingOpen, setSettingOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const cwdTriggerRef = useRef<HTMLButtonElement>(null);
  const approvalsTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let open = true;
    void ensureAgentsFresh().finally(() => { if (open) setChecking(false); });
    return () => { open = false; };
  }, []);
  const reconnect = () => {
    setChecking(true);
    void recheckAgents().finally(() => setChecking(false));
  };
  // Keep both triggers inside one boundary so collapsing a menu cannot move
  // the other trigger between pointerdown and click.
  useDismissableLayer({
    open: connected && settingOpen,
    refs: [settingsRef],
    dismissOnFocusOutside: true,
    restoreFocusRef: setting === 'cwd' ? cwdTriggerRef : approvalsTriggerRef,
    onDismiss: () => setSettingOpen(false),
  });
  const showSetting = (next: typeof setting, open: boolean) => {
    setSetting(next);
    setSettingOpen(open);
  };

  return <div className="agent-connection" data-agent-connection-page>
    <div className="agent-connection-overview">
      <div className="agent-connection-runtime">
        <SquareTerminal size={20} strokeWidth={1.75} className="text-ink-muted shrink-0" aria-hidden="true" />
        <p className="text-title font-semibold text-ink">Codex</p>
        <button type="button" disabled={!canRetryAgentHost() || pending} onClick={reconnect} data-agent-connect
          aria-label={t(connected ? 'model.recheck' : 'connection.connect')}
          data-tooltip={t(connected ? 'model.recheck' : 'connection.connect')}
          data-tooltip-icon-only={connected || pending || undefined}
          className={`agent-connection-action ${connected || pending ? 'agent-connection-action-icon' : ''}`}>
          {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}
          {!connected && !pending && <span>{t('connection.connect')}</span>}
        </button>
      </div>
      <div className="agent-connection-status text-control" role="status"
        data-agent-connection-status={pending ? 'pending' : connected ? 'connected' : 'disconnected'}>
        {pending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          : connected ? <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
            : <CircleDashed size={14} strokeWidth={1.75} aria-hidden="true" />}
        <span>{t(pending ? 'connection.checking' : connected ? 'connection.ready' : 'connection.disconnected')}</span>
        {connected && !pending && <span className="agent-connection-model-count text-meta">{fmt(t('connection.modelCount'), { n: models.length })}</span>}
      </div>
      {!connected && <p className="agent-connection-message text-control text-ink-muted">
        {pending ? t('connection.agentIntro') : !available
          ? t(canRetryAgentHost() ? 'connection.agentHostUnavailable' : 'connection.agentHostRequired')
          : status?.error || t('connection.agentUnavailable')}
      </p>}
    </div>
    {connected && <div ref={settingsRef} className="agent-connection-settings" data-agent-connection-settings>
      <AgentCwdChip open={settingOpen && setting === 'cwd'} onOpenChange={open => showSetting('cwd', open)} triggerRef={cwdTriggerRef} />
      <AgentPermissionChip open={settingOpen && setting === 'approvals'} onOpenChange={open => showSetting('approvals', open)} triggerRef={approvalsTriggerRef} />
    </div>}
  </div>;
}
