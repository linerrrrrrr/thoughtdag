const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const DRAWING_MAIN_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PIXEL = 9525;

interface ImageSize { width: number; height: number }

/** Restore common inline-image dimensions omitted by the text converter.
 * Matching uses exact embedded bytes and equal occurrence counts; ambiguous
 * images retain the converter's result instead of borrowing another size. */
export async function restoreDocxImageSizes(source: ArrayBuffer, html: string): Promise<string> {
  try {
    const { default: JSZip } = await import('jszip');
    const archive = await JSZip.loadAsync(source);
    const documentFile = archive.file('word/document.xml');
    const relationshipsFile = archive.file('word/_rels/document.xml.rels');
    if (!documentFile || !relationshipsFile) return html;
    const [documentXml, relationshipsXml] = await Promise.all([documentFile.async('string'), relationshipsFile.async('string')]);
    const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
    const document = parse(documentXml);
    const relationships = parse(relationshipsXml);
    if (document.querySelector('parsererror') || relationships.querySelector('parsererror')) return html;
    const targets = new Map<string, string>();
    for (const relationship of Array.from(relationships.getElementsByTagNameNS('*', 'Relationship'))) {
      if (relationship.getAttribute('TargetMode') === 'External' || !relationship.getAttribute('Type')?.endsWith('/image')) continue;
      const id = relationship.getAttribute('Id');
      const target = relationship.getAttribute('Target');
      if (!id || !target) continue;
      const resolved = new URL(target, 'https://document.invalid/word/document.xml');
      if (resolved.origin !== 'https://document.invalid' || resolved.search || resolved.hash) continue;
      targets.set(id, decodeURIComponent(resolved.pathname.slice(1)));
    }
    const media = new Map<string, Promise<string | null>>();
    const readMedia = (path: string) => {
      let pending = media.get(path);
      if (!pending) {
        pending = archive.file(path)?.async('base64') ?? Promise.resolve(null);
        media.set(path, pending);
      }
      return pending;
    };
    const candidates = await Promise.all(Array.from(document.getElementsByTagNameNS(DRAWING_NS, 'inline')).map(async inline => {
      const extent = inline.getElementsByTagNameNS(DRAWING_NS, 'extent')[0];
      const blips = Array.from(inline.getElementsByTagNameNS(DRAWING_MAIN_NS, 'blip'));
      if (!extent || blips.length !== 1) return null;
      const relationship = blips[0].getAttributeNS(RELATIONSHIP_NS, 'embed');
      const path = relationship ? targets.get(relationship) : undefined;
      const width = Number(extent.getAttribute('cx')) / EMU_PER_PIXEL;
      const height = Number(extent.getAttribute('cy')) / EMU_PER_PIXEL;
      if (!path || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 32768 || height > 32768) return null;
      const data = await readMedia(path);
      return data ? { data, size: { width: Math.max(1, Math.round(width * 100) / 100), height: Math.max(1, Math.round(height * 100) / 100) } } : null;
    }));
    const sourceSizes = new Map<string, ImageSize[]>();
    for (const candidate of candidates) {
      if (!candidate) continue;
      const sizes = sourceSizes.get(candidate.data) ?? [];
      sizes.push(candidate.size);
      sourceSizes.set(candidate.data, sizes);
    }
    const converted = new DOMParser().parseFromString(html, 'text/html');
    const images = new Map<string, HTMLImageElement[]>();
    for (const image of converted.body.querySelectorAll('img')) {
      const match = /^data:image\/[^;,]+;base64,([\s\S]+)$/i.exec(image.getAttribute('src') ?? '');
      if (!match) continue;
      const key = match[1].replace(/\s/g, '');
      const occurrences = images.get(key) ?? [];
      occurrences.push(image);
      images.set(key, occurrences);
    }
    for (const [data, sizes] of sourceSizes) {
      const occurrences = images.get(data);
      if (!occurrences || occurrences.length !== sizes.length) continue;
      occurrences.forEach((image, index) => {
        image.setAttribute('width', String(sizes[index].width));
        image.setAttribute('height', String(sizes[index].height));
      });
    }
    return converted.body.innerHTML;
  } catch {
    // Size metadata is optional; a readable import must survive unsupported OOXML.
    return html;
  }
}
