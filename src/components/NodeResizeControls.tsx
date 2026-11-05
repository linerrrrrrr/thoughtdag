import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useStore as useFlowStore, useUpdateNodeInternals, useViewport } from '@xyflow/react';
import { useStore } from '../store';
import { useCanvasEditing } from '../lib/canvas-editing';
import { condenseGuard } from '../lib/condense-guard';
import { effectiveNodeGeometry, resizeSelectionBy } from '../lib/node-geometry';
import { sideAnchorOffset } from '../lib/edge-anchors';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useT } from '../i18n';
import type { ThoughtNode } from '../types';
import type { SelectionRegion, SelectionTarget } from '../lib/canvas-selection';
import ResizeGrip, { type ResizeDirection } from './ResizeGrip';

type Gesture = {
  x: number; y: number; zoom: number; pointerId: number; direction: ResizeDirection;
  original: ThoughtNode; basis: ThoughtNode; changed: boolean; region: SelectionRegion | null; target: SelectionTarget;
};

function restoreSize(drag: Gesture) {
  useCanvasEditing.getState().setSelectionRegion(drag.region);
  if (drag.region) useCanvasEditing.getState().setSelectionTarget(drag.target);
  useStore.setState(state => ({ nodes: state.nodes.map(node => node.id !== drag.original.id ? node : {
    ...node, width: drag.original.width, height: drag.original.height,
    data: { ...node.data, keepOverviewHeight: drag.original.data.keepOverviewHeight },
  }) }));
}

function resizeNode(nodes: ThoughtNode[], original: ThoughtNode, dx: number | undefined, dy: number | undefined) {
  // Working-card edits preserve semantic zoom; only the selection boundary can
  // explicitly resize an overview and opt it into a fixed overview footprint.
  return resizeSelectionBy(nodes, [original], dx, dy).map(node => node.id !== original.id ? node : {
    ...node, data: { ...node.data, keepOverviewHeight: original.data.keepOverviewHeight },
  });
}

/** Reversible geometry gestures leave content, selection and edit sessions intact. */
export default function NodeResizeControls({ id, widthOnly = false }: { id: string; widthOnly?: boolean }) {
  const t = useT();
  const { zoom } = useViewport();
  const connecting = useFlowStore(state => state.connection.inProgress);
  const snapToGrid = useFlowStore(state => state.snapToGrid);
  const snapGrid = useFlowStore(state => state.snapGrid);
  const height = useFlowStore(state => state.nodeLookup.get(id)?.measured?.height ?? 240);
  const multi = useStore(state => state.selectedNodeIds.length > 1);
  const locked = useStore(state => !!state.nodes.find(node => node.id === id)?.data.lockAspectRatio);
  const updateNodeInternals = useUpdateNodeInternals();
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [active, setActive] = useState<ResizeDirection | null>(null);
  const hitSize = 32 / Math.min(1, Math.max(.35, zoom));
  const widthGripMinimum = sideAnchorOffset(height) + 16 + hitSize / 2;
  const widthGripMaximum = height - hitSize;
  const widthGripTop = Math.max(height / 2, widthGripMinimum);

  const finish = (cancel = false) => {
    const drag = gesture.current;
    gesture.current = null;
    setActive(null);
    if (!drag?.changed) return;
    if (cancel) restoreSize(drag);
    else useStore.getState().pushHistory();
    requestAnimationFrame(() => updateNodeInternals(id));
  };
  useDismissableLayer({ open: active !== null, refs: [ref], priority: 10,
    dismissOnOutside: false, restoreFocus: false, onDismiss: () => finish(true) });
  useEffect(() => () => {
    if (gesture.current?.changed) restoreSize(gesture.current);
    gesture.current = null;
  }, []);

  const start = (event: PointerEvent<HTMLButtonElement>, direction: ResizeDirection) => {
    if (event.button !== 0 || gesture.current || connecting || multi || condenseGuard()) return;
    const original = useStore.getState().nodes.find(node => node.id === id);
    const box = ref.current?.parentElement?.getBoundingClientRect();
    if (!original || !box) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Measure natural-height cards at the visible boundary, including after reflow.
    const basis = { ...original, measured: { width: box.width / zoom, height: box.height / zoom } };
    gesture.current = { x: event.clientX, y: event.clientY, zoom, pointerId: event.pointerId,
      direction, original, basis, changed: false, region: useCanvasEditing.getState().selectionRegion,
      target: useCanvasEditing.getState().selectionTarget };
    setActive(direction);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.changed && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
    let dx = drag.direction === 'height' ? undefined : (event.clientX - drag.x) / drag.zoom;
    let dy = drag.direction === 'width' ? undefined : (event.clientY - drag.y) / drag.zoom;
    if (snapToGrid) {
      const size = effectiveNodeGeometry(drag.basis);
      if (dx !== undefined) dx = Math.round((size.width + dx) / snapGrid[0]) * snapGrid[0] - size.width;
      if (dy !== undefined) dy = Math.round((size.height + dy) / snapGrid[1]) * snapGrid[1] - size.height;
    }
    if (!drag.changed) {
      useStore.getState().pushHistory();
      useCanvasEditing.getState().setSelectionRegion(null);
    }
    drag.changed = true;
    useStore.setState(state => ({ nodes: resizeNode(state.nodes, drag.basis, dx, dy) }));
  };
  const release = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    if (event.pointerId !== gesture.current?.pointerId) return;
    event.stopPropagation();
    if (!cancel) move(event);
    finish(cancel);
  };

  return <div ref={ref} className="node-resize-controls" hidden={connecting || multi || (widthOnly && locked)}
    data-node-resizing={active || undefined} data-resize-locked={locked || undefined}>
    {(['width', 'height', 'both'] as const).map(direction => {
      const label = t(direction === 'width' ? 'node.resizeWidth' : direction === 'height' ? 'node.resizeHeight' : 'node.resize');
      return <button key={direction} type="button" data-node-resize={direction} data-resize-active={active === direction || undefined}
        hidden={(widthOnly && direction !== 'width') || (direction === 'width' && widthGripMinimum > widthGripMaximum && active !== 'width')}
        style={direction === 'width' ? { top: widthGripTop } : undefined}
        className={`node-resize-handle node-resize-${direction} react-flow__resize-control thought-resize-${direction === 'width' ? 'side' : direction === 'height' ? 'bottom' : 'corner'} nodrag nopan`}
        aria-label={locked ? `${label} · ${t('format.lockAspectRatio')}` : label}
        onPointerDown={event => start(event, direction)} onPointerMove={move}
        onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)} onLostPointerCapture={event => release(event, true)}
        onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || gesture.current) return;
          const horizontal = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
          const vertical = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
          if ((!horizontal || direction === 'height') && (!vertical || direction === 'width')) return;
          event.preventDefault(); event.stopPropagation();
          if (condenseGuard()) return;
          const state = useStore.getState();
          const original = state.nodes.find(node => node.id === id);
          if (!original) return;
          const step = event.shiftKey ? 10 : 1;
          state.pushHistory();
          useCanvasEditing.getState().setSelectionRegion(null);
          state.setNodes(resizeNode(state.nodes, original,
            horizontal && direction !== 'height' ? horizontal * step : undefined,
            vertical && direction !== 'width' ? vertical * step : undefined));
          state.pushHistory();
          requestAnimationFrame(() => updateNodeInternals(id));
        }}><ResizeGrip direction={direction} /></button>;
    })}
  </div>;
}
