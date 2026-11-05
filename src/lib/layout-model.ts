export interface LayoutShape {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  frame: boolean;
  parent?: string;
  fixed?: boolean;
  minWidth?: number;
  minHeight?: number;
  aspectRatio?: number;
}

export interface LayoutLink {
  id: string;
  source: string;
  target: string;
  structural: boolean;
  continuation: boolean;
  auxiliary?: 'reference' | 'watch';
}

export interface LayoutProjectionOptions {
  direction: 'vertical' | 'horizontal';
  gap: number;
  crossGap: number;
  framePadding: { top: number; left: number; right: number; bottom: number };
  method: 'manual' | 'chains' | 'layers';
}

export interface LayoutProblem {
  shapes: LayoutShape[];
  links: LayoutLink[];
  options: LayoutProjectionOptions;
}

export interface LayoutSolution {
  shapes?: LayoutShape[];
  error?: 'frame-conflict' | 'boundary-conflict' | 'obstacle-conflict' | 'layout-failed';
}
