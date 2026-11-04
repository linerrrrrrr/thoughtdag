import { BookOpen } from 'lucide-react';
import { useUiStore } from '../lib/ui-store';
import { useT } from '../i18n';
import { useProjects } from '../store/projects';
import { handleDismissableLayerKeyDown } from '../lib/use-dismissable-layer';

/** Reading a node never changes the canvas selection or its format draft. */
export default function NodeDetailsButton({ nodeId, label = false, className = '' }: { nodeId: string; label?: boolean; className?: string }) {
  const t = useT();
  const active = useUiStore((state) => state.panelOpen && state.panelNodeId === nodeId);
  const isParadigm = useProjects((state) => state.projects.find((project) => project.id === state.activeId)?.kind === 'paradigm');
  if (isParadigm) return null;
  return <button type="button" data-node-details={nodeId} aria-pressed={active}
    aria-label={t('ctx.openPanel')} title={t('ctx.openPanel')}
    onPointerDown={(event) => event.stopPropagation()}
    onMouseDown={(event) => event.stopPropagation()}
    onFocus={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') handleDismissableLayerKeyDown(event.nativeEvent);
    }}
    onDoubleClick={(event) => event.stopPropagation()}
    onClick={(event) => { event.stopPropagation(); useUiStore.getState().setPanelOpen(true, nodeId); }}
    className={`nodrag nopan inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent ${label ? 'min-h-8 px-2' : 'w-7 h-7'} ${active ? 'text-accent bg-accent/10' : 'text-ink-muted hover:text-accent hover:bg-wash'} ${className}`}>
    <BookOpen size={14} strokeWidth={1.75} />{label && t('ctx.openPanel')}
  </button>;
}
