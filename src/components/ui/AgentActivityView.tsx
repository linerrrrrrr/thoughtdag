import { memo, useEffect, useRef, useState } from 'react';
import { Activity, Brain, Check, ChevronDown, ChevronRight, CirclePause, FileDiff, ListTodo, Loader2, MessageSquare, SquareTerminal, Wrench, X } from 'lucide-react';
import type { AgentActivityEntry } from '../../types';
import { fmt, useT } from '../../i18n';
import { Markdown } from '../Markdown';
import { ConversationLink } from '../ConversationLink';
import './AgentActivityView.css';

// The ordered runtime transcript is a reading surface, separate from the
// answer used as context. Finished runs keep their process behind a disclosure.
export function AgentActivityView({ entries, running = false, compact = false, base, failed: runFailed = false }: {
  entries: AgentActivityEntry[]; running?: boolean; compact?: boolean; base?: string; failed?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [following, setFollowing] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const open = expanded ?? running;
  const shown = running ? entries : entries.filter((entry) => entry.kind !== 'message');
  const instructions = shown.filter(entry => entry.kind === 'user');
  const current = [...entries].reverse().find((entry) => entry.status === 'running');
  const latestNote = [...entries].reverse().find((entry) => (entry.kind === 'commentary' || entry.kind === 'reasoning') && entry.text);
  const turn = entries.find((entry) => entry.sourceType === 'turn');
  const hasAnswer = entries.some((entry) => entry.kind === 'message' && entry.status === 'completed' && entry.text);
  // A recovered command failure is not a failed conversation. Older imported
  // transcripts may omit turn lifecycle events but still carry a final answer.
  const failed = runFailed || (turn ? turn.status === 'failed' : !hasAnswer && entries.some((entry) => entry.status === 'failed'));
  const interrupted = turn ? turn.status === 'interrupted' : !hasAnswer && entries.some((entry) => entry.status === 'interrupted');
  const timed = entries.filter((entry) => entry.startedAt > 0);
  const elapsedMs = timed.length ? timed.reduce((end, entry) => Math.max(end, entry.endedAt ?? entry.startedAt), 0) - timed.reduce((start, entry) => Math.min(start, entry.startedAt), Infinity) : 0;
  const label = running
    ? current?.kind === 'command' ? t('activity.executing') : current?.kind === 'reasoning' ? t('activity.thinking') : t('activity.working')
    : failed ? t('activity.failed') : interrupted ? t('activity.interrupted') : t('activity.completed');

  useEffect(() => {
    const el = scrollRef.current;
    if (el && running && open && followRef.current) el.scrollTop = el.scrollHeight;
  }, [entries, running, open]);

  if (!shown.length) return null;
  return (
    <section className="agent-activity nopan nodrag nowheel min-w-0" data-agent-activity data-running={running || undefined}>
      <button type="button" className="activity-heading" aria-expanded={open} data-activity-history onClick={(event) => { event.stopPropagation(); setExpanded(!open); }}>
        {running ? <Loader2 size={14} className="activity-spinner text-accent shrink-0" /> : <Activity size={14} className="shrink-0" />}
        <span>{label}</span>
        {!running && elapsedMs > 0 && <span className="text-meta text-ink-faint font-normal tabular-nums">{(elapsedMs / 1000).toFixed(elapsedMs < 10000 ? 1 : 0)} s</span>}
        <span className="text-meta text-ink-faint font-normal tabular-nums">{fmt(t('activity.events'), { count: shown.length })}</span>
        {open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />}
      </button>
      {!open && running && latestNote?.text && <p className="activity-preview">{preview(latestNote.text)}</p>}
      {!open && instructions.length > 0 && <ol className="activity-list" role="log" aria-live="off" data-activity-user-summary>
        {instructions.map(entry => <ActivityRow key={entry.id} entry={entry} compact={compact} base={base} />)}
      </ol>}
      {open && <div ref={scrollRef} className={`activity-scroll ${compact ? 'activity-scroll-compact' : ''}`}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          followRef.current = atBottom;
          setFollowing(atBottom);
        }}>
        <ol className="activity-list" role="log" aria-live="off">
          {shown.map((entry) => <ActivityRow key={entry.id} entry={entry} compact={compact} base={base} />)}
        </ol>
        {running && !current && <div className="activity-between" role="status"><Loader2 size={12} className="activity-spinner" />{t('activity.thinking')}</div>}
      </div>}
      {running && open && !following && <button type="button" className="activity-follow" onClick={(event) => {
        event.stopPropagation(); followRef.current = true; setFollowing(true);
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }}><ChevronDown size={12} />{t('activity.follow')}</button>}
    </section>
  );
}

function preview(value: string): string {
  const line = value.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return line.length > 180 ? `${line.slice(0, 180)}…` : line;
}

function formatDetails(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2) ?? ''; } catch { return String(value); }
}

const ActivityRow = memo(function ActivityRow({ entry, compact, base }: { entry: AgentActivityEntry; compact: boolean; base?: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const isRunning = entry.status === 'running';
  const isText = entry.kind === 'commentary' || entry.kind === 'message' || entry.kind === 'user';
  const open = expanded ?? (isRunning && entry.kind !== 'reasoning');
  const Icon = entry.kind === 'command' ? SquareTerminal : entry.kind === 'reasoning' ? Brain : entry.kind === 'plan' ? ListTodo : entry.kind === 'file' ? FileDiff : entry.kind === 'commentary' || entry.kind === 'message' ? MessageSquare : entry.kind === 'tool' ? Wrench : Activity;
  const title = entry.title || (entry.sourceType === 'turn' ? t('activity.turn') : entry.sourceType === 'thread/tokenUsage/updated' ? t('activity.usage') : entry.sourceType === 'thread/status/changed' ? t('activity.session') : entry.sourceType === 'contextCompaction' ? t('activity.compaction') : entry.sourceType === 'autoApprovalReview' ? t('activity.review') : entry.kind === 'reasoning' ? t('activity.reasoning') : entry.kind === 'command' ? t('activity.command') : entry.kind === 'file' ? t('activity.file') : entry.kind === 'plan' ? t('activity.plan') : entry.kind === 'tool' ? t('activity.tool') : t('activity.event'));
  const status = isRunning ? t('activity.running') : entry.status === 'failed' ? t('activity.failed') : entry.status === 'interrupted' ? t('activity.interrupted') : t('activity.done');
  const details = entry.details == null ? '' : formatDetails(entry.details);
  const hasBody = !!(entry.text || entry.output || entry.command || details);

  return (
    <li className={`activity-row activity-${entry.kind}`} data-activity-id={entry.id} data-activity-kind={entry.kind} data-activity-status={entry.status}>
      <div className="activity-marker"><Icon size={14} strokeWidth={1.75} /></div>
      <div className="min-w-0 flex-1">
        {isText ? <div className={`markdown-body ${entry.kind === 'user' ? 'activity-user-message' : entry.kind === 'message' ? 'activity-answer' : 'activity-commentary'}`}>
          <Markdown base={base} diagrams={compact ? 'placeholder' : undefined}>{entry.text || (isRunning ? t('activity.working') : '')}</Markdown>
        </div> : <>
          <button type="button" className="activity-item-heading" aria-expanded={open} disabled={!hasBody} onClick={(event) => { event.stopPropagation(); setExpanded(!open); }}>
            <span className="activity-item-title">{title}</span>
            <span className={`activity-status ${entry.status === 'failed' ? 'text-red-600' : 'text-ink-faint'}`}>
              {isRunning ? <Loader2 size={12} className="activity-spinner" /> : entry.status === 'completed' ? <Check size={12} /> : entry.status === 'interrupted' ? <CirclePause size={12} /> : <X size={12} />}
              <span>{status}</span>
            </span>
            {hasBody && (open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />)}
          </button>
          {!open && entry.text && <p className="activity-preview">{preview(entry.text)}</p>}
          {!open && entry.command && <code className="activity-command-preview">{entry.command}</code>}
          {open && <div className="activity-body">
            {entry.text && <div className="activity-text markdown-body"><Markdown base={base} diagrams={compact ? 'placeholder' : undefined}>{entry.text}</Markdown></div>}
            {entry.command && <pre className="activity-command-text"><code>{entry.command}</code></pre>}
            {entry.cwd && <div className="activity-meta"><span>{t('activity.cwd')}</span><code>{entry.cwd}</code></div>}
            {entry.output !== undefined && <TerminalOutput output={entry.output} running={isRunning} />}
            {(entry.exitCode != null || entry.durationMs != null) && <div className="activity-meta tabular-nums">
              {entry.exitCode != null && <span>{t('activity.exitCode')} {entry.exitCode}</span>}
              {entry.durationMs != null && <span>{(entry.durationMs / 1000).toFixed(1)} s</span>}
            </div>}
            <StructuredDetails entry={entry} base={base} />
            {details && <details className="activity-details"><summary>{t('activity.details')}</summary><pre tabIndex={0}>{details}</pre></details>}
          </div>}
        </>}
        {entry.truncated && <p className="activity-truncated">{t('activity.truncated')}</p>}
      </div>
    </li>
  );
});

function StructuredDetails({ entry, base }: { entry: AgentActivityEntry; base?: string }) {
  const t = useT();
  if (!entry.details || typeof entry.details !== 'object') return null;
  const detail = entry.details as { plan?: { step?: string; status?: string }[]; changes?: { path?: string; diff?: string; kind?: { type?: string } | string }[] };
  if (entry.kind === 'plan' && Array.isArray(detail.plan)) return <ol className="activity-plan">
    {detail.plan.map((step, index) => <li key={index}>
      {step.status === 'completed' ? <Check size={13} /> : step.status === 'inProgress' || step.status === 'in_progress' ? <Loader2 size={13} className="activity-spinner" /> : <span className="activity-plan-pending" />}
      <span className="text-body">{step.step}</span><span className="text-ink-faint text-meta">{step.status === 'completed' ? t('activity.done') : step.status === 'inProgress' || step.status === 'in_progress' ? t('activity.running') : t('activity.pending')}</span>
    </li>)}
  </ol>;
  if (entry.kind === 'file' && Array.isArray(detail.changes)) return <div className="activity-files">
    {detail.changes.map((change, index) => <details key={`${change.path}:${index}`}>
      <summary><span className="activity-file-path markdown-body"><ConversationLink href={change.path} base={base}>{change.path}</ConversationLink></span></summary>
      {typeof change.diff === 'string' && <pre className="activity-diff" tabIndex={0}>{change.diff.split('\n').map((line, lineIndex) => <span key={lineIndex} className={line.startsWith('+') ? 'activity-diff-add' : line.startsWith('-') ? 'activity-diff-remove' : undefined}>{line}{'\n'}</span>)}</pre>}
    </details>)}
  </div>;
  return null;
}

function TerminalOutput({ output, running }: { output: string; running: boolean }) {
  const t = useT();
  const ref = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (ref.current && following.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [output]);
  return <pre ref={ref} className="activity-output" data-activity-output tabIndex={0} aria-label={t('activity.output')} onScroll={() => {
    const el = ref.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  }}><code>{output || (running ? t('activity.waitingOutput') : t('activity.noOutput'))}</code></pre>;
}
