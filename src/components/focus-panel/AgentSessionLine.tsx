import { FolderOpen, SquareTerminal, Pin } from 'lucide-react';
import { useT } from '../../i18n';
import { useProjects, setProjectAgentCwd } from '../../store/projects';
import { toast } from '../../lib/ui-store';
import type { ThoughtData } from '../../types';

// Where an agent turn ran, kept in view: the runtime, the working directory,
// whether the turn continued a session. The directory is a fact of the turn
// and is not edited here; one click makes it the canvas's working directory
// for the next turns (then regenerate, if that is the intent), one opens it.

const RUNTIME_LABEL: Record<string, string> = { pi: 'Pi', dsh: 'DeepSeek Harness', 'claude-code': 'Claude Code', codex: 'Codex' };

export default function AgentSessionLine({ data }: { data: ThoughtData }) {
  const t = useT();
  const activeId = useProjects((s) => s.activeId);
  const chosen = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.agentCwd);
  const runner = data.agentSession?.runtime ?? data.importSource?.runner;
  const cwd = data.agentSession?.cwd ?? data.importSource?.cwd ?? null;
  if (!runner || !cwd) return null;
  const sessionId = data.agentSession?.sessionId ?? data.importSource?.sessionId ?? null;
  // the pin is offered only when this directory is not already the canvas's:
  // neither the chosen one nor the canvas's own workspace by default
  const isOwnWorkspace = !chosen && !!activeId && cwd.endsWith(`/workspaces/${activeId}`);
  const canPin = !!window.desktopAgents && !!activeId && chosen !== cwd && !isOwnWorkspace;
  const short = cwd.split('/').filter(Boolean).slice(-2).join('/');

  return (
    <div className="rounded-content border border-line bg-card px-3 py-2 flex items-center gap-2 text-control min-w-0" data-agent-session-line>
      <span className="text-control font-medium text-ink-muted bg-wash rounded-tag px-1.5 py-0.5 shrink-0">{RUNTIME_LABEL[runner] ?? runner}</span>
      {data.agentSession?.effort && <span className="text-meta font-mono text-ink-faint shrink-0"  data-agent-session-effort>{data.agentSession.effort}</span>}
      <FolderOpen size={13} strokeWidth={1.75} className="text-ink-faint shrink-0" />
      <span className="font-mono text-ink-muted truncate flex-1 min-w-0" data-tooltip={cwd} data-agent-session-cwd={cwd}>{short}</span>
      {data.agentSession?.continued && <span className="text-control text-ink-faint shrink-0" >↩ {t('agent.continued')}</span>}
      {window.desktopLocal && (
        <button onClick={() => void window.desktopLocal!.open(cwd)} className="text-ink-faint hover:text-accent shrink-0" data-tooltip={t('agent.openDir')} aria-label={t('agent.openDir')}>
          <FolderOpen size={14} strokeWidth={1.75} />
        </button>
      )}
      {sessionId && window.desktopSessions && (
        <button onClick={() => void window.desktopSessions!.openInCli(runner, cwd, sessionId, 'terminal')} className="text-ink-faint hover:text-accent shrink-0" data-tooltip={t('agent.openInTerminal')} aria-label={t('agent.openInTerminal')}>
          <SquareTerminal size={14} strokeWidth={1.75} />
        </button>
      )}
      {canPin && (
        <button
          onClick={() => { void setProjectAgentCwd(activeId!, cwd).then(() => toast('success', t('agent.useAsCwdDone'), 4000)); }}
          className="text-ink-faint hover:text-accent shrink-0"
          data-tooltip={t('agent.useAsCwd')}
          aria-label={t('agent.useAsCwd')}
          data-agent-session-pin
        >
          <Pin size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
