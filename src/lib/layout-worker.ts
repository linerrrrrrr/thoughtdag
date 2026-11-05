import { solveLayout } from './layout-engine';
import type { LayoutProblem, LayoutSolution } from './layout-model';

const channel = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; problem: LayoutProblem }>) => void;
  postMessage: (message: { id: number; result: LayoutSolution }) => void;
};
channel.onmessage = async ({ data }) => {
  try { channel.postMessage({ id: data.id, result: await solveLayout(data.problem) }); }
  catch { channel.postMessage({ id: data.id, result: { error: 'layout-failed' } }); }
};
