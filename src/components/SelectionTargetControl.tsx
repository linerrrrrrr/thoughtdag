import { MousePointer2, Spline } from 'lucide-react';
import { useCanvasEditing } from '../lib/canvas-editing';
import { useStore } from '../store';
import { useT } from '../i18n';

/** A persistent canvas setting; switching is immediate and reversible. */
export default function SelectionTargetControl() {
  const t = useT();
  const target = useCanvasEditing(state => state.selectionTarget);
  return <div className="flex h-8 items-center gap-2 text-xs whitespace-nowrap" role="group" aria-label={t('selection.target')} data-selection-target-control>
      <span className="pl-1 text-ink-muted cursor-default">{t('selection.target')}</span>
      <div className="flex h-8 items-center gap-1 rounded-control bg-wash px-0.5">
      {(['nodes', 'edges'] as const).map(value => {
        const Icon = value === 'nodes' ? MousePointer2 : Spline;
        return <button key={value} type="button" data-selection-target={value} aria-pressed={target === value}
          className={`flex h-7 items-center gap-1.5 rounded-control px-2 focus-visible:outline-2 focus-visible:outline-accent ${target === value ? 'bg-card text-accent' : 'text-ink-muted hover:text-ink'}`}
          onClick={() => {
            if (target === value) return;
            const state = useStore.getState();
            const nodes = new Set(state.selectedNodeIds);
            const edges = state.edges.filter(edge => edge.selected);
            useCanvasEditing.getState().setSelectionTarget(value);
            if (value === 'edges') {
              state.setSelectedNodeIds([]);
              useStore.setState({ edges: state.edges.map(edge => ({ ...edge, selected: !edge.hidden && edge.selectable !== false && (edges.includes(edge) || nodes.has(edge.source) && nodes.has(edge.target)) })) });
            } else {
              useStore.setState({ edges: state.edges.map(edge => ({ ...edge, selected: false })) });
              state.setSelectedNodeIds([...new Set([...nodes, ...edges.flatMap(edge => [edge.source, edge.target])])]);
            }
          }}><Icon size={14} aria-hidden="true" />{t(value === 'nodes' ? 'selection.nodes' : 'selection.edges')}</button>;
      })}
      </div>
    </div>;
}
