// Optional native-layout comparison using a separate local LibreOffice profile.
// This is explicitly not Microsoft Word verification.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = resolve('local-tests/superdoc');
const output = resolve(base, 'native-comparison');
// A profile inside the repository makes Vite watch LibreOffice's locked
// temporary files. Isolate each run outside that watcher and other sessions.
const profile = await mkdtemp(join(tmpdir(), 'thoughtdag-docx-qa-'));
const office = process.env.SOFFICE_PATH ?? 'C:/Program Files/LibreOffice/program/soffice.com';
assert.ok(existsSync(office), 'Set SOFFICE_PATH to an installed LibreOffice CLI; this test never installs software.');
await mkdir(output, { recursive: true });
const files = ['source-1', 'exported-1', 'edited-1'].filter(name => existsSync(resolve(base, `${name}.docx`)));
assert.equal(files.length, 3, 'Run the SuperDoc UI test first to produce original, no-edit export, and edited export.');
execFileSync(office, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--convert-to', 'pdf', '--outdir', output,
  ...files.map(name => resolve(base, `${name}.docx`))], { stdio: 'inherit', timeout: 120000, windowsHide: true });
const documents = [];
for (const name of files) {
  const pdf = resolve(output, `${name}.pdf`);
  assert.ok(existsSync(pdf), `${name} failed native rendering`);
  const info = execFileSync(process.env.PDFINFO_PATH ?? 'pdfinfo', [pdf], { encoding: 'utf8', windowsHide: true });
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  const size = info.match(/^Page size:\s+(.+)$/m)?.[1];
  assert.equal(pages, 3, `${name} retains the three source pages`);
  assert.ok(size?.includes('A4'), `${name} retains A4 paper`);
  execFileSync(process.env.PDFTOPPM_PATH ?? 'pdftoppm', ['-f', '1', '-l', '1', '-scale-to', '1600', '-png', '-singlefile', pdf,
    resolve(output, `${name}-page-1`)], { windowsHide: true, timeout: 30000 });
  documents.push({ name, pages, size, pdf, image: resolve(output, `${name}-page-1.png`) });
}
await writeFile(resolve(output, 'result.json'), JSON.stringify({ renderer: 'LibreOffice', nativeWordVerified: false, documents }, null, 2));
console.log('PASS original, no-edit export and edited export retain three A4 pages in LibreOffice.');
console.log(`Compare the page images in ${output} for picture, table and header/footer placement.`);
