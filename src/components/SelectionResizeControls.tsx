import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useStore as useFlowStore } from '@xyflow/react';
import { useStore } from '../store';
import { nodesRect, resolveCarriedNodeIds } from '../lib/frames';
import { resizeSelectionBy } from '../lib/node-geometry';
import { condenseGuard } from '../lib/condense-guard';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useCanvasEditing } from '../lib/canvas-editing';
import type { SelectionRegion } from '../lib/canvas-selection';
import { useT } from '../i18n';
import type { ThoughtNode } from '../types';
import ResizeGrip from './ResizeGrip';
import './SelectionResizeControls.css';

type Direction = 'move' | 'width' | 'height' | 'both';
type Gesture = { x: number; y: number; zoom: number; pointerId: number; direction: Direction; originals: ThoughtNode[]; changed: boolean; clickedId?: string; region: SelectionRegion | null };

export default function SelectionResizeControls({ onNodeContextMenu }: { onNodeContextMenu: (event: MouseEvent, node: { id: string }) => void }) {
  const nodes = useStore(state => state.nodes);
  const ids = useStore(state => state.selectedNodeIds);
  const region = useCanvasEditing(state => state.selectionRegion);
  const { x, y, zoom } = useViewport();
  const snapToGrid = useFlowStore(state => state.snapToGrid);
  const snapGrid = useFlowStore(state => state.snapGrid);
  const connecting = useFlowStore(state => state.connection.inProgress);
  const renderer = useFlowStore(state => state.domNode?.querySelector<HTMLElement>('.react-flow__renderer'));
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const contextOrigin = useRef<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState<Direction | null>(null);
  const t = useT();
  const selected = nodes.filter(node => ids.includes(node.id) && !node.hidden);
  const nodeBounds = nodesRect(selected);
  const bounds = region && nodeBounds ? {
    x: Math.min(region.rect.x, nodeBounds.x), y: Math.min(region.rect.y, nodeBounds.y),
    width: Math.max(region.rect.x + region.rect.width, nodeBounds.x + nodeBounds.width) - Math.min(region.rect.x, nodeBounds.x),
    height: Math.max(region.rect.y + region.rect.height, nodeBounds.y + nodeBounds.height) - Math.min(region.rect.y, nodeBounds.y),
  } : nodeBounds;
  const finish = (cancel = false) => {
    const drag = gesture.current;
    gesture.current = null;
    setActive(null);
    if (!drag?.changed) return;
    if (cancel) {
      useCanvasEditing.getState().setSelectionRegion(drag.region);
      const previous = new Map(drag.originals.map(node => [node.id, node]));
      useStore.setState(state => ({ nodes: state.nodes.map(node => {
        const original = previous.get(node.id);
        if (!original) return node;
        return drag.direction === 'move' ? { ...node, position: original.position }
          : { ...node, width: original.width, height: original.height,
            data: { ...node.data, keepOverviewHeight: original.data.keepOverviewHeight } };
      }) }));
    } else useStore.getState().pushHistory();
  };
  useDismissableLayer({
    open: selected.length > 1 && !region, refs: [ref], priority: -100, restoreFocus: false, independentOutside: true,
    onDismiss: () => useStore.getState().setSelectedNodeIds([]),
    // The selection's own editing controls form one interaction boundary.
    // Additive gestures must retain the old selection until React Flow reads it.
    ignoreOutside: event => !!gesture.current || event.ctrlKey || event.metaKey || event.shiftKey
      || event.target instanceof Element && !!event.target.closest('[data-selection-toolbar], [data-selection-menu], [data-selection-target-control], [data-layout-quick], [data-canvas-layout-entry], [data-canvas-layout-panel], [data-node-details], [data-node-details-close]'),
  });
  useDismissableLayer({ open: active !== null, refs: [ref], priority: 10, dismissOnOutside: false, restoreFocus: false, onDismiss: () => finish(true) });
  if (selected.length < 2 || !bounds || !renderer) return null;
  const start = (event: PointerEvent<HTMLButtonElement>, direction: Direction) => {
    if (direction === 'move' && event.button === 2) contextOrigin.current = { x, y };
    if (event.button !== 0 || gesture.current || condenseGuard()) return;
    event.preventDefault(); event.stopPropagation();
    const state = useStore.getState();
    const hit = direction === 'move' ? document.elementsFromPoint(event.clientX, event.clientY).find(element => element.matches('.react-flow__node')) : undefined;
    const clickedId = hit?.getAttribute('data-id') ?? undefined;
    if (direction === 'move' && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      if (clickedId) {
        state.setSelectedNodeIds(state.selectedNodeIds.includes(clickedId)
          ? state.selectedNodeIds.filter(selectedId => selectedId !== clickedId) : [...state.selectedNodeIds, clickedId]);
      }
      return;
    }
    const moving = new Set(direction === 'move' ? resolveCarriedNodeIds(state.nodes, state.selectedNodeIds) : state.selectedNodeIds);
    const originals = state.nodes.filter(node => moving.has(node.id));
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { x: event.clientX, y: event.clientY, zoom, pointerId: event.pointerId, direction, originals, changed: false, clickedId, region };
    setActive(direction);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = gesture.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = drag.direction === 'height' ? undefined : (event.clientX - drag.x) / drag.zoom;
    const dy = drag.direction === 'width' ? undefined : (event.clientY - drag.y) / drag.zoom;
    if (!drag.changed && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
    if (!drag.changed) {
      useStore.getState().pushHistory();
      useCanvasEditing.getState().setSelectionRegion(null);
    }
    drag.changed = true;
    if (drag.direction === 'move') {
      const anchor = drag.originals[0].position;
      const offsetX = snapToGrid ? Math.round((anchor.x + dx!) / snapGrid[0]) * snapGrid[0] - anchor.x : dx!;
      const offsetY = snapToGrid ? Math.round((anchor.y + dy!) / snapGrid[1]) * snapGrid[1] - anchor.y : dy!;
      const positions = new Map(drag.originals.map(node => [node.id, { x: node.position.x + offsetX, y: node.position.y + offsetY }]));
      useStore.setState(state => ({ nodes: state.nodes.map(node => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      }) }));
    } else useStore.setState(state => ({ nodes: resizeSelectionBy(state.nodes, drag.originals, dx, dy) }));
  };
  const release = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    if (event.pointerId !== gesture.current?.pointerId) return;
    event.stopPropagation();
    if (!cancel) move(event);
    const clickedId = !cancel && !gesture.current?.changed ? gesture.current?.clickedId : undefined;
    finish(cancel);
    // A click drills into a selected node; a drag still moves the whole selection.
    if (clickedId) useStore.getState().setSelectedNodeId(clickedId);
  };
  // Stay in screen coordinates, inside the native wheel/pan event boundary.
  return createPortal(<div ref={ref} data-selection-resizer data-selection-gesture={active || undefined} className="selection-resizer nodrag"
    style={{ left: x + bounds.x * zoom, top: y + bounds.y * zoom, width: bounds.width * zoom, height: bounds.height * zoom }}>
    <button type="button" data-selection-move className={`selection-move-surface nodrag${active === 'move' ? ' is-moving' : ''}`}
      aria-label={t('selection.move')} onPointerDown={event => start(event, 'move')} onPointerMove={move}
      onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)} onLostPointerCapture={event => release(event, true)}
      onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onContextMenu={event => {
        const origin = contextOrigin.current;
        contextOrigin.current = null;
        if (origin && (Math.abs(x - origin.x) > 1 || Math.abs(y - origin.y) > 1)) {
          event.preventDefault();
          return;
        }
        const hit = document.elementsFromPoint(event.clientX, event.clientY).find(element => element.matches('.react-flow__node'));
        const id = hit?.getAttribute('data-id');
        if (id) onNodeContextMenu(event, { id });
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        const horizontal = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        const vertical = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if (!horizontal && !vertical) return;
        event.preventDefault(); event.stopPropagation();
        if (condenseGuard()) return;
        useCanvasEditing.getState().setSelectionRegion(null);
        const state = useStore.getState();
        const moving = new Set(resolveCarriedNodeIds(state.nodes, state.selectedNodeIds));
        const step = event.shiftKey ? 10 : 1;
        state.pushHistory();
        state.setNodes(state.nodes.map(node => moving.has(node.id) ? { ...node, position: { x: node.position.x + horizontal * step, y: node.position.y + vertical * step } } : node));
        state.pushHistory();
      }} />
    {(['width', 'height', 'both'] as const).map(direction => <button key={direction} type="button"
      hidden={connecting} data-resize-active={active === direction || undefined}
      data-selection-resize={direction} className={`selection-resize-handle selection-resize-${direction} nodrag nopan`}
      title={t(direction === 'width' ? 'selection.resizeWidth' : direction === 'height' ? 'selection.resizeHeight' : 'selection.resizeBoth')}
      aria-label={t(direction === 'width' ? 'selection.resizeWidth' : direction === 'height' ? 'selection.resizeHeight' : 'selection.resizeBoth')}
      onPointerDown={event => start(event, direction)} onPointerMove={move}
      onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)} onLostPointerCapture={event => release(event, true)}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        const horizontal = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        const vertical = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if ((!horizontal || direction === 'height') && (!vertical || direction === 'width')) return;
        event.preventDefault(); event.stopPropagation();
        if (condenseGuard()) return;
        useCanvasEditing.getState().setSelectionRegion(null);
        const step = event.shiftKey ? 10 : 1;
        const state = useStore.getState();
        state.pushHistory();
        state.setNodes(resizeSelectionBy(state.nodes, selected, horizontal && direction !== 'height' ? horizontal * step : undefined, vertical && direction !== 'width' ? vertical * step : undefined));
        state.pushHistory();
      }}><ResizeGrip direction={direction} /></button>)}
  </div>, renderer);
}
