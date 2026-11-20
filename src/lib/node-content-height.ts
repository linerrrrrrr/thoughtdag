import type { ThoughtData } from '../types';

type ContentHeightMeasure = (width?: number) => number | undefined;

/** Read the numeric dimensions used by older nodes' React Flow styles. */
export function pixelDimension(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string') return;
  const match = value.trim().match(/^(\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:px)?$/i);
  const size = match ? Number(match[1]) : NaN;
  return Number.isFinite(size) && size > 0 ? size : undefined;
}

// A compact content identity prevents a height chosen for an expanded view
// being applied to a different question or answer after edits or undo/redo.
export function contentHeightKey(data: Pick<ThoughtData, 'question' | 'response' | 'responseIndex'>): string {
  const text = `${data.question.length}:${data.question}${data.response.length}:${data.response}:${data.responseIndex}`;
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 3266489917);
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}

export function intendedContentHeight(data: ThoughtData): number | undefined {
  const intent = data.contentHeightIntent;
  return intent && Number.isFinite(intent.height) && intent.height > 0 && intent.content === contentHeightKey(data)
    ? intent.height : undefined;
}

// Rendered content is a measurement, not graph data. Re-read it at each edit
// so wrapping, disclosure state and answer versions stay current.
const measures = new Map<string, ContentHeightMeasure>();

export function registerNodeContentHeightMeasure(nodeId: string, measure: ContentHeightMeasure): () => void {
  measures.set(nodeId, measure);
  return () => { if (measures.get(nodeId) === measure) measures.delete(nodeId); };
}

export function getNodeContentHeightLimit(nodeId: string, width?: number): number | undefined {
  const height = measures.get(nodeId)?.(width);
  return height !== undefined && Number.isFinite(height) && height > 0 ? height : undefined;
}

/** Full-detail height once both panes fit their own content without blank share. */
export function measureConversationContentHeight(root: HTMLElement | null, width?: number): number | undefined {
  if (!root?.isConnected || root.dataset.nodeDetailLevel !== 'full') return;
  const changeWidth = width !== undefined && Number.isFinite(width) && width > 0 && Math.abs(root.offsetWidth - width) > 1;
  const previousWidth = root.style.width;
  // Graph dimensions use the standard logical type size even when the current
  // viewport, including a restored viewport on first mount, reflows the text.
  // Restore both inputs before paint and the next resize observer delivery.
  root.dataset.measureContentHeight = '';
  try {
    if (changeWidth) root.style.width = `${width}px`;
    return readConversationContentHeight(root);
  } finally {
    if (changeWidth) root.style.width = previousWidth;
    delete root.dataset.measureContentHeight;
  }
}

function readConversationContentHeight(root: HTMLElement): number | undefined {
  const split = root.querySelector<HTMLElement>('[data-conversation-split="node"]');
  const question = split?.querySelector<HTMLElement>('[data-conversation-split-question]');
  const answer = split?.querySelector<HTMLElement>('[data-conversation-split-answer]');
  const questionContent = question?.querySelector<HTMLElement>('.conversation-split-content');
  const answerContent = answer?.querySelector<HTMLElement>('.conversation-split-content');
  const divider = split?.querySelector<HTMLElement>('[data-conversation-divider]');
  // During a React update the split can briefly have no layout yet. Its
  // zero height would make the entire card look like surrounding chrome.
  if (!split || split.offsetHeight <= 0 || !question || !answer || !questionContent || !answerContent || !divider) return;
  // Measure content rather than pane scrollHeight, which is never smaller
  // than an already oversized viewport. offsetHeight stays in canvas units.
  const questionHeight = Math.max(questionContent.offsetHeight, questionContent.scrollHeight);
  const answerHeight = Math.max(answerContent.offsetHeight, answerContent.scrollHeight);
  const questionTools = split.querySelector<HTMLElement>('[data-split-question-tools]');
  const readingHeight = questionHeight + answerHeight + divider.offsetHeight + (questionTools?.offsetHeight ?? 0);
  let chromeHeight = root.offsetHeight - split.offsetHeight;
  // Expanded highlights may shrink before the reading area. Restore their
  // normal bounded height when computing the surrounding fixed sections.
  const highlights = root.querySelector<HTMLElement>('[data-node-highlights]');
  const list = highlights?.querySelector<HTMLElement>('.node-highlights-content:not([hidden])');
  if (list && highlights) {
    const maxHeight = parseFloat(getComputedStyle(list).maxHeight);
    const naturalHeight = Number.isFinite(maxHeight) ? Math.min(list.scrollHeight, maxHeight) : list.scrollHeight;
    chromeHeight += Math.max(0, naturalHeight - list.offsetHeight);
  }
  return Math.ceil(chromeHeight + readingHeight) + 1;
}
