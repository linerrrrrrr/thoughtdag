import { Paperclip, UserCog } from 'lucide-react';
import { useT } from '../../i18n';
import { isViewerMode } from '../../lib/viewer';
import type { ThoughtData } from '../../types';

// Inspection metadata: role, tokens and materials share one quiet line
// after the conversation. The narrow role model: a rolePrompt on a node is the system
// prompt for it and everything downstream (nearest ancestor wins). Clicking
// the role text asks the panel to open the editor (RoleEditor, a full-width
// strip beside the role line) on ANY node: on the node that set it, the text is
// its own; elsewhere the inherited text comes prefilled and saving gives
// this node a role of its own (the "inherited" tag goes). Machine-step
// personas don't use this at all; they live in prompt text.

export default function RoleLine({
  data,
  inheritedRole,
  onEdit,
}: {
  data: ThoughtData;
  inheritedRole: string;
  /** open the editor with this text */
  onEdit: (initial: string) => void;
}) {
  const t = useT();
  const own = data.rolePrompt;
  const effective = own || inheritedRole;
  const attachCount = (data.attachments || []).length;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 text-control text-ink-faint min-w-0 h-8">
        <UserCog size={13} strokeWidth={1.75} className="shrink-0" />
        {effective ? (
          isViewerMode ? (
            <span className="text-warm/90 truncate max-w-[45%] shrink-0" data-tooltip={effective} data-tooltip-overflow>{effective}</span>
          ) : (
            <button
              onClick={() => onEdit(own ?? effective)}
              className="text-warm hover:underline decoration-dotted underline-offset-2 truncate font-medium max-w-[45%] shrink-0"
              data-tooltip={effective}
              data-tooltip-overflow
              aria-label={`${t('role.edit')} · ${effective}`}
              data-role-line-edit
            >
              {effective}
            </button>
          )
        ) : !isViewerMode ? (
          <button
            onClick={() => onEdit('')}
            className="hover:text-warm transition-colors shrink-0"
            data-role-line-set
          >
            + {t('role.set')}
          </button>
        ) : (
          <span className="italic shrink-0">{t('role.noRoleSet')}</span>
        )}
        {!own && effective && (
          <span className="text-control bg-line/50 px-1.5 py-px rounded-tag shrink-0">{t('role.inherited')}</span>
        )}
        <span className="shrink-0">·</span>
        <span className="shrink-0 text-ink-muted">{data.tokenCount} tokens</span>
        {attachCount > 0 && (
          <>
            <span className="shrink-0">·</span>
            <span className="shrink-0 text-ink-muted flex items-center gap-0.5">
              <Paperclip size={11} strokeWidth={1.75} /> {attachCount}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
