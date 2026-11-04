import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useStore } from '../../store';
import { isImeComposing } from '../../utils';
import { useT } from '../../i18n';
import { isViewerMode } from '../../lib/viewer';
import { toast, useUiStore } from '../../lib/ui-store';
import SearchToggles from '../ui/SearchToggles';
import { Markdown } from '../Markdown';
import { useInlineEditDismiss } from '../../lib/use-inline-edit-dismiss';

export default function QuestionSection({
  nodeId,
  question,
  isEditing,
  isHuman,
  awaiting,
  placeholder,
  branchContext,
}: {
  nodeId: string;
  question: string;
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
    <div className="panel-card px-4 py-3">
      <label className="text-2xs font-semibold text-accent mb-1 block">{t('panel.question')}</label>
      {branchContext && (
        <div className="mb-2 text-xs pl-3 py-1.5 pr-2 border border-warm/30 bg-warm/10 rounded-content text-ink-muted italic leading-relaxed">
          “{branchContext.slice(0, 240)}{branchContext.length > 240 ? '…' : ''}”
        </div>
      )}
      {isEditing && !isViewerMode ? (
        <div ref={editorRef} onBlur={dismiss.onBlur}>
          <textarea
            value={editValue}
            onChange={(e) => { setEditValue(e.target.value); useUiStore.getState().setDraft(draftKey, e.target.value, true); }}
            onKeyDown={handleEditKeyDown}
            onInput={(e) => autoGrowTa(e.currentTarget)}
            ref={autoGrowTa}
            placeholder={placeholder}
            className="w-full bg-wash border border-accent rounded-control p-3 text-sm text-ink resize-none focus:outline-none focus:ring-2 focus:ring-accent/20"
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
                className="text-xs text-ink-muted hover:text-red-500 hover:bg-wash px-3 py-1.5 rounded-control transition-colors flex items-center gap-1"
                data-edit-cancel
              >
                <X size={12} strokeWidth={2} /> {t('question.editCancel')}
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleEditSubmit}
                disabled={!editValue.trim()}
                className="text-xs bg-action hover:bg-action-strong disabled:opacity-30 disabled:cursor-not-allowed text-white px-3.5 py-1.5 rounded-control transition-colors flex items-center gap-1.5"
                data-edit-submit
              >
                <Check size={12} strokeWidth={2.25} /> {t('question.editSubmit')}
              </button>
            </div>
          )}
          {!awaiting && <p className="mt-1.5 text-2xs text-ink-faint">{t('edit.draftHint')}</p>}
        </div>
      ) : (
        <div
          onDoubleClick={handleDoubleClickQuestion}
          className="question-md markdown-body text-sm text-ink font-semibold cursor-pointer hover:bg-wash rounded-content py-related transition-colors max-h-[240px] overflow-y-auto"
        >
          <Markdown>{question || placeholder || ''}</Markdown>
        </div>
      )}
    </div>
  );
}
