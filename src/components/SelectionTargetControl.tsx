import { ChevronDown, MousePointer2, Spline } from 'lucide-react';
import { useCanvasEditing } from '../lib/canvas-editing';
import { useStore } from '../store';
import { useT } from '../i18n';

/** A persistent canvas setting; switching is immediate and reversible. */
export default function SelectionTargetControl() {
  const t = useT();
  const target = useCanvasEditing(state => state.selectionTarget);
  const choose = (value: 'nodes' | 'edges') => {
    if (target === value) return;
    const state = useStore.getState();
    const region = useCanvasEditing.getState().selectionRegion;
    const nodes = new Set(state.selectedNodeIds);
    const edges = state.edges.filter(edge => edge.selected);
    useCanvasEditing.getState().setSelectionTarget(value);
    if (region) {
      const nodeIds = value === 'nodes' ? region.nodeIds.filter(id => state.nodes.some(node => node.id === id && !node.hidden && node.selectable !== false)) : [];
      const edgeIds = new Set(value === 'edges' ? region.edgeIds : []);
      useStore.setState({
        selectedNodeIds: nodeIds,
        selectedNodeId: nodeIds.length === 1 ? nodeIds[0] : null,
        nodes: state.nodes.map(node => ({ ...node, selected: nodeIds.includes(node.id) })),
        edges: state.edges.map(edge => ({ ...edge, selected: edgeIds.has(edge.id) && !edge.hidden && edge.selectable !== false })),
      });
      return;
    }
    if (value === 'edges') {
      state.setSelectedNodeIds([]);
      useStore.setState({ edges: state.edges.map(edge => ({ ...edge, selected: !edge.hidden && edge.selectable !== false && (edges.includes(edge) || nodes.has(edge.source) && nodes.has(edge.target)) })) });
    } else {
      useStore.setState({ edges: state.edges.map(edge => ({ ...edge, selected: false })) });
      state.setSelectedNodeIds([...new Set([...nodes, ...edges.flatMap(edge => [edge.source, edge.target])])]);
    }
  };
  const ActiveIcon = target === 'nodes' ? MousePointer2 : Spline;
  return <div className="canvas-selection-control" role="group" aria-label={t('selection.target')} data-selection-target-control>
      <div className="canvas-selection-segments">
      {(['nodes', 'edges'] as const).map(value => {
        const Icon = value === 'nodes' ? MousePointer2 : Spline;
        return <button key={value} type="button" data-selection-target={value} aria-pressed={target === value}
          aria-label={t(value === 'nodes' ? 'selection.nodes' : 'selection.edges')} title={`${t('selection.target')} · ${t(value === 'nodes' ? 'selection.nodes' : 'selection.edges')}`}
          className="canvas-toolbar-button"
          onClick={() => choose(value)}><Icon size={16} strokeWidth={1.75} className="canvas-selection-icon" aria-hidden="true" /><span className="canvas-toolbar-label">{t(value === 'nodes' ? 'selection.nodes' : 'selection.edges')}</span></button>;
      })}
      </div>
      <div className="canvas-selection-picker relative h-8 items-center text-accent">
        <ActiveIcon size={14} className="pointer-events-none absolute left-2" aria-hidden="true" />
        <select value={target} onChange={event => choose(event.target.value as 'nodes' | 'edges')}
          aria-label={t('selection.target')} title={`${t('selection.target')} · ${t(target === 'nodes' ? 'selection.nodes' : 'selection.edges')}`}
          className="h-8 appearance-none rounded-control bg-wash pl-7 pr-6 text-control focus-visible:outline-2 focus-visible:outline-accent"
          data-selection-target-picker>
          <option value="nodes">{t('selection.nodes')}</option>
          <option value="edges">{t('selection.edges')}</option>
        </select>
        <ChevronDown size={12} className="pointer-events-none absolute right-1.5" aria-hidden="true" />
      </div>
    </div>;
}
