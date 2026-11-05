import { useRef, useState } from 'react';
import { UserCog } from 'lucide-react';
import { useStore } from '../../store';
import { isImeComposing } from '../../utils';
import { useT } from '../../i18n';
import RoleTemplateChips from '../ui/RoleTemplateChips';
import { useUiStore } from '../../lib/ui-store';
import { useInlineEditDismiss } from '../../lib/use-inline-edit-dismiss';

// The role editor, as a full-width strip under the panel's header (the
// kicker line is too narrow for a text box and a row of presets: there the
// chips stacked into a column). A role is this node's system prompt and its
// descendants'; "clear" hands the node back to whatever it inherits.
export default function RoleEditor({ nodeId, initial, inherited, hasOwn, onClose }: { nodeId: string; initial: string; inherited: boolean; hasOwn: boolean; onClose: () => void }) {
  const setRolePrompt = useStore((s) => s.setRolePrompt);
  const t = useT();
  const draftKey = `role-edit:${nodeId}`;
  const editorRef = useRef<HTMLDivElement>(null);
  const [value, setValueState] = useState(() => useUiStore.getState().drafts[draftKey] ?? initial);
  const setValue = (value: string) => { setValueState(value); useUiStore.getState().setDraft(draftKey, value, true); };
  const cancel = () => { useUiStore.getState().setDraft(draftKey, ''); onClose(); };
  const save = () => { setRolePrompt(nodeId, value.trim()); cancel(); };
  const clear = () => { setRolePrompt(nodeId, ''); cancel(); };
  const dismiss = useInlineEditDismiss({ active: true, ref: editorRef, onOutside: onClose, onCancel: cancel });
  return (
    <div ref={editorRef} onBlur={dismiss.onBlur} className="px-4 py-3 border-b border-line/70 bg-wash/50 shrink-0 space-y-1.5" data-role-editor>
      <div className="flex items-center gap-1.5 text-control text-ink-faint">
        <UserCog size={12} strokeWidth={1.75} className="shrink-0" />
        <span className="font-medium text-ink-muted">{t('role.editorTitle')}</span>
        {inherited && <span className="bg-line/50 px-1.5 py-px rounded-tag">{t('role.inheritedPrefilled')}</span>}
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isImeComposing(e)) { e.preventDefault(); save(); }
        }}
        placeholder={t('role.placeholder')}
        className="w-full text-body border border-line rounded-control px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent bg-card text-ink resize-y min-h-[64px]"
        rows={3}
        autoFocus
        data-role-editor-text
      />
      <RoleTemplateChips onPick={(p) => setValue(p)} />
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-control text-ink-faint">{t('role.scopeHint')}</span>
        <div className="flex items-center gap-2 shrink-0">
          {hasOwn && <button onClick={clear} className="text-control text-ink-muted hover:text-red-500 px-2.5 py-1 rounded-control hover:bg-line/40 transition-colors" data-role-editor-clear>{t('role.clear')}</button>}
          <button onClick={cancel} className="text-control text-ink-muted hover:text-ink px-2.5 py-1 rounded-control hover:bg-line/40 transition-colors">{t('common.cancel')}</button>
          <button onClick={save} className="text-control bg-action hover:bg-action-strong text-white px-3 py-1 rounded-control transition-colors" data-role-editor-save>{t('common.save')}</button>
        </div>
      </div>
      <p className="text-control text-ink-faint">{t('edit.draftHint')}</p>
    </div>
  );
}
