import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const gitHash = /^[a-f0-9]{40}$/;
const localPath = /^(?:[\w.-]+\/)*[\w.-]+$/;

function resolveSnapshot(base, name) {
  if (typeof name !== 'string' || !localPath.test(name) || name.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('Invalid archive path: ' + name);
  }
  return path.join(base, ...name.split('/'));
}

function verifyFile(base, file) {
  const content = fs.readFileSync(resolveSnapshot(base, file.path));
  if (file.url) {
    if (!/^https:\/\//.test(file.url) || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error('Invalid external figure metadata: ' + file.path);
    }
    if (createHash('sha256').update(content).digest('hex') !== file.sha256) {
      throw new Error('SHA-256 mismatch: ' + file.path);
    }
  } else {
    const actual = createHash('sha1').update('blob ' + content.length + '\0').update(content).digest('hex');
    if (actual !== file.blob) throw new Error('Git blob mismatch: ' + file.path);
  }
  return content;
}

function verifySource(archive, source) {
  if (!gitHash.test(source.revision) || !source.version || !source.title ||
      !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(source.repository) || !/^https:\/\//.test(source.page)) {
    throw new Error('Missing or invalid upstream publication details');
  }
  if (!source.license?.spdx || !source.sections?.length || !Array.isArray(source.figures)) {
    throw new Error('Missing license, sections or figure list');
  }
  const base = resolveSnapshot(archive, source.directory);
  verifyFile(base, source.license);
  const markdown = verifyFile(base, source.document).toString('utf8');
  const headings = new Set([...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map(match => match[1].replace(/\s+\{#[^}]+\}$/, '').trim()));
  for (const section of source.sections) {
    if (!headings.has(section)) throw new Error('Missing source heading: ' + section);
  }
  for (const figure of source.figures) {
    verifyFile(base, figure);
    if (figure.url && !markdown.includes(figure.url)) {
      throw new Error('External figure URL does not occur in source: ' + figure.path);
    }
  }
}

/** Validate the pinned upstream documents without fetching or executing them. */
export function checkSpacingSources(root) {
  const archive = path.join(root, 'vendor/design-references');
  const manifestFile = 'vendor/design-references/manifest.json';
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'manifest.json'), 'utf8'));
    if (manifest.formatVersion !== 1 || !manifest.sources || Array.isArray(manifest.sources) ||
        typeof manifest.sources !== 'object' || Object.keys(manifest.sources).length === 0) {
      return [manifestFile + ': invalid or empty source manifest'];
    }
    const failures = [];
    for (const [id, source] of Object.entries(manifest.sources)) {
      try { verifySource(archive, source); }
      catch (error) { failures.push(manifestFile + ' [' + id + ']: ' + error.message); }
    }
    return failures;
  } catch (error) {
    return [manifestFile + ': ' + error.message];
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const failures = checkSpacingSources(fileURLToPath(new URL('../', import.meta.url)));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('PASS spacing source documents, sections, licenses and figures');
  }
}
