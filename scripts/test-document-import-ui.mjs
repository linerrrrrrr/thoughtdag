// Real local DOCX conversion in a fresh browser context; no model/API writes.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import JSZip from 'jszip';
import { chromium } from 'playwright-core';

const zip = new JSZip();
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
zip.file('word/media/figure.png', png, { base64: true });
zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`);
zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
zip.file('word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/reference" TargetMode="External"/>
  <Relationship Id="rImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/figure.png"/>
</Relationships>`);
zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`);
zip.file('word/numbering.xml', `<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Document heading</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold copy</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic copy</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First list item</w:t></w:r></w:p>
  <w:p><w:hyperlink r:id="rLink"><w:r><w:t>Reference link</w:t></w:r></w:hyperlink></w:p>
  <w:p><w:r><w:drawing><wp:inline><wp:extent cx="381000" cy="381000"/><wp:docPr id="1" name="Figure" descr="Figure caption"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="figure.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="381000" cy="381000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
  <w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Alpha</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`);
const base64 = await zip.generateAsync({ type: 'base64' });
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const apiWrites = [];
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) apiWrites.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5178', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async source => {
    const { processFile, FILE_INPUT_ACCEPT } = await import('/src/lib/attachments.ts');
    const { loadAttachmentContent, inlineVaultedContent, internNodes } = await import('/src/lib/attachment-vault.ts');
    const { documentCopyText, documentRichHtml } = await import('/src/lib/document-copy.ts');
    const { sanitizeDocumentHtml, documentHtmlToMarkdown } = await import('/src/lib/html-material.ts');
    const { documentDocxBlob } = await import('/src/lib/docx-export.ts');
    const { restoreDocxImageSizes } = await import('/src/lib/docx-image-sizes.ts');
    let attachment;
    await processFile(new File([Uint8Array.from(atob(source), char => char.charCodeAt(0))], 'working-copy.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }), { add: value => { attachment = value; }, update: (_id, patch) => { attachment = { ...attachment, ...patch }; } });
    if (!attachment) {
      const directModule = await import('/node_modules/.vite/deps/mammoth.js');
      const directMammoth = directModule.default ?? directModule;
      const diagnosticBuffer = Uint8Array.from(atob(source), char => char.charCodeAt(0)).buffer;
      const raw = await directMammoth.convertToHtml({ arrayBuffer: diagnosticBuffer });
      const sized = await restoreDocxImageSizes(diagnosticBuffer, raw.value);
      await documentHtmlToMarkdown(await sanitizeDocumentHtml(sized));
      throw new Error('DOCX import returned no attachment although direct conversion succeeded');
    }
    const importedOriginal = await loadAttachmentContent(attachment);
    const richHtml = await documentRichHtml(attachment);
    const sourceBuffer = Uint8Array.from(atob(source), char => char.charCodeAt(0)).buffer;
    const imageMarkup = new DOMParser().parseFromString(richHtml, 'text/html').querySelector('img')?.outerHTML ?? '';
    const imageWithoutSize = imageMarkup.replace(/ (?:width|height)="[^"]*"/g, '');
    const ambiguousImages = await restoreDocxImageSizes(sourceBuffer, imageWithoutSize + imageWithoutSize);
    const editedHtml = `<h1>Edited title</h1><p style="text-align:center;margin-left:4em;line-height:1.5"><span style="font-family:Arial;font-size:18pt;color:#ff0033"><strong><u>Styled copy</u></strong></span></p>${richHtml}`;
    const edited = { ...attachment, editedHtml, editedText: await documentHtmlToMarkdown(editedHtml) };
    const exportedBlob = await documentDocxBlob(editedHtml);
    const exportedBytes = new Uint8Array(await exportedBlob.arrayBuffer());
    let exportedBinary = '';
    for (let offset = 0; offset < exportedBytes.length; offset += 0x8000) exportedBinary += String.fromCharCode(...exportedBytes.subarray(offset, offset + 0x8000));
    const mammothModule = await import('/node_modules/.vite/deps/mammoth.js');
    const mammoth = mammothModule.default ?? mammothModule;
    const reopened = await mammoth.convertToHtml({ arrayBuffer: await exportedBlob.arrayBuffer() });
    const nodes = [{ id: 'document', type: 'thought', position: { x: 0, y: 0 }, data: { attachments: [edited] } }];
    const [backup] = await inlineVaultedContent(nodes);
    const exported = backup.data.attachments[0];
    const [restored] = await internNodes([backup]);
    return { attachment, importedOriginal, exported, restoredOriginal: await loadAttachmentContent(restored.data.attachments[0]),
      restoredText: documentCopyText(restored.data.attachments[0]), restoredHtml: await documentRichHtml(restored.data.attachments[0]),
      accept: FILE_INPUT_ACCEPT, exportedDocx: btoa(exportedBinary), reopenedHtml: reopened.value,
      ambiguousImages,
      sanitized: await sanitizeDocumentHtml('<p onclick="bad()" style="color:red;background-image:url(https://example.com/tracker)">Safe</p><script>bad()</script><img src="https://example.com/tracker">'),
      invalidSpacing: await sanitizeDocumentHtml('<p style="color:red;margin-left:calc(1em + 1px);line-height:var(--bad)">Safe spacing</p>'),
      legacyRich: await documentRichHtml({ id:'legacy', name:'old.docx', type:'text/plain', size:20, content:'# Legacy heading\n\n**Bold** and a list:\n\n- Item' }),
    };
  }, base64);
  assert.ok(result.accept.split(',').includes('.docx'));
  assert.equal(result.attachment.content, '');
  assert.equal(result.attachment.contentInVault, true);
  assert.equal(result.importedOriginal, base64);
  const markdown = result.attachment.extractedText;
  assert.match(markdown, /^# Document heading/m);
  assert.match(markdown, /\*\*Bold copy\*\*/);
  assert.match(markdown, /(?:\*|_)italic copy(?:\*|_)/);
  assert.match(markdown, /^\s*[*+-]\s+First list item/m);
  assert.ok(markdown.includes('[Reference link](https://example.com/reference)'));
  assert.match(markdown, /\|\s*Item\s*\|\s*Value\s*\|/);
  assert.match(markdown, /\|\s*Alpha\s*\|\s*42\s*\|/);
  assert.ok(result.attachment.documentHtml.includes('data:image/png;base64,'));
  assert.match(result.attachment.documentHtml, /<img\b[^>]*width="40"[^>]*height="40"/);
  assert.ok(!result.ambiguousImages.includes('width=') && !result.ambiguousImages.includes('height='));
  assert.ok(markdown.includes('Figure caption') && !markdown.includes('base64'));
  assert.equal(result.exported.content, base64);
  assert.equal(result.exported.extractedText, markdown);
  assert.ok(result.exported.editedText.includes('# Edited title'));
  assert.ok(!result.exported.editedText.includes('base64'));
  assert.ok(result.exported.editedHtml.includes('data:image/png;base64,'));
  assert.equal(result.restoredOriginal, base64);
  assert.equal(result.restoredText, result.exported.editedText);
  assert.ok(result.restoredHtml.includes('data:image/png;base64,') && result.restoredHtml.includes('Styled copy'));
  assert.ok(result.restoredHtml.includes('margin-left: 4em') && result.restoredHtml.includes('line-height: 1.5'));
  assert.ok(result.reopenedHtml.includes('Edited title') && result.reopenedHtml.includes('<table>') && result.reopenedHtml.includes('<img '));
  assert.ok(result.reopenedHtml.includes('Reference link') && result.reopenedHtml.includes('<ul>'));
  assert.ok(!result.sanitized.includes('onclick') && !result.sanitized.includes('<script') && !result.sanitized.includes('https://'));
  assert.ok(result.invalidSpacing.includes('color: red') && !result.invalidSpacing.includes('margin-left') && !result.invalidSpacing.includes('line-height'));
  assert.ok(result.legacyRich.includes('<h1>Legacy heading</h1>') && result.legacyRich.includes('<strong>Bold</strong>'));
  const exportedZip = await JSZip.loadAsync(result.exportedDocx, { base64: true });
  const xml = await exportedZip.file('word/document.xml').async('string');
  assert.match(xml, /w:color w:val="[Ff][Ff]0033"/);
  assert.match(xml, /w:sz w:val="36"/);
  assert.match(xml, /w:jc w:val="center"/);
  assert.match(xml, /w:ind[^>]*w:left="960"/);
  // docx/html maps CSS's font-size multiple to Word's normal line metrics (1.2).
  assert.match(xml, /w:spacing[^>]*w:line="300"/);
  assert.ok(xml.includes('<w:u ') && xml.includes('<w:b') && xml.includes('Arial'));
  assert.ok(Object.keys(exportedZip.files).some(name => name.startsWith('word/media/') && name.endsWith('.png')));
  assert.match(xml, /wp:extent cx="381000" cy="381000"/);
  assert.deepEqual(apiWrites, []);
  console.log('PASS real DOCX import preserves headings, bold, italic, lists, links, and tables');
  console.log('PASS original DOCX bytes and independent saved copy survive vault/export/import');
  console.log('PASS rich DOCX export reopens with images/tables/lists/links and preserves size/font/color/alignment');
  console.log('PASS rich HTML sanitization and legacy Markdown conversion');
  console.log('PASS inline DOCX image retains 40px dimensions; ambiguous matches remain untouched');
  console.log('PASS local conversion performs no model/API writes');
} finally {
  await context.close();
  await browser.close();
}
