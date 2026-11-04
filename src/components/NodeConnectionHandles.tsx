import { useEffect } from 'react';
import { Handle, Position, useNodeConnections, useStore as useFlowStore, useUpdateNodeInternals } from '@xyflow/react';
import { anchorHandle, handleSide, sideAnchorOffset, type AnchorSide } from '../lib/edge-anchors';
import './NodeConnectionHandles.css';

const SIDES: AnchorSide[] = ['top', 'right', 'bottom', 'left'];
const POSITIONS = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

/** Four physical anchor sites, two logical roles; geometry never changes context. */
export default function NodeConnectionHandles({ id, isTargetAllowed = true, muted = false, large = false }: {
  id: string;
  isTargetAllowed?: boolean;
  muted?: boolean;
  large?: boolean;
}) {
  const connections = useNodeConnections({ id });
  const height = useFlowStore((state) => {
    const node = state.nodeLookup.get(id);
    return node?.measured?.height ?? node?.height ?? 240;
  });
  const horizontal = useFlowStore((state) => state.nodeLookup.get(id)?.data.layoutDirection === 'horizontal');
  const connectable = useFlowStore((state) => state.nodesConnectable && state.nodeLookup.get(id)?.connectable !== false);
  const connectingFrom = useFlowStore((state) => state.connection.inProgress ? state.connection.fromNode.id : null);
  const updateNodeInternals = useUpdateNodeInternals();
  const offset = sideAnchorOffset(height);
  const incoming = new Set(connections.filter((edge) => edge.target === id).map((edge) => handleSide(edge.targetHandle)));
  const outgoing = new Set(connections.filter((edge) => edge.source === id).map((edge) => handleSide(edge.sourceHandle)));
  const naturalOutput = outgoing.values().next().value ?? (horizontal ? 'right' : 'bottom');
  const candidateTargets = connectable && connectingFrom !== null && connectingFrom !== id;
  const connectedKey = [...incoming, ...outgoing].join(',');
  useEffect(() => { updateNodeInternals(id); }, [id, offset, large, connectedKey, updateNodeInternals]);
  const tone = muted ? '!bg-ink-faint' : '!bg-accent';
  const common = `${tone} !border-2 !border-card tdag-handle tdag-auto-handle ${large ? 'tdag-handle-lg' : ''} ${connectable ? '' : 'tdag-port-disabled'}`;
  const positioning = (side: AnchorSide) => ({
    top: side === 'left' || side === 'right' ? offset : undefined,
    pointerEvents: connectable ? undefined : 'none' as const,
  });
  return <>
    {SIDES.map((side) => <Handle key={`out-${side}`} type="source" position={POSITIONS[side]} id={anchorHandle('source', side)}
      className={`${common} tdag-output-port ${outgoing.has(side) || side === naturalOutput ? 'tdag-port-used' : 'tdag-port-candidate'} ${connectingFrom !== null ? 'tdag-port-connecting' : ''}`}
      style={positioning(side)} isConnectable={connectable} isConnectableStart={connectable && (connectingFrom === null || connectingFrom === id)} isConnectableEnd={false}
      data-connection-side={side} data-connection-role="source" />)}
    {isTargetAllowed && SIDES.map((side) => <Handle key={`in-${side}`} type="target" position={POSITIONS[side]} id={anchorHandle('target', side)}
      className={`${common} tdag-input-port ${incoming.has(side) ? 'tdag-port-used' : 'tdag-port-candidate'} ${candidateTargets ? 'tdag-port-receiving' : ''}`}
      style={positioning(side)} isConnectable={connectable} isConnectableStart={false} isConnectableEnd={candidateTargets}
      data-connection-side={side} data-connection-role="target" />)}
    {/* Old IDs stay measurable until every restored edge has been mapped. */}
    <Handle type="source" position={Position.Bottom} id="continue" className="tdag-legacy-port" isConnectable={false} isConnectableStart={false} isConnectableEnd={false} />
    <Handle type="source" position={Position.Right} id="branch" className="tdag-legacy-port" style={{ top: offset }} isConnectable={false} isConnectableStart={false} isConnectableEnd={false} />
    {isTargetAllowed && <>
      <Handle type="target" position={Position.Top} id="top" className="tdag-legacy-port" isConnectable={false} isConnectableStart={false} isConnectableEnd={false} />
      <Handle type="target" position={Position.Left} id="left" className="tdag-legacy-port" style={{ top: offset }} isConnectable={false} isConnectableStart={false} isConnectableEnd={false} />
    </>}
  </>;
}
