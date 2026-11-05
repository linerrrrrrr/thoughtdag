import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, X } from 'lucide-react';
import { effectiveRoles, type EffectiveRole } from '../../lib/role-templates';
import { useUiStore } from '../../lib/ui-store';
import { generateId, isImeComposing } from '../../utils';
import { useI18n, useT } from '../../i18n';
import { useInlineEditDismiss } from '../../lib/use-inline-edit-dismiss';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';

// The role LIBRARY editor: add, edit and remove the reusable options shown
// as chips everywhere. Editing a built-in converts it into a custom copy
// (the bilingual original is hidden, restorable). This never touches roles
// already applied to nodes — those are plain text frozen on the node.

function Row({ role, onCommit, onRemove }: {
  role: EffectiveRole;
  onCommit: (role: EffectiveRole, name: string, prompt: string) => void;
  onRemove: (role: EffectiveRole) => void;
}) {
  const t = useT();
  const [name, setName] = useState(role.name);
  const [prompt, setPrompt] = useState(role.prompt);
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  const commit = () => { setEditing(false); onCommit(role, name.trim(), prompt.trim()); };
  const cancel = () => { setName(role.name); setPrompt(role.prompt); setEditing(false); };
  const edit = useInlineEditDismiss({ active: editing, ref: editRef, onOutside: commit, onCancel: cancel });
  return (
    <div
      ref={editRef}
      onBlur={edit.onBlur}
      onFocus={event => {
        if (!editing && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
          setName(role.name); setPrompt(role.prompt); setEditing(true);
        }
      }}
      className="border border-line rounded-content px-3 py-2.5 space-y-1.5 bg-surface"
      data-role-template={role.id}
    >
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setEditing(true); }}
          onKeyDown={event => { if (event.key === 'Enter' && !isImeComposing(event)) { event.preventDefault(); event.stopPropagation(); commit(); } }}
          placeholder={t('roles.namePlaceholder')}
          className="flex-1 text-control font-medium text-ink bg-transparent focus:outline-none placeholder-ink-faint"
        />
        {role.builtin && <span className="text-control text-ink-faint bg-wash px-1.5 py-0.5 rounded-tag shrink-0">{t('roles.builtin')}</span>}
        <button
          onClick={() => { setEditing(false); onRemove(role); }}
          aria-label={t('actions.deleteRole')}
          className="w-6 h-6 rounded-control flex items-center justify-center transition-colors shrink-0 object-action-danger" data-icon-only
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => { setPrompt(e.target.value); setEditing(true); }}
        placeholder={t('roles.promptPlaceholder')}
        rows={2}
        className="w-full text-body text-ink-muted bg-transparent focus:outline-none resize-y placeholder-ink-faint"
      />
    </div>
  );
}

export default function RoleManagerModal() {
  const open = useUiStore((s) => s.roleManagerOpen);
  const setOpen = useUiStore((s) => s.setRoleManagerOpen);
  const lib = useUiStore((s) => s.roleLib);
  const setLib = useUiStore((s) => s.setRoleLib);
  const lang = useI18n((s) => s.lang);
  const t = useT();
  const layerRef = useRef<HTMLDivElement>(null);
  useDismissableLayer({ open, refs: [layerRef], onDismiss: () => setOpen(false), modal: true });
  if (!open) return null;

  const roles = effectiveRoles(lang, lib);

  const commit = (role: EffectiveRole, name: string, prompt: string) => {
    if ((name === role.name && prompt === role.prompt) || (!name && !prompt)) return;
    if (role.builtin) {
      // editing a built-in = hide the bilingual original, keep a custom copy
      setLib({ hidden: [...lib.hidden, role.id], custom: [...lib.custom, { id: generateId(), name: name || role.name, prompt: prompt || role.prompt }] });
    } else {
      setLib({ ...lib, custom: lib.custom.map((c) => (c.id === role.id ? { ...c, name, prompt } : c)) });
    }
  };
  const remove = (role: EffectiveRole) => {
    if (role.builtin) setLib({ ...lib, hidden: [...lib.hidden, role.id] });
    else setLib({ ...lib, custom: lib.custom.filter((c) => c.id !== role.id) });
  };
  const add = () => setLib({ ...lib, custom: [...lib.custom, { id: generateId(), name: '', prompt: '' }] });

  return createPortal((
    <div className="fixed inset-0 z-[60] bg-ink/30 flex items-center justify-center p-6">
      <div ref={layerRef} role="dialog" aria-modal="true" aria-label={t('roles.managerTitle')} tabIndex={-1} className="bg-card rounded-panel shadow-lg border border-line w-[560px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-line shrink-0">
          <span className="text-section font-semibold text-ink">{t('roles.managerTitle')}</span>
          <span className="text-control text-ink-faint flex-1">{t('roles.hint')}</span>
          <button onClick={() => setOpen(false)} aria-label={t('common.close')} className="text-ink-faint hover:text-ink w-7 h-7 rounded-control hover:bg-wash flex items-center justify-center transition-colors shrink-0">
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-2">
          {roles.map((r) => <Row key={r.id} role={r} onCommit={commit} onRemove={remove} />)}
          {roles.length === 0 && <p className="text-control text-ink-faint italic py-2">{t('roles.empty')}</p>}
        </div>
        <div className="flex items-center gap-2 px-5 py-3 border-t border-line shrink-0">
          <button
            onClick={add}
            className="flex items-center gap-1.5 text-control text-accent hover:bg-accent/10 px-3 py-1.5 rounded-control transition-colors"
          >
            <Plus size={14} strokeWidth={1.75} /> {t('roles.add')}
          </button>
          <div className="flex-1" />
          {lib.hidden.length > 0 && (
            <button
              onClick={() => setLib({ ...lib, hidden: [] })}
              className="text-control text-ink-faint hover:text-ink-muted underline decoration-dotted transition-colors"
            >
              {t('roles.restore')}
            </button>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}
