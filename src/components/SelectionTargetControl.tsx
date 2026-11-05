import { useRef } from 'react';
import { useCanvasEditing } from '../lib/canvas-editing';
import { partitionSpatialSelection, type SelectionRegion, type SelectionTarget } from '../lib/canvas-selection';
import { useSelectionToolbarPosition } from '../lib/use-selection-toolbar-position';
import { useStore } from '../store';
import { useT, fmt } from '../i18n';

/** A confirmed marquee owns its object-type choice, including an empty active type. */
export default function SelectionTargetControl({ region }: { region: SelectionRegion }) {
  const t = useT();
  const target = useCanvasEditing(state => state.selectionTarget);
  const nodes = useStore(state => state.nodes);
  const edges = useStore(state => state.edges);
  const { nodeIds, frameIds } = partitionSpatialSelection(nodes, [...region.nodeIds, ...region.frameIds]);
  const edgeIds = region.edgeIds.filter(id => edges.some(edge => edge.id === id && !edge.hidden && edge.selectable !== false));
  const ref = useRef<HTMLDivElement>(null);
  const visible = nodeIds.length + edgeIds.length + frameIds.length > 0;
  const style = useSelectionToolbarPosition(ref, visible);
  const choose = (value: SelectionTarget) => {
    useCanvasEditing.getState().requestProperties();
    if (target === value) return;
    useCanvasEditing.getState().setSelectionTarget(value);
    const selectedNodes = value === 'nodes' ? nodeIds : value === 'frames' ? frameIds : [];
    const selectedEdges = new Set(value === 'edges' ? edgeIds : []);
    useStore.setState(state => ({
      selectedNodeIds: selectedNodes,
      selectedNodeId: selectedNodes.length === 1 ? selectedNodes[0] : null,
      nodes: state.nodes.map(node => ({ ...node, selected: selectedNodes.includes(node.id) })),
      edges: state.edges.map(edge => ({ ...edge, selected: selectedEdges.has(edge.id) })),
    }));
  };
  if (!visible) return null;
  return <div ref={ref} className="canvas-toolbar selection-target-toolbar nodrag nopan nowheel"
    role="group" aria-label={t('selection.target')} data-selection-target-control data-selection-target-docked
    style={style} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}>
    {(['nodes', 'edges', 'frames'] as const).map(value => {
      const count = value === 'nodes' ? nodeIds.length : value === 'frames' ? frameIds.length : edgeIds.length;
      return <button key={value} type="button" className="canvas-toolbar-button"
        data-selection-target={value} aria-pressed={target === value}
        aria-label={fmt(t(value === 'nodes' ? 'selection.nodeCandidates' : value === 'frames' ? 'selection.frameCandidates' : 'selection.edgeCandidates'), { n: count })}
        onClick={() => choose(value)}>
        <span>{t(value === 'nodes' ? 'selection.nodes' : value === 'frames' ? 'selection.frames' : 'selection.edges')}</span>
        <span className="tabular-nums" aria-hidden="true">{count}</span>
      </button>;
    })}
  </div>;
}
