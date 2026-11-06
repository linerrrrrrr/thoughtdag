import { useRef, useState } from 'react';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { Archive, ArchiveRestore, ClipboardCopy, Files, Ellipsis, FileDown, GitFork, MessageSquarePlus, RefreshCw, Split, Square, Trash2, Undo2 } from 'lucide-react';
import { useStore } from '../../store';
import { contextChainMarkdown, downloadMarkdown, copyText } from '../../lib/export';
import ModelPicker from '../ui/ModelPicker';
import FanOutModal from '../FanOutModal';
import { toast } from '../../lib/ui-store';
import { useT } from '../../i18n';
import { canSteerAgentNode, deriveFollowupModel, isAgentModel } from '../../lib/agents/agent-runtime';
import { useUiStore } from '../../lib/ui-store';
import AgentInstructionInput from './AgentInstructionInput';

// The reading header keeps the model and menu; answer actions live below the prose.

export default function HeaderActions({ nodeId, isLoading }: { nodeId: string; isLoading: boolean }) {
  const regenerate = useStore((s) => s.regenerate);
  const rerunNode = useStore((s) => s.rerunNode);
  const stopGeneration = useStore((s) => s.stopGeneration);
  const duplicateNode = useStore((s) => s.duplicateNode);
  const deleteNode = useStore((s) => s.deleteNode);
  const setNodeModel = useStore((s) => s.setNodeModel);
  const nodeModel = useStore((s) => s.nodes.find((n) => n.id === nodeId)?.data.model);
  const nodeData = useStore(s => s.nodes.find(n => n.id === nodeId)?.data);
  const globalModel = useUiStore(s => s.selectedModel);
  const agent = isAgentModel(deriveFollowupModel(nodeData, globalModel) ?? globalModel);
  const setArchived = useStore((s) => s.setArchived);
  const isArchived = useStore((s) => !!s.nodes.find((n) => n.id === nodeId)?.data.archived);
  const nodeQuestion = useStore((s) => s.nodes.find((n) => n.id === nodeId)?.data.question ?? '');
  // fine tier of recoverability: a mirror node that drifted from its
  // frozen source snapshot can be put back — text only, never structure
  const diverged = useStore((s) => {
    const n = s.nodes.find((x) => x.id === nodeId);
    return !!n?.data.source && (n.data.question !== n.data.source.question || n.data.response !== n.data.source.response);
  });
  const t = useT();

  const revertToSource = () => {
    const s = useStore.getState();
    const node = s.nodes.find((x) => x.id === nodeId);
    if (!node?.data.source) return;
    s.pushHistory();
    useStore.setState((st) => ({
      nodes: st.nodes.map((n) => (n.id === nodeId
        ? { ...n, data: { ...n.data, question: n.data.source!.question, response: n.data.source!.response } } : n)),
    }));
    s.pushHistory();
    toast('success', t('panel.reverted'));
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [fanOutOpen, setFanOutOpen] = useState(false);
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [instructionPosition, setInstructionPosition] = useState({ right: 16, top: 80 });
  const [previousLoading, setPreviousLoading] = useState(isLoading);
  if (previousLoading !== isLoading) {
    setPreviousLoading(isLoading);
    if (!isLoading) setInstructionOpen(false);
  }
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const canSteer = isLoading && canSteerAgentNode(nodeId);

  const openInstructions = () => {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (rect) setInstructionPosition({ right: Math.max(16, window.innerWidth - rect.right), top: rect.bottom + 8 });
    setMenuOpen(false);
    setInstructionOpen(true);
  };

  useDismissableLayer({ dismissOnFocusOutside: true, open: menuOpen, refs: [menuRef], onDismiss: () => setMenuOpen(false) });

  const iconBtn = 'text-ink-faint hover:text-ink hover:bg-line/50 rounded-control w-8 h-8 flex items-center justify-center transition-colors';
  const menuItem = 'w-full text-left px-3 py-2 text-control text-ink-muted hover:bg-wash transition-colors flex items-center gap-2';

  return (
    <div className="focus-panel-header-actions relative flex items-center gap-1 shrink-0">
      {isLoading && (
        <button
          onClick={() => stopGeneration(nodeId)}
          data-agent-stop
          aria-label={t('actions.stop')}
          className="text-white bg-red-500 hover:bg-red-600 rounded-control w-8 h-8 flex items-center justify-center transition-colors"
        >
          <Square size={12} strokeWidth={1.75} fill="currentColor" />
        </button>
      )}
      {!agent && <ModelPicker compact value={nodeModel} onChange={(m) => setNodeModel(nodeId, m)} />}

      <div ref={menuRef} className="relative">
        <button ref={menuButtonRef} onClick={() => setMenuOpen((v) => !v)} aria-label={t('panel.more')} aria-expanded={menuOpen} className={`${iconBtn} ${menuOpen ? 'bg-line/50 text-ink' : ''}`}>
          <Ellipsis size={17} strokeWidth={1.75} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 bg-card border border-line rounded-overlay shadow-lg py-1 w-[210px] z-30 animate-fade-in">
            {canSteer && <button className={menuItem} data-agent-instruction-trigger onClick={openInstructions}>
              <MessageSquarePlus size={15} strokeWidth={1.75} /> {t('agent.addInstructions')}
            </button>}
            <button className={menuItem} disabled={isLoading} onClick={() => { setMenuOpen(false); void rerunNode(nodeId, {}); }}>
              <RefreshCw size={15} strokeWidth={1.75} /> {t('common.regenerate')}
            </button>
            <button className={menuItem} onClick={() => { setMenuOpen(false); setArchived([nodeId], !isArchived); }}>
              {isArchived ? <ArchiveRestore size={15} strokeWidth={1.75} /> : <Archive size={15} strokeWidth={1.75} />}
              {t(isArchived ? 'archive.restoreTitle' : 'archive.title')}
            </button>
            <button className={menuItem} onClick={() => { setMenuOpen(false); setFanOutOpen(true); }} >
              <Split size={15} strokeWidth={1.75} /> {t('fanout.entry')}
            </button>
            <button className={menuItem} onClick={() => { setMenuOpen(false); void regenerate(nodeId); }} >
              <GitFork size={15} strokeWidth={1.75} /> {t('actions.regenBranch')}
            </button>
            <button className={menuItem} onClick={() => { setMenuOpen(false); duplicateNode(nodeId); }}>
              <Files size={15} strokeWidth={1.75} /> {t('common.duplicate')}
            </button>
            <button className={menuItem} onClick={() => { setMenuOpen(false); downloadMarkdown(contextChainMarkdown(nodeId)); }} data-tooltip={t('actions.exportTitle')}>
              <FileDown size={15} strokeWidth={1.75} /> {t('common.export')}
            </button>
            <button className={menuItem} onClick={() => { setMenuOpen(false); void copyText(contextChainMarkdown(nodeId)); }} data-tooltip={t('actions.copyTitle')}>
              <ClipboardCopy size={15} strokeWidth={1.75} /> {t('actions.copyMd')}
            </button>
            {diverged && (
              <button className={menuItem} onClick={() => { setMenuOpen(false); revertToSource(); }} data-revert-source>
                <Undo2 size={15} strokeWidth={1.75} /> {t('panel.revertToSource')}
              </button>
            )}
            <div className="border-t border-line my-1" />
            <button
              className="w-full text-left px-3 py-2 text-control object-action-danger transition-colors flex items-center gap-2"
              onClick={() => { setMenuOpen(false); deleteNode(nodeId); }}
            >
              <Trash2 size={15} strokeWidth={1.75} /> {t('common.delete')}
            </button>
          </div>
        )}
      </div>

      {fanOutOpen && (
        <FanOutModal parentId={nodeId} initialQuestion={nodeQuestion} onClose={() => setFanOutOpen(false)} />
      )}
      <AgentInstructionInput nodeId={nodeId} open={instructionOpen && canSteer} position={instructionPosition}
        triggerRef={menuButtonRef} onClose={() => setInstructionOpen(false)} />
    </div>
  );
}
