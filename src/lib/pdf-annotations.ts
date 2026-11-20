import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, fill, rectangle, setFillingRgbColor, setGraphicsState } from 'pdf-lib';
import type { PdfAnnotation } from '../types';
import { DocumentSourceError } from './document-errors';
import { isPdfPointNote } from './pdf-mark';

function bounds(points: number[][]) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Remove only marks that this canvas renders as editable overlays. Native
 * annotations from a different tool stay in the PDF and keep their appearance. */
export async function canvasPdfPages(bytes: Uint8Array, saved: PdfAnnotation[]): Promise<Uint8Array> {
  if (!saved.length) return bytes;
  const wanted = new Set(saved.map(mark => mark.id));
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  let changed = false;
  for (const page of pdf.getPages()) {
    const marks = page.node.Annots();
    if (!marks) continue;
    for (let i = marks.size() - 1; i >= 0; i--) {
      const mark = marks.lookup(i);
      const name = mark instanceof PDFDict && mark.get(PDFName.of('NM'));
      if ((name instanceof PDFHexString || name instanceof PDFString) && wanted.has(name.decodeText())) {
        marks.remove(i);
        changed = true;
      }
    }
  }
  return changed ? pdf.save({ updateFieldAppearances: false }) : bytes;
}

/** Match editable canvas marks by their PDF annotation IDs after an ordinary
 * editor saves the file. Positions and comments follow the saved PDF. */
export async function readSavedCanvasMarks(bytes: Uint8Array, doc: PDFDocumentProxy, previous: PdfAnnotation[]) {
  const result: PdfAnnotation[] = [];
  if (!previous.length) return result;
  const wanted = new Map(previous.map(mark => [mark.id, mark]));
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [index, page] of pdf.getPages().entries()) {
    const items = page.node.Annots();
    if (!items) continue;
    const view = (await doc.getPage(index + 1)).getViewport({ scale: 1 });
    for (let i = 0; i < items.size(); i++) {
      const item = items.lookup(i);
      if (!(item instanceof PDFDict)) continue;
      const name = item.lookup(PDFName.of('NM'));
      const saved = (name instanceof PDFString || name instanceof PDFHexString) && wanted.get(name.decodeText());
      if (!saved) continue;
      const quads = item.lookup(PDFName.of('QuadPoints'));
      const coords = quads instanceof PDFArray ? quads : item.lookup(PDFName.of('Rect'));
      if (!(coords instanceof PDFArray)) continue;
      const step = coords === quads ? 8 : 4;
      const rects: PdfAnnotation['rects'] = [];
      for (let j = 0; j + step <= coords.size(); j += step) {
        const points: number[][] = [];
        for (let k = 0; k < step; k += 2) {
          const x = coords.lookup(j + k), y = coords.lookup(j + k + 1);
          if (x instanceof PDFNumber && y instanceof PDFNumber) points.push(view.convertToViewportPoint(x.asNumber(), y.asNumber()));
        }
        if (points.length !== step / 2) continue;
        const [left, top, right, bottom] = bounds(points);
        rects.push([left / view.width, top / view.height, (right - left) / view.width, (bottom - top) / view.height]);
      }
      if (!rects.length) continue;
      const contents = item.lookup(PDFName.of('Contents'));
      const text = contents instanceof PDFString || contents instanceof PDFHexString ? contents.decodeText() : '';
      result.push({ ...saved, page: index + 1, rects, comment: text === (saved.text ?? '') && !saved.comment ? undefined : text });
    }
  }
  return result;
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
      const note = isPdfPointNote(annotation);
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
