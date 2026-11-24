import type { ThoughtEdge, ThoughtNode } from '../types';
import { resolveEdgeAnchors } from './edge-anchors';
import { isFrameNode, nodeRect } from './frames';
import { isSingleNodeReference } from './graph';

export interface PreviewCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'start' | 'turn' | 'material' | 'frame';
  question: boolean;
  answer: boolean;
}

export interface CanvasLibraryPreview {
  count: number;
  cards: PreviewCard[];
  wires: { id: string; path: string; reference: boolean }[];
}

// The thumbnail has a fixed drawing budget even when the project holds
// thousands of turns. Sample connected pairs as well as isolated cards.
function sample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, i) => items[Math.round(i * (items.length - 1) / (limit - 1))]);
}

export function canvasLibraryPreview(nodes: ThoughtNode[], edges: ThoughtEdge[]): CanvasLibraryPreview {
  const savedNodes = nodes.filter(node => node?.data && typeof node.id === 'string');
  const graphEdges = edges.filter(edge => edge && typeof edge.source === 'string' && typeof edge.target === 'string');
  const count = savedNodes.reduce((total, node) => total + Number(!isFrameNode(node)), 0);
  if (!savedNodes.length) return { count, cards: [], wires: [] };

  const drawnEdges = sample(graphEdges, 96);
  const chosen = new Set(sample(savedNodes, 96).map(node => node.id));
  for (const edge of drawnEdges) { chosen.add(edge.source); chosen.add(edge.target); }
  const incoming = new Set(graphEdges.filter(edge => !isSingleNodeReference(edge)).map(edge => edge.target));
  const byId = new Map<string, ThoughtNode>();
  const round = (v: number) => Math.round(v * 100) / 100;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of savedNodes) {
    if (!chosen.has(node.id) || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) continue;
    const box = nodeRect(node);
    // Keep the preview and its wire anchors on the same footprint for old
    // records whose cards have never been measured.
    byId.set(node.id, { ...node, width: box.width, height: box.height, measured: undefined });
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  if (!byId.size || !Number.isFinite(right - left) || !Number.isFinite(bottom - top)) return { count, cards: [], wires: [] };
  const scale = Math.min(200 / Math.max(1, right - left), 92 / Math.max(1, bottom - top), 0.24);
  const dx = (220 - (right - left) * scale) / 2, dy = (112 - (bottom - top) * scale) / 2;
  const x = (v: number) => round((v - left) * scale + dx);
  const y = (v: number) => round((v - top) * scale + dy);
  const cards: PreviewCard[] = [];
  const frames: PreviewCard[] = [];
  for (const node of byId.values()) {
    const box = nodeRect(node), material = ['note','file','link'].includes(node.data.stepKind ?? '');
    const card: PreviewCard = {
      id: node.id, x: x(box.x), y: y(box.y),
      width: Math.max(.65, round(box.width * scale)), height: Math.max(.55, round(box.height * scale)),
      kind: isFrameNode(node) ? 'frame' : material ? 'material' : incoming.has(node.id) ? 'turn' : 'start',
      question: !!node.data.question, answer: !!node.data.response,
    };
    (card.kind === 'frame' ? frames : cards).push(card);
  }
  const wires: CanvasLibraryPreview['wires'] = [];
  for (const edge of drawnEdges) {
    const anchors = resolveEdgeAnchors(edge, byId);
    if (!anchors) continue;
    const start = anchors.sourceAnchor, end = anchors.targetAnchor;
    const sx = x(start.x), sy = y(start.y), tx = x(end.x), ty = y(end.y);
    const mx = round((sx + tx) / 2), my = round((sy + ty) / 2);
    const controls = anchors.axis === 'horizontal' ? `${mx} ${sy} ${mx} ${ty}` : `${sx} ${my} ${tx} ${my}`;
    wires.push({ id: edge.id, path: `M${sx} ${sy}C${controls} ${tx} ${ty}`, reference: isSingleNodeReference(edge) });
  }
  return { count, cards: [...frames, ...cards], wires };
}
