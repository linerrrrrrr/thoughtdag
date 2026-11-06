type ContentHeightMeasure = (width?: number) => number | undefined;

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
  if (width !== undefined && Number.isFinite(width) && width > 0 && Math.abs(root.offsetWidth - width) > 1) {
    // Measure wrapping at the requested width synchronously, then restore the
    // visible layout before the browser paints or notifies resize observers.
    const previousWidth = root.style.width;
    try {
      root.style.width = `${width}px`;
      return measureConversationContentHeight(root);
    } finally { root.style.width = previousWidth; }
  }
  const split = root.querySelector<HTMLElement>('[data-conversation-split="node"]');
  const question = split?.querySelector<HTMLElement>('[data-conversation-split-question]');
  const answer = split?.querySelector<HTMLElement>('[data-conversation-split-answer]');
  const questionContent = question?.querySelector<HTMLElement>('.conversation-split-content');
  const answerContent = answer?.querySelector<HTMLElement>('.conversation-split-content');
  const divider = split?.querySelector<HTMLElement>('[data-conversation-divider]');
  if (!split || !question || !answer || !questionContent || !answerContent || !divider) return;
  // Measure content rather than pane scrollHeight, which is never smaller
  // than an already oversized viewport. offsetHeight stays in canvas units.
  const questionHeight = Math.max(questionContent.offsetHeight, questionContent.scrollHeight);
  const answerHeight = Math.max(answerContent.offsetHeight, answerContent.scrollHeight);
  const readingHeight = questionHeight + answerHeight + divider.offsetHeight;
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
