import { parseCodexVisuals } from '../../runtime/agents/codex-visual-refs.mjs';
import { codexThreadIdForVersion } from './codex-thread-link';
import type { ThoughtData } from '../types';

export { parseCodexVisuals };
export type { CodexVisualReference } from '../../runtime/agents/codex-visual-refs.mjs';

/** A portable display document. The answer text remains the native transcript. */
export interface CodexVisualSnapshot {
  path: string;
  html: string;
}

const empty: readonly CodexVisualSnapshot[] = [];
/** Text-only summaries can describe the preview without exposing its executor path. */
export function codexVisualCaption(text: string): string {
  const refs = parseCodexVisuals(text);
  if (!refs.length) return text;
  let result = '';
  let end = 0;
  for (const ref of refs) {
    result += text.slice(end, ref.start) + (ref.title ?? '');
    end = ref.end;
  }
  return (result + text.slice(end)).trim();
}

export function activeCodexVisuals(data: ThoughtData): readonly CodexVisualSnapshot[] {
  if (data.isLoading) return empty;
  const snapshots = data.codexVisuals?.[data.responseIndex];
  return Array.isArray(snapshots) ? snapshots : empty;
}

export function isCodexVisualAnswer(data: ThoughtData): boolean {
  if (data.isLoading) return !!data.liveCodexThreadId || data.executionKind === 'codex'
    || (!data.executionKind && data.model?.startsWith('codex/') === true);
  const author = data.generatedBy?.[data.responseIndex];
  if (author) return typeof author === 'string' && author.startsWith('codex/');
  return activeCodexVisuals(data).length > 0 || !!codexThreadIdForVersion(data);
}

/** Editing the prose keeps the originals still referenced by this version. */
export function visualsAfterResponseEdit(data: ThoughtData, text: string): ThoughtData['codexVisuals'] {
  const current = data.codexVisuals?.[data.responseIndex];
  if (!Array.isArray(current) || !current.length) return data.codexVisuals;
  const referenced = new Set(parseCodexVisuals(text).map(ref => ref.path));
  const kept = current.filter(item => referenced.has(item?.path));
  if (kept.length === current.length) return data.codexVisuals;
  return data.codexVisuals?.map((version, i) => i === data.responseIndex ? kept : version);
}
