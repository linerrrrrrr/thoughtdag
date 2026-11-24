export interface CodexVisualReference {
  start: number;
  end: number;
  path: string;
  title?: string;
  mode?: 'wide';
}
export function parseCodexVisuals(text: string): CodexVisualReference[];
