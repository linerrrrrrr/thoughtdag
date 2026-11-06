import { useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useStore } from '../../store';
import { isImeComposing } from '../../utils';
import { useT } from '../../i18n';
import { isViewerMode } from '../../lib/viewer';
import { toast, useUiStore } from '../../lib/ui-store';
import SearchToggles from '../ui/SearchToggles';
import { Markdown } from '../Markdown';
import { useInlineEditDismiss } from '../../lib/use-inline-edit-dismiss';

const isConversationResizeTarget = (target: EventTarget | null) => target instanceof Element
  && !!target.closest('[data-conversation-divider]');

export default function QuestionSection({
  nodeId,
  question,
  displayQuestion,
  isEditing,
  isHuman,
  awaiting,
  placeholder,
  branchContext,
  base,
}: {
  nodeId: string;
  base?: string;
  question: string;
  /** Reading only; the editor retains the complete canonical question. */
  displayQuestion?: string;
  isEditing: boolean;
  /** Paradigm human turn: edits record the question without generating. */
  isHuman?: boolean;
  /** Node still waits for its own question: the box is open from the start
      (same rule as the canvas card) and click-away keeps the draft. */
  awaiting?: boolean;
  placeholder?: string;
  branchContext?: string;
}) {
  const editQuestion = useStore((s) => s.editQuestion);
  const submitHumanTurn = useStore((s) => s.submitHumanTurn);
  const setEditing = useStore((s) => s.setEditing);
  const t = useT();

  const draftKey = `question-edit:${nodeId}`;
  const [editValue, setEditValue] = useState(() => useUiStore.getState().drafts[draftKey] ?? question);
  const editorRef = useRef<HTMLDivElement>(null);
  const cancelEdit = () => { useUiStore.getState().setDraft(draftKey, ''); setEditing(nodeId, false); };
  const dismiss = useInlineEditDismiss({
    active: isEditing && !awaiting,
    ref: editorRef,
    onOutside: () => setEditing(nodeId, false),
    onCancel: cancelEdit,
    ignoreOutside: event => isConversationResizeTarget(event.target),
    ignoreFocusOutside: isConversationResizeTarget,
  });

  const handleDoubleClickQuestion = () => {
    if (isViewerMode) return;
    // Editing mid-generation is ambiguous by design: stop first, then edit.
    if (useStore.getState().nodes.find((n) => n.id === nodeId)?.data.isLoading) {
      toast('info', t('question.lockedWhileGenerating'));
      return;
    }
    const draft = useUiStore.getState().drafts[draftKey] ?? question;
    setEditValue(draft);
    useUiStore.getState().setDraft(draftKey, draft, true);
    setEditing(nodeId, true, 'panel');
  };

  const handleEditSubmit = () => {
    if (!editValue.trim()) return;
    useUiStore.getState().setDraft(draftKey, '');
    // Unchanged question: close the editor, never regenerate
    if (editValue.trim() === question) { setEditing(nodeId, false); return; }
    if (isHuman) submitHumanTurn(nodeId, editValue.trim());
    else editQuestion(nodeId, editValue.trim());
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || isImeComposing(e)) return;
    // Same contract as the card editor: first-input surfaces keep
    // Enter-to-send; revision confirms explicitly (button or ⌘/Ctrl+Enter)
    // and Enter / Shift+Enter break the line.
    if (isHuman || awaiting) {
      if (!e.shiftKey) { e.preventDefault(); handleEditSubmit(); }
      return;
    }
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); handleEditSubmit(); }
  };

  const autoGrowTa = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(480, el.scrollHeight)}px`;
  };

  return (
    <section className={`focus-question-section ${isEditing ? 'is-editing' : ''}`} aria-label={t('panel.question')} data-conversation-question>
      {branchContext && (
        <div className="mb-2 text-control pl-3 py-1.5 pr-2 border border-warm/30 bg-warm/10 rounded-content text-ink-muted italic leading-relaxed">
          “{branchContext.slice(0, 240)}{branchContext.length > 240 ? '…' : ''}”
        </div>
      )}
      {isEditing && !isViewerMode ? (
        <div ref={editorRef} onBlur={dismiss.onBlur} className="focus-message-editor">
          <textarea
            value={editValue}
            onChange={(e) => { setEditValue(e.target.value); useUiStore.getState().setDraft(draftKey, e.target.value, true); }}
            onKeyDown={handleEditKeyDown}
            onInput={(e) => autoGrowTa(e.currentTarget)}
            ref={autoGrowTa}
            placeholder={placeholder}
            className="w-full bg-wash border border-accent rounded-control p-3 text-body text-ink resize-none focus:outline-none focus:ring-2 focus:ring-accent/20"
            rows={3}
            autoFocus
          />
          {!awaiting && !isHuman && (
            <div className="flex items-center justify-end gap-2 mt-1.5">
              {/* the node's own switches, what a re-ask runs with; mousedown defaulted away so the textarea keeps focus */}
              <div className="mr-auto flex items-center gap-1" onMouseDown={(e) => e.preventDefault()} data-edit-toggles>
                <SearchToggles nodeId={nodeId} size={15} />
              </div>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={cancelEdit}
                className="text-control text-ink-muted hover:text-red-500 hover:bg-wash px-3 py-1.5 rounded-control transition-colors flex items-center gap-1"
                data-edit-cancel
              >
                <X size={12} strokeWidth={2} /> {t('question.editCancel')}
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleEditSubmit}
                disabled={!editValue.trim()}
                className="text-control bg-action hover:bg-action-strong disabled:opacity-30 disabled:cursor-not-allowed text-white px-3.5 py-1.5 rounded-control transition-colors flex items-center gap-1.5"
                data-edit-submit
              >
                <Check size={12} strokeWidth={2.25} /> {t('question.editSubmit')}
              </button>
            </div>
          )}
          {!awaiting && <p className="mt-1.5 text-control text-ink-faint">{t('edit.draftHint')}</p>}
        </div>
      ) : (
        <div className="focus-user-turn">
        <div
          onDoubleClick={handleDoubleClickQuestion}
          className="focus-user-message question-md markdown-body text-body text-ink cursor-text"
          data-conversation-user-message
        >
          <Markdown base={base}>{(displayQuestion ?? question) || placeholder || ''}</Markdown>
        </div>
        {!isViewerMode && <button type="button" onClick={handleDoubleClickQuestion}
          aria-label={t('actions.editQuestion')} data-edit-question
          className="focus-question-edit">
          <Pencil size={14} strokeWidth={1.75} />
        </button>}
        </div>
      )}
    </section>
  );
}
