import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useStore as useFlowStore } from '@xyflow/react';
import { useStore } from '../store';
import { useCanvasEditing } from '../lib/canvas-editing';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useT } from '../i18n';
import SelectionTargetControl from './SelectionTargetControl';
import { partitionSpatialSelection } from '../lib/canvas-selection';
import './SelectionResizeControls.css';

/** A confirmed marquee is a canvas selection, not a temporary popup. */
export default function SelectionRegion({ hasNodeSurface }: { hasNodeSurface: boolean }) {
  const region = useCanvasEditing(state => state.selectionRegion);
  const target = useCanvasEditing(state => state.selectionTarget);
  const nodes = useStore(state => state.nodes);
  const edges = useStore(state => state.edges);
  const selectedNodeIds = useStore(state => state.selectedNodeIds);
  const { x, y, zoom } = useViewport();
  const renderer = useFlowStore(state => state.domNode?.querySelector<HTMLElement>('.react-flow__renderer'));
  const ref = useRef<HTMLDivElement>(null);
  const geometry = useRef<{ region: typeof region; value: string } | null>(null);
  const t = useT();
  useEffect(() => {
    if (!region) return;
    // Geometry edits start a new spatial scope; content/draft edits do not.
    const value = JSON.stringify(nodes.map(node => [node.id, node.position.x, node.position.y, node.width, node.height]));
    const previous = geometry.current;
    geometry.current = { region, value };
    if (previous?.region === region && previous.value !== value) {
      useCanvasEditing.getState().setSelectionRegion(null);
      return;
    }
    const actual = target === 'edges' ? edges.filter(edge => edge.selected && !edge.hidden).map(edge => edge.id) : selectedNodeIds;
    const candidates = target === 'nodes' ? region.nodeIds : target === 'frames' ? region.frameIds : region.edgeIds;
    const spatial = partitionSpatialSelection(nodes, candidates);
    const expected = target === 'edges' ? candidates.filter(id => edges.some(edge => edge.id === id && !edge.hidden && edge.selectable !== false))
      : target === 'frames' ? spatial.frameIds : spatial.nodeIds;
    const oppositeSelected = target === 'edges' ? selectedNodeIds.length > 0 : edges.some(edge => edge.selected);
    if (oppositeSelected || candidates.length > 0 && expected.length === 0 || actual.length !== expected.length || actual.some(id => !expected.includes(id))) {
      useCanvasEditing.getState().setSelectionRegion(null);
    }
  }, [region, target, nodes, edges, selectedNodeIds]);
  useDismissableLayer({
    open: !!region, refs: [ref], priority: -100, restoreFocus: false, independentOutside: true,
    onDismiss: () => {
      useCanvasEditing.getState().setSelectionRegion(null);
      useStore.getState().setSelectedNodeIds([]);
      useStore.setState(state => ({ edges: state.edges.map(edge => edge.selected ? { ...edge, selected: false } : edge) }));
    },
    ignoreOutside: event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return true;
      if (!(event.target instanceof Element)) return false;
      if (event.target.closest('[data-selection-resizer], [data-selection-toolbar], [data-selection-menu], [data-selection-target-control], [data-edge-inspector], [data-batch-edge-inspector], [data-layout-quick], [data-canvas-layout-entry], [data-canvas-layout-panel], [data-node-details], [data-node-details-close]')) return true;
      const bounds = ref.current?.getBoundingClientRect();
      return event.target.classList.contains('react-flow__pane') && !!bounds
        && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    },
  });
  if (!region || !renderer) return null;
  // Multi-node geometry controls draw this same rectangle and own its movement.
  return createPortal(<><div ref={ref} data-selection-region data-selection-region-target={target}
    data-selection-region-surface={!hasNodeSurface || undefined}
    className="selection-region nodrag"
    style={{ left: x + region.rect.x * zoom, top: y + region.rect.y * zoom, width: region.rect.width * zoom, height: region.rect.height * zoom }}
    role="group" aria-label={t('selection.region')}
    onPointerDown={event => { if (event.button === 0) event.stopPropagation(); }}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} />
    <SelectionTargetControl region={region} />
    </>,
  renderer);
}
