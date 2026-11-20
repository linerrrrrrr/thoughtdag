import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';
import postcss from 'postcss';
import ts from 'typescript';

const appCss = 'src/index.css';

function resolveAsset(owner, url) {
  if (!url || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(url)) return '';
  const pathname = url.split(/[?#]/)[0];
  return path.posix.normalize(pathname.startsWith('/') ? pathname.slice(1) : path.posix.join(path.posix.dirname(owner), pathname));
}

// These roots ship user-facing HTML with the application. The website and
// documentation have independent builds. Never inventory generated bundles.
function htmlFiles(root, directory, recursive) {
  const result = [];
  if (!fs.existsSync(path.join(root, directory))) return result;
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isFile() && /\.html?$/i.test(entry.name)) result.push(file);
    if (recursive && entry.isDirectory() && !['node_modules', 'dist', 'out', 'payload', 'build'].includes(entry.name)) {
      result.push(...htmlFiles(root, file, true));
    }
  }
  return result;
}

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

export function checkTypographyHtml(root, registry, styles, report, { checkStyleSheet, unregisteredUtility }) {
  const files = new Set(htmlFiles(root, '.', false));
  for (const dir of ['src', 'public', 'runtime', 'desktop']) {
    for (const file of htmlFiles(root, dir, true)) files.add(file);
  }
  const roles = new Set(registry.roles);
  const statusSheet = 'runtime/status-pages/typography.css';
  const statusRules = new Set();
  if (fs.existsSync(path.join(root, statusSheet))) {
    const css = postcss.parse(fs.readFileSync(path.join(root, statusSheet), 'utf8'), { from: statusSheet });
    css.walkRules(rule => {
      for (const selector of rule.selectors) {
        const surface = /^\[data-type-surface="([\w-]+)"\]/.exec(selector)?.[1];
        if (!surface || !Object.entries(registry.boundaries).some(([file, b]) => file.startsWith('runtime/status-pages/') && b.body === surface)) {
          report(statusSheet, rule.source.start.line, 'standalone typography requires a registered status-page surface');
        } else if (selector === `[data-type-surface="${surface}"]` && rule.nodes.some(n => n.prop === 'font-size')) statusRules.add(surface);
      }
    });
  }
  const checkedSheets = new Map();
  function checkDeclarations(text, file, line) {
    const css = postcss.parse(text, { from: file });
    const imports = [];
    checkStyleSheet(file, css, roles, file === statusSheet || styles.sheets.has(file),
      (name, localLine, reason) => report(name, line + localLine - 1, reason));
    css.walkAtRules('import', rule => {
      const url = /^(?:url\(\s*)?["']?([^"'()\s]+)["']?/.exec(rule.params)?.[1];
      imports.push(...checkLinkedSheet(file, line + rule.source.start.line - 1, url));
    });
    return imports;
  }
  function checkLinkedSheet(owner, line, url) {
    const sheet = resolveAsset(owner, url);
    if (!sheet || sheet.startsWith('../') || !fs.existsSync(path.join(root, sheet))) {
      report(owner, line, 'typography stylesheet cannot be verified: ' + (url ?? '(missing)'));
      return [];
    }
    // The application stylesheet and its source imports are checked by the
    // main CSS pass. Standalone pages can also link their own local sheets.
    if (!checkedSheets.has(sheet)) {
      const linked = [sheet];
      checkedSheets.set(sheet, linked);
      if (sheet !== appCss) linked.push(...checkDeclarations(fs.readFileSync(path.join(root, sheet), 'utf8'), sheet, 1));
    }
    return checkedSheets.get(sheet);
  }
  for (const file of files) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    const doc = parse(html, { sourceCodeLocationInfo: true });
    const standalone = file.startsWith('runtime/status-pages/');
    const requiredSheet = standalone ? statusSheet : appCss;
    const anchors = registry.boundaries[file] ?? {};
    const found = new Set();
    let hasSheet = false;
    walk(doc, node => {
      if (!node.tagName) return;
      const attr = name => node.attrs.find(item => item.name === name)?.value;
      const line = node.sourceCodeLocation?.startLine ?? 1;
      const classes = (attr('class') ?? '').split(/\s+/);
      const geometric = ['path', 'circle', 'rect', 'polygon', 'polyline', 'ellipse', 'line'].includes(node.tagName);
      for (const token of classes) if (unregisteredUtility(token, geometric)) report(file, line, 'unregistered typography utility: ' + token);
      const matches = Object.keys(anchors).filter(anchor => {
        if (anchor.startsWith('.')) return classes.includes(anchor.slice(1));
        if (anchor.startsWith('#')) return attr('id') === anchor.slice(1);
        const data = /^\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(anchor);
        if (data) return attr(data[1]) !== undefined && (!data[2] || data[2] === attr(data[1]));
        return anchor === node.tagName;
      });
      for (const anchor of matches) {
        found.add(anchor);
        const wanted = anchors[anchor];
        if (attr('data-type-surface') !== wanted || !(standalone ? statusRules.has(wanted) : styles.rules.has(wanted))) {
          report(file, line, anchor + ' requires its registered data-type-surface (' + wanted + ')');
        }
      }
      if (!matches.length && attr('data-type-surface') !== undefined) report(file, line, 'surface marker has no matching registered element');
      if (node.tagName === 'body') {
        if (!anchors.body) report(file, line, 'HTML body requires its registered data-type-surface (unregistered entry)');
      }
      if (node.tagName === 'link' && attr('rel') === 'stylesheet') {
        if (checkLinkedSheet(file, line, attr('href')).includes(requiredSheet)) hasSheet = true;
      }
      if (!standalone && node.tagName === 'script' && attr('type') === 'module') {
        const entry = resolveAsset(file, attr('src'));
        if (entry && fs.existsSync(path.join(root, entry))) {
          const imports = ts.preProcessFile(fs.readFileSync(path.join(root, entry), 'utf8')).importedFiles;
          if (imports.some(ref => resolveAsset(entry, ref.fileName) === appCss)) hasSheet = true;
        }
      }
      if (node.tagName === 'style' && checkDeclarations(node.childNodes.map(child => child.value).join(''), file, line).includes(requiredSheet)) hasSheet = true;
      if (attr('style')) checkDeclarations('element{' + attr('style') + '}', file, line);
      if (attr('font-size')) checkDeclarations('text{font-size:' + attr('font-size') + '}', file, line);
    });
    for (const anchor of Object.keys(anchors)) if (!found.has(anchor)) report(file, 1, 'registered rendering boundary not found: ' + anchor);
    if (!hasSheet) report(file, 1, 'the document or its entry module must load its registered typography stylesheet');
  }
  // A new inline status screen must not bypass the static document inventory.
  for (const host of ['desktop/main.js', 'server.mjs']) {
    if (!fs.existsSync(path.join(root, host))) continue;
    const lines = fs.readFileSync(path.join(root, host), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (/(?:data:text\/html\s*[,;]|<!doctype\s+html\b|<html[\s>])/i.test(line)) {
        report(host, index + 1, 'serve a registered application document for this HTML entry');
      }
    });
  }
}
