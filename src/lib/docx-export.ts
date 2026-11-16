import { sanitizeDocumentHtml } from './html-material';

/** Word cannot embed WebP. Rasterize that local format while retaining its
 * displayed size and the editor's original HTML. No remote image is fetched. */
async function exportableHtml(source: string): Promise<string> {
  const doc = new DOMParser().parseFromString(await sanitizeDocumentHtml(source), 'text/html');
  for (const image of doc.body.querySelectorAll<HTMLImageElement>('img')) {
    const src = image.getAttribute('src') ?? '';
    if (!/^data:image\/webp;base64,/i.test(src)) continue;
    const raster = new Image();
    await new Promise<void>((resolve, reject) => {
      raster.onload = () => resolve();
      raster.onerror = () => reject(new Error('The embedded image could not be decoded.'));
      raster.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = raster.naturalWidth;
    canvas.height = raster.naturalHeight;
    const drawing = canvas.getContext('2d');
    if (!drawing) throw new Error('The embedded image could not be converted.');
    drawing.drawImage(raster, 0, 0);
    image.setAttribute('src', canvas.toDataURL('image/png'));
  }
  return doc.body.innerHTML;
}

/** Build a real editable DOCX, preserving the supported rich-text structures.
 * The source attachment is never written back or replaced. */
export async function documentDocxBlob(html: string): Promise<Blob> {
  const [{ Document, Packer, Paragraph }, { htmlToContent }, source] = await Promise.all([
    import('docx'), import('docx/html'), exportableHtml(html),
  ]);
  const children = htmlToContent(source, { maxImageWidth: 600 });
  const document = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 24 } } } },
    sections: [{ children: children.length ? children : [new Paragraph('')] }],
  });
  return Packer.toBlob(document);
}

export async function exportDocumentDocx(html: string, filename: string): Promise<void> {
  const blob = await documentDocxBlob(html);
  const url = URL.createObjectURL(blob);
  const name = (filename.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document').replace(/\.docx$/i, '');
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.docx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
