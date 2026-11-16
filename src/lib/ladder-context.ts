// What a node's summary must know to say what the node ADDS: the thread it
// continues, compressed with the thread's own ladders (every earlier step in
// one or two of its own sentences, the direct parent in its abstract), and
// the parent's answer for spotting a revision. This is the compressed
// context for selection when the compiled context itself is out of reach
// (agents, older nodes) or too large to resend.
import type { ThoughtNode, ThoughtEdge } from '../types';
import { getContextPath } from './graph';
import { levelText } from './ladder-core';
import { requestLocalLadder } from './local-ladder-cache';
import { activeSummary, activeTopic, countTokens } from '../utils';

export interface LadderContext { thread: string; parentAnswer?: string }

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** One line for an earlier step: its brief (L2), else its takeaway, else the head of its answer. */
function stepLine(n: ThoughtNode, full: boolean): string | null {
  const d = n.data;
  if (d.stepKind) return null; // materials and notes are context, not steps
  const response = d.responses?.[d.responseIndex] ?? d.response;
  if (!response) return null;
  const ladder = d.summaryLadders?.[d.responseIndex] ?? requestLocalLadder(n.id, d.question, response, activeSummary(d), activeTopic(d));
  const text = ladder ? levelText(ladder, full ? 3 : 2) : (activeSummary(d) ?? tidy(response).slice(0, full ? 600 : 160));
  return `Q: ${tidy(d.question).slice(0, 120)}\n   ${tidy(text)}`;
}

/** The thread behind a node, oldest first, trimmed from the old end to the token budget; and its parent's answer. */
export function ladderContextFor(nodeId: string, nodes: ThoughtNode[], edges: ThoughtEdge[], budgetTokens = 1400): LadderContext {
  const ordered = getContextPath(nodeId, nodes, edges);
  const parents = edges.filter((e) => e.target === nodeId && !e.data?.isCrossLink).map((e) => e.source);
  const parentId = parents[0];
  const parent = parentId ? nodes.find((n) => n.id === parentId) : undefined;
  const parentAnswer = parent && !parent.data.stepKind ? (parent.data.responses?.[parent.data.responseIndex] ?? parent.data.response) || undefined : undefined;
  const lines: string[] = [];
  for (const n of ordered) {
    if (n.id === nodeId) continue;
    if (n.data.archived) continue; // an archived step is out of the context, so out of the thread the summariser reads
    const line = stepLine(n, n.id === parentId);
    if (line) lines.push(line);
  }
  while (lines.length > 1 && countTokens(lines.join('\n')) > budgetTokens) lines.shift();
  return { thread: lines.join('\n'), parentAnswer };
}
