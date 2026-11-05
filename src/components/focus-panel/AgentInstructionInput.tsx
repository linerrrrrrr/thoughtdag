import { useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { canSteerAgentNode, steerAgentNode } from '../../lib/agents/agent-runtime';
import { isImeComposing } from '../../utils';
import { fmt, useT } from '../../i18n';

/** An explicit control for the current run, never a next-turn composer. */
export default function AgentInstructionInput({ nodeId, open, position, triggerRef, onClose }: {
  nodeId: string;
  open: boolean;
  position: { right: number; top: number };
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  const draftKey = `agent-instruction:${nodeId}`;
  const draft = useUiStore(s => s.drafts[draftKey] ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const cancel = () => {
    useUiStore.getState().setDraft(draftKey, '');
    setError('');
    onClose();
  };
  useDismissableLayer({
    open, refs: [editorRef], restoreFocusRef: triggerRef, dismissOnFocusOutside: true,
    onDismiss: reason => { if (reason === 'escape') cancel(); else onClose(); },
  });

  const send = async () => {
    if (sending || !draft.trim() || !canSteerAgentNode(nodeId)) return;
    const submitted = draft;
    setSending(true);
    setError('');
    try {
      await steerAgentNode(nodeId, submitted);
      // An acknowledgement must not clear text typed while it was pending.
      if (useUiStore.getState().drafts[draftKey] === submitted) {
        useUiStore.getState().setDraft(draftKey, '');
        onClose();
      }
    } catch (failure) {
      setError(fmt(t('agent.actionFailed'), { message: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div ref={editorRef} className="agent-instruction" style={position} role="dialog" aria-label={t('agent.addInstructions')} data-agent-instruction>
      <div className="agent-instruction-title">{t('agent.addInstructions')}</div>
      <textarea
        autoFocus value={draft} rows={3} data-agent-instruction-input
        aria-label={t('agent.addInstructions')} placeholder={t('agent.addInstructionsHint')}
        onChange={event => { useUiStore.getState().setDraft(draftKey, event.target.value, true); setError(''); }}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !isImeComposing(event)) {
            event.preventDefault();
            void send();
          }
        }}
      />
      {error && <p className="agent-instruction-error" role="alert">{error}</p>}
      <div className="agent-instruction-actions">
        <button type="button" onClick={cancel}>{t('common.cancel')}</button>
        <button type="button" className="agent-instruction-send" data-agent-instruction-send
          disabled={sending || !draft.trim() || !canSteerAgentNode(nodeId)} onClick={() => void send()}>
          <ArrowUp size={14} strokeWidth={1.75} />{t('common.send')}
        </button>
      </div>
    </div>, document.body,
  );
}
