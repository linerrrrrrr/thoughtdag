import { useRef } from 'react';
import type { Attachment, ThoughtData } from '../../types';
import { Check, Pencil, Send, X } from 'lucide-react';
import { useStore } from '../../store';
import { isImeComposing } from '../../utils';
import { useT } from '../../i18n';
import { isViewerMode } from '../../lib/viewer';
import { toast, useUiStore } from '../../lib/ui-store';
import { useDraftModelUnavailable } from '../../lib/use-models';
import SearchToggles from '../ui/SearchToggles';
import NodeExecutionPicker from '../ui/NodeExecutionPicker';
import { Markdown } from '../Markdown';
import { useInlineEditDismiss } from '../../lib/use-inline-edit-dismiss';
import { useSessionDraft } from '../../lib/use-session-draft';
import { condenseGuard } from '../../lib/condense-guard';
import { clipboardFilePaste } from '../../lib/clipboard-files';
import { importNodeFiles, nodeFilesPending, useNodeFilesPending } from '../../lib/node-file-import';
import QuestionAttachments, { QuestionFilePicker, SentQuestionAttachments } from '../QuestionAttachments';

const isConversationResizeTarget = (target: EventTarget | null) => target instanceof Element
  && !!target.closest('[data-conversation-divider]');

export default function QuestionSection({
  nodeId,
  question,
  displayQuestion,
  attachments,
  highlights,
  penActive,
  isEditing,
  isHuman,
  awaiting,
  executionDraft,
  generationFailed,
  placeholder,
  base,
}: {
  nodeId: string;
  base?: string;
  question: string;
  /** Reading only; the editor retains the complete canonical question. */
  displayQuestion?: string;
  attachments?: Attachment[];
  highlights: Set<string>;
  penActive: boolean;
  isEditing: boolean;
  /** Paradigm human turn: edits record the question without generating. */
  isHuman?: boolean;
  /** Node accepts its own question: the box stays open before a successful answer
      (same rule as the canvas card) and click-away keeps the draft. */
  awaiting?: boolean;
  executionDraft?: Partial<ThoughtData>;
  /** A failed attempt may explicitly resend the same question. */
  generationFailed?: boolean;
  placeholder?: string;
}) {
  const editQuestion = useStore((s) => s.editQuestion);
  const submitHumanTurn = useStore((s) => s.submitHumanTurn);
  const setEditing = useStore((s) => s.setEditing);
  const t = useT();
  const filesPending = useNodeFilesPending(nodeId);
  const modelUnavailable = useDraftModelUnavailable(executionDraft);

  const draftKey = `question-edit:${nodeId}`;
  const [editValue, setEditValue] = useSessionDraft(draftKey, question);
  const showEditor = (isEditing || awaiting) && !isViewerMode;
  const editorRef = useRef<HTMLDivElement>(null);
  const cancelEdit = () => { useUiStore.getState().setDraft(draftKey, ''); setEditing(nodeId, false); };
  const dismiss = useInlineEditDismiss({
    active: isEditing,
    ref: editorRef,
    onOutside: () => setEditing(nodeId, false),
    onCancel: () => {
      if (!awaiting) { cancelEdit(); return; }
      setEditing(nodeId, false);
      if (document.activeElement instanceof HTMLElement && editorRef.current?.contains(document.activeElement)) document.activeElement.blur();
    },
    restoreFocus: awaiting ? false : undefined,
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
    setEditing(nodeId, true, 'panel');
  };

  const handleEditSubmit = () => {
    if (!editValue.trim() || modelUnavailable || nodeFilesPending(nodeId) || condenseGuard()) return;
    useUiStore.getState().setDraft(draftKey, '');
    // Only a failed attempt may resend an unchanged question.
    if (!generationFailed && editValue.trim() === question) { setEditing(nodeId, false); return; }
    if (isHuman) submitHumanTurn(nodeId, editValue.trim());
    else editQuestion(nodeId, editValue.trim());
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || isImeComposing(e)) return;
    e.preventDefault();
    handleEditSubmit();
  };

  const autoGrowTa = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(480, el.scrollHeight)}px`;
  };

  return (
    <section className={`focus-question-section ${showEditor ? 'is-editing' : ''}`} aria-label={t('panel.question')} data-conversation-question>
      {showEditor ? (
        <div ref={editorRef} onBlur={dismiss.onBlur} className="focus-message-editor"
          onFocusCapture={() => { if (awaiting && !isEditing) setEditing(nodeId, true, 'panel'); }}>
          <div className="question-composer-content">
            <QuestionAttachments nodeId={nodeId} />
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onPaste={(event) => {
                const { files, preventText } = clipboardFilePaste(event.clipboardData);
                if (!files.length) return;
                if (preventText) event.preventDefault();
                void importNodeFiles(nodeId, files);
              }}
              onKeyDown={handleEditKeyDown}
              onInput={(e) => autoGrowTa(e.currentTarget)}
              ref={autoGrowTa}
              placeholder={placeholder}
              aria-label={t('panel.question')}
              className="w-full bg-wash border border-accent rounded-control p-3 text-body text-ink resize-none focus:outline-none focus:ring-2 focus:ring-accent/20"
              rows={3}
              autoFocus={isEditing}
            />
          </div>
          {awaiting && !isHuman && <div className="mt-2"><NodeExecutionPicker nodeId={nodeId} /></div>}
          {(awaiting || isHuman) && (
            <div className="flex items-center justify-end gap-2 mt-1.5">
              {awaiting && !isHuman && <div className="mr-auto flex items-center gap-1" data-ask-toggles>
                <QuestionFilePicker onAttach={files => void importNodeFiles(nodeId, files)} />
                <SearchToggles nodeId={generationFailed ? nodeId : undefined} executionNodeId={nodeId} size={15} />
              </div>}
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={handleEditSubmit}
                disabled={!editValue.trim() || filesPending || modelUnavailable} data-question-send
                className="text-control bg-action hover:bg-action-strong disabled:opacity-30 when-unavailable text-white px-3.5 py-1.5 rounded-control transition-colors flex items-center gap-1.5">
                {isHuman ? <Check size={12} strokeWidth={2.25} /> : <Send size={14} strokeWidth={1.75} />}
                {t(isHuman ? 'common.confirm' : 'common.send')}
              </button>
            </div>
          )}
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
                disabled={!editValue.trim() || filesPending}
                className="text-control bg-action hover:bg-action-strong disabled:opacity-30 when-unavailable text-white px-3.5 py-1.5 rounded-control transition-colors flex items-center gap-1.5"
                data-edit-submit
              >
                <Check size={12} strokeWidth={2.25} /> {t('question.editSubmit')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="focus-user-turn">
        <SentQuestionAttachments nodeId={nodeId} files={attachments} />
        <div
          onDoubleClick={penActive ? undefined : handleDoubleClickQuestion}
          data-highlight-turn="question" data-highlighter-active={penActive || undefined}
          data-cursor="text" className="focus-user-message question-md markdown-body text-body text-ink"
          data-conversation-user-message
        >
          <Markdown base={base} preserveListNumbers highlights={highlights}>{(displayQuestion ?? question) || placeholder || ''}</Markdown>
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
