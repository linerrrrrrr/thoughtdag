import { useContext, useEffect } from 'react';
import { Handle, Position, useNodeConnections, useStore as useFlowStore, useUpdateNodeInternals } from '@xyflow/react';
import { anchorHandle, fixedConnectionSides, handleSide, rulerSourceHandle, sideAnchorOffset, supportsFixedPorts, type AnchorSide } from '../lib/edge-anchors';
import { CanvasConnectionLayout } from '../lib/edge-routing-context';
import './NodeConnectionHandles.css';

const SIDES: AnchorSide[] = ['top', 'right', 'bottom', 'left'];
const POSITIONS = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

/** Canvas geometry chooses where to draw each role; the edge owns its context semantics. */
export default function NodeConnectionHandles({ id, isTargetAllowed = true, muted = false, large = false }: {
  id: string;
  isTargetAllowed?: boolean;
  muted?: boolean;
  large?: boolean;
}) {
  const layout = useContext(CanvasConnectionLayout);
  const eligible = useFlowStore(state => supportsFixedPorts(state.nodeLookup.get(id)?.data.stepKind));
  const fixed = layout && eligible ? fixedConnectionSides(layout) : undefined;
  const connections = useNodeConnections({ id });
  const height = useFlowStore((state) => {
    const node = state.nodeLookup.get(id);
    return node?.measured?.height ?? node?.height ?? 240;
  });
  const horizontal = useFlowStore((state) => state.nodeLookup.get(id)?.data.layoutDirection === 'horizontal');
  const connectable = useFlowStore((state) => state.nodesConnectable && state.nodeLookup.get(id)?.connectable !== false);
  const connectingFrom = useFlowStore((state) => state.connection.inProgress ? state.connection.fromNode.id : null);
  const connectingMark = useFlowStore(state => state.connection.inProgress ? rulerSourceHandle(state.connection.fromHandle.id) : undefined);
  const updateNodeInternals = useUpdateNodeInternals();
  const offset = sideAnchorOffset(height);
  const incoming = new Set(connections.filter((edge) => edge.target === id).map((edge) => handleSide(edge.targetHandle)));
  const outgoing = new Set(connections.filter(edge => edge.source === id && !rulerSourceHandle(edge.sourceHandle)).map(edge => handleSide(edge.sourceHandle)));
  const naturalOutput = outgoing.values().next().value ?? (horizontal ? 'right' : 'bottom');
  const candidateTargets = connectable && connectingFrom !== null && connectingFrom !== id;
  const newLinkTarget = candidateTargets && !connections.some(edge => edge.source === connectingFrom && edge.target === id
    && rulerSourceHandle(edge.sourceHandle) === connectingMark);
  const connectedKey = [...incoming, ...outgoing].join(',');
  useEffect(() => { updateNodeInternals(id); }, [id, offset, large, fixed, connectedKey, updateNodeInternals]);
  const tone = muted ? '!bg-ink-faint' : '!bg-accent';
  const common = `tdag-handle tdag-auto-handle ${tone} !border-2 !border-card ${large ? 'tdag-handle-lg' : ''} ${connectable ? '' : 'tdag-port-disabled'}`;
  const positioning = (side: AnchorSide) => ({
    top: side === 'left' || side === 'right' ? offset : undefined,
    pointerEvents: connectable ? undefined : 'none' as const,
  });
  return <>
    {layout === 'dock' && fixed && isTargetAllowed && (
      <span aria-hidden="true" className="node-input-stem" style={{ top: offset }} />
    )}
    {(fixed ? [fixed.source] : SIDES).map((side) => <Handle key={`out-${side}`} type="source" position={POSITIONS[side]} id={anchorHandle('source', side)}
      className={`${common} tdag-output-port ${fixed || outgoing.has(side) || side === naturalOutput ? 'tdag-port-used' : 'tdag-port-candidate'} ${connectingFrom !== null ? 'tdag-port-connecting' : ''}`}
      style={positioning(side)} isConnectable={connectable} isConnectableStart={connectable && (connectingFrom === null || connectingFrom === id)} isConnectableEnd={false}
      data-connection-side={side} data-connection-role="source" />)}
    {isTargetAllowed && (fixed ? [fixed.target] : SIDES).map((side) => <Handle key={`in-${side}`} type="target" position={POSITIONS[side]} id={anchorHandle('target', side)}
      className={`${common} tdag-input-port ${fixed || incoming.has(side) ? 'tdag-port-used' : 'tdag-port-candidate'} ${candidateTargets ? 'tdag-port-receiving' : ''}`}
      style={positioning(side)} isConnectable={connectable} isConnectableStart={false} isConnectableEnd={candidateTargets}
      data-connection-side={side} data-connection-role="target" data-fixed-input={fixed ? true : undefined}
      data-new-link-target={newLinkTarget || undefined} />)}
    {/* Automatic geometry retains aliases for old persisted handle IDs. */}
    {!fixed && <>
      <Handle type="source" position={Position.Bottom} id="continue" className="tdag-legacy-port" isConnectable={false} isConnectableStart={false} isConnectableEnd={false} />
      <Handle type="source" position={Position.Right} id="branch" className="tdag-legacy-port" style={{ top: offset }} isConnectable={false} isConnectableStart={false} isConnectableEnd={false} />
      {isTargetAllowed && <>
        <Handle type="target" position={Position.Top} id="top" className="tdag-legacy-port" isConnectable={false} isConnectableStart={false} isConnectableEnd={false} />
        <Handle type="target" position={Position.Left} id="left" className="tdag-legacy-port" style={{ top: offset }} isConnectable={false} isConnectableStart={false} isConnectableEnd={false} />
      </>}
    </>}
  </>;
}
