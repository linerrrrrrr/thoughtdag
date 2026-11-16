import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, FilePenLine, Shield, SquareTerminal } from 'lucide-react';
import { useT } from '../../i18n';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import type { QuestionAnswer } from '../../lib/api';
import type { ApprovalOutcome, ApprovalRequest } from '../../types';
import './CodexApprovalCard.css';

/** The native request's identity, prompt, details and split approval action,
 *  adapted to the conversation surface without changing the runtime decision. */
export function CodexApprovalCard({ request, busy, onAnswer }: {
  request: ApprovalRequest;
  busy: boolean;
  onAnswer: (answer: QuestionAnswer, outcome: ApprovalOutcome) => void;
}) {
  const t = useT();
  const scopeId = useId();
  const scopeRef = useRef<HTMLDivElement>(null);
  const scopeTriggerRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLPreElement>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const isCommand = request.name === 'command needs approval';
  const isFile = request.name === 'file change needs approval';
  const isPermission = request.name === 'more permissions requested';
  const Icon = isCommand ? SquareTerminal : isFile ? FilePenLine : Shield;
  const identity = isCommand ? t('approval.codexTerminal') : isFile ? t('approval.codexFiles') : isPermission ? t('approval.codexPermissions') : t('approval.codexAction');
  const prompt = isCommand ? t('approval.codexCommandPrompt') : isFile ? t('approval.codexFilesPrompt') : isPermission ? t('approval.codexPermissionsPrompt') : t('approval.codexOtherPrompt');
  const detail = request.query || '';

  useDismissableLayer({
    open: scopeOpen,
    refs: [scopeRef],
    dismissOnFocusOutside: true,
    restoreFocusRef: scopeTriggerRef,
    onDismiss: () => setScopeOpen(false),
  });
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || expanded) return;
    const measure = () => setCanExpand(preview.scrollHeight > preview.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    if (preview.parentElement) observer.observe(preview.parentElement);
    return () => observer.disconnect();
  }, [detail, expanded]);

  const choose = (answer: QuestionAnswer, outcome: ApprovalOutcome) => {
    setScopeOpen(false);
    onAnswer(answer, outcome);
  };
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <div className="codex-approval nopan" onClick={stop} onMouseDown={stop} onPointerDown={stop}
      data-approval-card={request.id} data-question-kind="confirm" data-codex-approval>
      <div className="codex-approval-heading" role="group" aria-label={identity}>
        <div className="codex-approval-identity"><Icon size={16} strokeWidth={1.75} aria-hidden="true" /> <span>{identity}</span></div>
        <div className="codex-approval-title">{prompt}</div>
        {request.reason && <div className="codex-approval-reason"><span>{t('approval.reason')}</span><p>{request.reason}</p></div>}
      </div>
      {detail && (
        <div className="codex-approval-preview">
          <pre ref={previewRef} data-expanded={expanded} data-approval-preview tabIndex={expanded ? 0 : undefined}>{detail}</pre>
          {(canExpand || expanded) && <button type="button" onClick={() => setExpanded(value => !value)} className="codex-approval-expand" aria-expanded={expanded} data-approval-expand>{t(expanded ? 'approval.codexCollapse' : 'approval.codexExpand')}</button>}
        </div>
      )}
      {request.arguments && request.arguments !== detail && (
        <details className="codex-approval-arguments"><summary>{t('approval.showArgs')}</summary><pre>{request.arguments}</pre></details>
      )}
      <div className="codex-approval-actions">
        <button type="button" className="codex-approval-deny" disabled={busy} onClick={() => choose({ confirmed: false }, 'rejected')} data-approval-reject>{t('approval.reject')}</button>
        <div ref={scopeRef} className="codex-approval-split">
          <button type="button" className="codex-approval-allow" disabled={busy} onClick={() => choose({ confirmed: true }, 'allowed-once')} data-approval-allow>{t('approval.allowOnce')}</button>
          {request.rule && <button ref={scopeTriggerRef} type="button" className="codex-approval-trigger" aria-label={t('approval.codexOptions')} aria-expanded={scopeOpen} disabled={busy} onClick={() => setScopeOpen(value => !value)} data-approval-options><ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" /></button>}
          {scopeOpen && request.rule && (
            <div className="codex-approval-menu" role="group" aria-label={t('approval.codexOptions')}>
              <button type="button" disabled={busy} onClick={() => choose({ confirmed: true }, 'allowed-once')}>{t('approval.allowOnce')}</button>
              <button type="button" disabled={busy} aria-describedby={scopeId} onClick={() => choose({ confirmed: true, scope: 'session' }, 'allowed-session')} data-approval-allow-session>
                <span>{t('approval.allowSession')}</span>
                <span id={scopeId} className="codex-approval-scope" data-approval-session-scope>{t(isFile ? 'approval.codexFileSessionScope' : 'approval.codexSessionScope')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {busy && <div className="codex-approval-status" role="status">{t('approval.sending')}</div>}
    </div>
  );
}
