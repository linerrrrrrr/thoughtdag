import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer,
  PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, VerticalMergeType,
  WidthType,
} from 'docx';

// A deterministic local picture makes byte-level round-trip checks meaningful.
function figurePng() {
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, bytes) => {
    const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
    return Buffer.concat([size, type, bytes, crc]);
  };
  const width = 300, height = 120, raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    const color = x < 100 ? [85, 71, 177] : x < 200 ? [59, 140, 178] : [226, 161, 59];
    const white = y > 24 && y < 96 && x % 100 > 25 && x % 100 < 75;
    raw.set(white ? [255, 255, 255] : color, offset);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function createSuperdocFixture(label = 'ALPHA', options = {}) {
  const image = figurePng();
  const border = { style: BorderStyle.SINGLE, size: 12, color: '355C7D' };
  const cell = (text, options = {}) => new TableCell({
    width: { size: 2800, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun(text)] })], ...options,
  });
  const table = new Table({
    width: { size: 8400, type: WidthType.DXA }, columnWidths: [2800, 2800, 2800],
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: [cell('Merged heading', { columnSpan: 2, width: { size: 5600, type: WidthType.DXA }, shading: { fill: 'DAE6F2' } }), cell('Amount', { shading: { fill: 'DAE6F2' } })] }),
      new TableRow({ children: [cell('Vertical merge', { verticalMerge: VerticalMergeType.RESTART }), cell('First row'), cell('42')] }),
      new TableRow({ children: [cell('', { verticalMerge: VerticalMergeType.CONTINUE }), cell('Second row'), cell('86')] }),
      new TableRow({ children: [cell('Total'), cell('Independent cell'), cell('128')] }),
    ],
  });
  const paragraph = text => new Paragraph({ spacing: { after: 180, line: 280 }, children: [new TextRun(text)] });
  const document = new Document({
    creator: 'ThoughtDAG local fixture', title: `${label} document fidelity fixture`,
    styles: { default: { document: { run: { font: 'Arial', size: 24 }, paragraph: { spacing: { after: 180 } } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440, header: 600, footer: 600 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: 'FIDELITY HEADER • Confidential', color: '355C7D', size: 18 })], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '355C7D' } } })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'FIDELITY FOOTER • Page ', size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) },
      children: [
        new Paragraph({ children: [new TextRun({ text: `${label} original document`, bold: true, size: 36, color: '355C7D' })], spacing: { after: 240 } }),
        paragraph(`${label} editable opening paragraph. This source must retain its picture, merged table, headers and page geometry after editing.`),
        ...(options.pointerParagraph ? [new Paragraph({ spacing: { after: 180, line: 280 }, children: [
          new TextRun('中文测试：请从这里开始拖动选中这一段正文，'),
          new TextRun({ text: '跨越第二行后高亮应始终与实际文字重合。', break: 1 }),
        ] })] : []),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: image, transformation: { width: 240, height: 96 }, altText: { name: 'Fidelity chart', title: 'Fidelity chart', description: 'Three colored columns with white bars' } })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Figure 1. Original picture: 240 × 96 px', italics: true, size: 20 })] }),
        table,
        paragraph('Table 1. Horizontal and vertical merges, blue borders and a shaded header.'),
        new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: `${label} PAGE TWO`, bold: true, size: 30 })] }),
        ...Array.from({ length: 12 }, (_, index) => paragraph(`Continuous reading paragraph ${index + 1}. The document keeps its A4 sheet width while the node viewport resizes. Scrolling this page must not pan or zoom the canvas.`)),
        new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: `${label} PAGE THREE`, bold: true, size: 30 })] }),
        paragraph(`${label} FINAL MARKER. Independent document history and source bytes must survive switching between nodes.`),
      ],
    }],
  });
  return { buffer: await Packer.toBuffer(document), image };
}

export async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const document = await zip.file('word/document.xml').async('string');
  const names = Object.keys(zip.files);
  const headers = await Promise.all(names.filter(name => /^word\/header[^/]*\.xml$/.test(name)).map(name => zip.file(name).async('string')));
  const footers = await Promise.all(names.filter(name => /^word\/footer[^/]*\.xml$/.test(name)).map(name => zip.file(name).async('string')));
  const media = await Promise.all(names.filter(name => /^word\/media\/[^/]+$/.test(name)).map(async name => ({ name, bytes: await zip.file(name).async('nodebuffer') })));
  return { document, headers, footers, media, names };
}
