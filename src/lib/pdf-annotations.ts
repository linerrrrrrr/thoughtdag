import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument, PDFHexString, PDFName, PDFString, fill, rectangle, setFillingRgbColor, setGraphicsState } from 'pdf-lib';
import type { PdfAnnotation } from '../types';
import { DocumentSourceError } from './original-document';

function bounds(points: number[][]) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Rebuild from the imported PDF so existing links and annotations survive,
 * while updating or deleting a canvas annotation never duplicates it on disk. */
export async function annotatedPdf(original: PDFDocumentProxy, annotations: PdfAnnotation[]): Promise<Blob> {
  const bytes = new Uint8Array(await original.getData());
  if (!annotations.length) return new Blob([bytes], { type: 'application/pdf' });
  const { PermissionFlag } = await import('pdfjs-dist');
  const permissions = await original.getPermissions();
  if (permissions && !permissions.includes(PermissionFlag.MODIFY_ANNOTATIONS)) {
    throw new DocumentSourceError('document.pdfProtected');
  }
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (error) {
    if (error instanceof Error && error.message.includes('encrypted')) throw new DocumentSourceError('document.pdfProtected');
    throw error;
  }
  const { context } = pdf;
  for (const pageNo of new Set(annotations.map(annotation => annotation.page))) {
    const page = pdf.getPage(pageNo - 1);
    const viewport = (await original.getPage(pageNo)).getViewport({ scale: 1 });
    const point = (x: number, y: number) => viewport.convertToPdfPoint(x * viewport.width, y * viewport.height);
    for (const annotation of annotations.filter(item => item.page === pageNo)) {
      const quads = annotation.rects.map(([x, y, w, h]) => [point(x, y), point(x + w, y), point(x, y + h), point(x + w, y + h)]);
      if (!quads.length || quads.flat(2).some(value => !Number.isFinite(value))) throw new DocumentSourceError('document.writeFailed');
      const rect = bounds(quads.flat());
      const hex = /^#[\da-f]{6}$/i.test(annotation.color) ? annotation.color.slice(1) : 'f4cc48';
      const rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
      const first = annotation.rects[0];
      const note = annotation.kind === 'note' || (annotation.kind === undefined && annotation.comment !== undefined
        && !annotation.text && first[2] === .025 && first[3] === .018);
      const dict = context.obj({
        Type: 'Annot', Subtype: note ? 'Text' : 'Highlight', P: page.ref, Rect: rect, F: 4, C: rgb,
        NM: PDFHexString.fromText(annotation.id), Contents: PDFHexString.fromText(annotation.comment ?? annotation.text ?? ''),
      });
      const created = new Date(annotation.createdAt);
      if (Number.isFinite(created.getTime())) dict.set(PDFName.of('CreationDate'), PDFString.fromDate(created));
      if (note) {
        dict.set(PDFName.of('Name'), PDFName.of('Comment'));
      } else {
        dict.set(PDFName.of('QuadPoints'), context.obj(quads.flat(2)));
        // Supply an appearance as well as semantic quads. Readers can paint
        // the highlight, including scanned regions, without generating one.
        const shapes = quads.map(quad => {
          const [x, y, right, top] = bounds(quad);
          return rectangle(x, y, right - x, top - y);
        });
        const opacity = .35;
        const appearance = context.formXObject([
          setGraphicsState('Highlight'), setFillingRgbColor(rgb[0], rgb[1], rgb[2]), ...shapes, fill(),
        ], { BBox: rect, Resources: { ExtGState: { Highlight: { Type: 'ExtGState', BM: 'Multiply', ca: opacity } } } });
        dict.set(PDFName.of('CA'), context.obj(opacity));
        dict.set(PDFName.of('AP'), context.obj({ N: context.register(appearance) }));
      }
      page.node.addAnnot(context.register(dict));
    }
  }
  return new Blob([new Uint8Array(await pdf.save({ updateFieldAppearances: false }))], { type: 'application/pdf' });
}
