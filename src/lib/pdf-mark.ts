import type { PdfAnnotation } from '../types';

export function formatAnchorPages(page: number, additionalPages?: { page: number }[]): string {
  return [page, ...(additionalPages ?? []).map(part => part.page)].join(', ');
}

export function isPdfPointNote(mark: PdfAnnotation): boolean {
  if (mark.kind) return mark.kind === 'note';
  // Before the kind field, clicking with the comment tool made a fixed-size pin.
  const first = mark.rects?.[0];
  return !!first && mark.comment !== undefined && !mark.text
    && Math.abs(first[2] - .025) < 1e-6 && Math.abs(first[3] - .018) < 1e-6;
}
