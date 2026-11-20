import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import postcss from 'postcss';
import { parse, parseFragment } from 'parse5';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const registryFile = 'runtime/design-system/cursors.css';
const appStyle = 'src/index.css';
const sourceExt = /\.[cm]?[jt]sx?$/;
const cursorUtility = /(?:^|[\s:'"`])!?(?:cursor-|\[cursor:)/;
const cursorDeclaration = /(?:^|[;{])\s*cursor\s*:/i;
const gesture = /^(?:on)?(?:click|dblclick|doubleclick|contextmenu|pointerdown|pointerup|mousedown|mouseup|touchstart|touchend|dragstart)$/i;
const interactiveRole = /^(?:button|link|tab|switch|radio|checkbox|option|menuitem(?:radio|checkbox)?|slider|spinbutton|textbox|combobox|treeitem)$/;
const cursorValues = new Set(('auto default none context-menu help pointer progress wait cell crosshair text vertical-text alias copy move no-drop ' +
  'not-allowed grab grabbing all-scroll col-resize row-resize n-resize e-resize s-resize w-resize ne-resize nw-resize se-resize sw-resize ' +
  'ew-resize ns-resize nesw-resize nwse-resize zoom-in zoom-out inherit').split(' '));

function isDragTarget(attrs, handlers) {
  return attrs.get('draggable')?.some(value => value !== null && value !== 'false') || handlers.has('dragstart') ||
    [['pointerdown', 'pointermove'], ['mousedown', 'mousemove'], ['touchstart', 'touchmove']]
      .some(([start, move]) => handlers.has(start) && handlers.has(move));
}

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, child => visit(child, fn));
}

function sources(root, dir, recurse = true) {
  if (!fs.existsSync(path.join(root, dir))) return [];
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(item => {
    const name = path.posix.join(dir, item.name);
    if (item.isFile()) return [name];
    if (!recurse || !item.isDirectory() || ['node_modules', 'dist', 'out', 'build', 'payload', '.git'].includes(item.name)) return [];
    return sources(root, name);
  });
}

function resolveLocal(from, ref) {
  if (!ref || /^(?:[a-z]+:|\/\/)/i.test(ref)) return;
  const url = ref.split(/[?#]/)[0];
  const relative = url.startsWith('/') ? url.slice(1) : path.posix.join(path.posix.dirname(from), url);
  if (relative !== '..' && !relative.startsWith('../')) return relative;
}

function strings(node) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return [node.text];
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return ['-' + node.operand.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return strings(node.expression);
  if (ts.isConditionalExpression(node)) return [...strings(node.whenTrue), ...strings(node.whenFalse)];
  if (ts.isIdentifier(node) && node.text === 'undefined' || node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return [null];
  if (node.kind === ts.SyntaxKind.TrueKeyword) return ['true'];
  return [undefined];
}

function textOf(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => 'DYNAMIC' + span.literal.text).join('');
  return '';
}

// Only unconditional, directly matching selectors confer automatic ownership.
// A cursor on a disabled child, an ancestor, or a drag state cannot register
// the unrelated element that happens to share one of its class names.
function readRegistry(css, report) {
  const roles = new Set(), selectors = new Set();
  css.walkDecls(/^cursor$/i, decl => {
    const value = decl.value.trim();
    if (!cursorValues.has(value)) report(registryFile, decl.source.start.line, 'unsupported cursor value ' + value);
    for (const selector of decl.parent.selectors ?? []) {
      const group = /^:(?:where|is)\(([^()]*)\)$/.exec(selector);
      for (const raw of group ? group[1].split(',') : [selector]) {
        const normalized = raw.trim().replace(/'/g, '"');
        selectors.add(normalized);
        const marker = /^\[data-cursor="([\w-]+)"\]$/.exec(normalized);
        if (marker) roles.add(marker[1]);
      }
    }
  });
  for (const base of ['button', 'a[href]', 'input', 'select', 'summary', 'textarea', 'button:disabled']) {
    if (!selectors.has(base)) report(registryFile, 1, 'missing native cursor registration for ' + base);
  }
  if (!roles.size) report(registryFile, 1, 'register cursor roles with [data-cursor="role"] selectors');
  return { roles, selectors };
}

function checkTarget(tag, attrs, needsCursor, registry, fail, drag = false, trackId = true) {
  if (trackId && attrs.has('id') && /^[a-z]/.test(tag)) {
    for (const id of attrs.get('id')) {
      if (!id || id.includes('DYNAMIC')) continue;
      if (!registry.targets.has(id)) registry.targets.set(id, []);
      registry.targets.get(id).push({ tag, attrs, fail });
    }
  }
  let owned = false;
  if (attrs.has('data-cursor')) {
    const roles = attrs.get('data-cursor');
    for (const role of roles) {
      if (role !== null && !registry.roles.has(role)) fail('unknown or dynamic data-cursor role: ' + (role ?? '(dynamic)'));
    }
    owned = roles.length > 0 && roles.every(role => registry.roles.has(role));
  }
  if (!needsCursor || owned || /^[A-Z]/.test(tag)) return;
  const selectors = registry.selectors;
  if (!drag && (selectors.has(tag) || (tag === 'a' && attrs.has('href') && selectors.has('a[href]')))) return;
  for (const [key, choices] of attrs) {
    if (drag && !['class', 'id'].includes(key) && !key.startsWith('data-')) continue;
    if (choices.length && choices.every(value => value != null) && (selectors.has('[' + key + ']') || selectors.has(tag + '[' + key + ']'))) return;
    if (choices.length && choices.every(value => typeof value === 'string' && (
      selectors.has('[' + key + '="' + value + '"]') || selectors.has(tag + '[' + key + '="' + value + '"]') ||
      key === 'id' && selectors.has('#' + value) ||
      key === 'class' && value.split(/\s+/).some(cls => selectors.has('.' + cls))))) return;
  }
  fail('<' + tag + '> interactive target has no cursor registration; use a registered native control or data-cursor role');
}

function checkCss(text, fail) {
  const css = postcss.parse(text);
  css.walkDecls(/^cursor$/i, decl => fail(decl.source.start.line, 'cursor declarations belong in ' + registryFile));
  css.walkAtRules('apply', rule => {
    if (cursorUtility.test(rule.params)) fail(rule.source.start.line, 'use a registered cursor role instead of a cursor utility');
  });
  return css;
}

function jsxValue(attr) {
  if (!attr.initializer) return;
  return ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : attr.initializer;
}

function checkSource(file, content, registry, report, html) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const line = node => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const fail = (node, message) => report(file, line(node), message);
  const scopes = new Map();
  const domElements = new Map();
  visit(source, node => {
    const value = ts.isVariableDeclaration(node) ? node.initializer : ts.isFunctionDeclaration(node) ? node : null;
    if (value && node.name && ts.isIdentifier(node.name)) {
      let owner = node.parent;
      while (!ts.isBlock(owner) && !ts.isSourceFile(owner)) owner = owner.parent;
      if (!scopes.has(owner)) scopes.set(owner, new Map());
      scopes.get(owner).set(node.name.text, value);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ['createElement', 'createElementNS'].includes(node.expression.name.text) &&
      /(?:document|Document)$/.test(node.expression.expression.getText())) {
      const tag = node.arguments[node.expression.name.text === 'createElement' ? 0 : 1];
      if (tag && ts.isStringLiteralLike(tag)) domElements.set(node, { tag: tag.text, attrs: new Map(), handlers: new Set() });
    }
  });
  function resolve(node, seen = new Set()) {
    if (!node || !ts.isIdentifier(node) || seen.has(node)) return node;
    seen.add(node);
    for (let scope = node.parent; scope; scope = scope.parent) {
      const declaration = scopes.get(scope)?.get(node.text);
      if (declaration) return resolve(declaration, seen);
    }
    return node;
  }
  function classChoices(expr) {
    if (!ts.isTemplateExpression(expr)) return strings(expr);
    let results = [expr.head.text];
    for (const span of expr.templateSpans) {
      let values = strings(resolve(span.expression));
      if (ts.isIdentifier(span.expression)) {
        for (let owner = span.parent; owner; owner = owner.parent) {
          if (!ts.isFunctionLike(owner) || owner.parameters[0]?.name.getText() !== span.expression.text) continue;
          const call = owner.parent;
          if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'map') {
            let array = resolve(call.expression.expression);
            while (ts.isAsExpression(array) || ts.isParenthesizedExpression(array) || ts.isSatisfiesExpression(array)) array = resolve(array.expression);
            if (ts.isArrayLiteralExpression(array)) values = array.elements.flatMap(item => strings(resolve(item)));
          }
          break;
        }
      }
      if (results.length * values.length > 64) return [textOf(expr)];
      results = results.flatMap(prefix => values.map(value => prefix + (value ?? 'DYNAMIC') + span.literal.text));
    }
    return results;
  }
  function barrier(handler) {
    const fn = resolve(handler);
    if (!fn || !ts.isFunctionLike(fn) || !fn.body) return false;
    const onlyStop = node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ['stopPropagation', 'preventDefault'].includes(node.expression.name.text) && !node.arguments.length;
    function statement(s) {
      if (ts.isBlock(s)) return s.statements.every(statement);
      if (ts.isIfStatement(s)) return statement(s.thenStatement) && (!s.elseStatement || statement(s.elseStatement));
      return ts.isExpressionStatement(s) && onlyStop(s.expression);
    }
    return ts.isBlock(fn.body) ? statement(fn.body) : onlyStop(fn.body);
  }
  function checkStyle(node, seen = new Set()) {
    node = resolve(node);
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isSpreadAssignment(prop)) checkStyle(prop.expression, seen);
        else if (prop.name?.text === 'cursor') fail(prop, 'inline cursor bypasses the cursor registry');
      }
    } else if (ts.isConditionalExpression(node)) {
      checkStyle(node.whenTrue, seen);
      checkStyle(node.whenFalse, seen);
    } else if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) checkStyle(node.expression, seen);
    else if (ts.isCallExpression(node)) {
      const fn = resolve(node.expression);
      if (fn && ts.isFunctionLike(fn) && fn.body) {
        if (ts.isBlock(fn.body)) visit(fn.body, child => { if (ts.isReturnStatement(child)) checkStyle(child.expression, seen); });
        else checkStyle(fn.body, seen);
      }
    }
  }
  const rawCssBindings = new Set(source.statements.filter(node => ts.isImportDeclaration(node) &&
    node.moduleSpecifier.text.endsWith('?raw') && resolveLocal(file, node.moduleSpecifier.text) === registryFile).map(node => node.importClause?.name?.text));
  function host(node, tag, properties) {
    const attrs = new Map();
    const handlers = new Set();
    let action = false;
    function addProp(key, value) {
      if (key === 'style') checkStyle(value);
      if (key === 'cursor' && /^[a-z]/.test(tag)) fail(node, 'SVG cursor must use a registered role');
      if (/^on/i.test(key) && !barrier(value)) {
        handlers.add(key.toLowerCase().slice(2));
        if (gesture.test(key)) action = true;
      }
      const expr = resolve(value);
      let choices = expr ? strings(expr) : ['true'];
      if (key === 'className' && expr) choices = classChoices(expr);
      attrs.set(key === 'className' ? 'class' : key.toLowerCase(), choices);
    }
    const seen = new Set();
    function collect(attrsList) {
      if (seen.has(attrsList)) return;
      seen.add(attrsList);
      for (const attr of attrsList) {
        if (ts.isJsxAttribute(attr)) addProp(attr.name.getText(), jsxValue(attr));
        else if (ts.isPropertyAssignment(attr) || ts.isShorthandPropertyAssignment(attr) || ts.isMethodDeclaration(attr)) {
          addProp(attr.name.text ?? '', attr.initializer ?? attr.name);
        } else if (ts.isJsxSpreadAttribute(attr) || ts.isSpreadAssignment(attr)) {
          const spread = resolve(attr.expression);
          if (spread && ts.isObjectLiteralExpression(spread)) collect(spread.properties);
          else action = true;
        }
      }
    }
    collect(properties);
    const drag = isDragTarget(attrs, handlers);
    if (drag) action = true;
    if (attrs.get('role')?.some(role => interactiveRole.test(role))) action = true;
    // A conditional tab stop only needs pre[tabindex] while the attribute
    // is present. Independent click/drag handlers still need a base rule.
    if (!action && !registry.selectors.has(tag + '[tabindex]') &&
        attrs.get('tabindex')?.some(v => v !== null && (v === undefined || Number(v) >= 0))) action = true;
    checkTarget(tag, attrs, action, registry, message => fail(node, message), drag);
  }
  function recordListener(receiver, event) {
    const lookup = resolve(receiver);
    if (!lookup || !ts.isCallExpression(lookup) || !ts.isPropertyAccessExpression(lookup.expression)) return;
    const name = lookup.expression.name.text, selector = lookup.arguments[0] && textOf(resolve(lookup.arguments[0]));
    if (!selector) return;
    const id = name === 'getElementById' ? selector : name === 'querySelector' && /^#[\w-]+$/.test(selector) ? selector.slice(1) : null;
    if (id) {
      if (!registry.listeners.has(id)) registry.listeners.set(id, new Set());
      registry.listeners.get(id).add(event);
    }
  }
  visit(source, node => {
    // Exported style constants can be applied to a control in another module.
    if (ts.isPropertyAssignment(node) && (node.name.text === 'cursor' ||
        ts.isComputedPropertyName(node.name) && textOf(resolve(node.name.expression)) === 'cursor') &&
        strings(resolve(node.initializer)).some(v => cursorValues.has(v))) fail(node, 'inline cursor bypasses the cursor registry');
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) host(node, node.tagName.getText(), node.attributes.properties);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = node.left;
      const key = ts.isPropertyAccessExpression(lhs) ? lhs.name.text : ts.isElementAccessExpression(lhs) ? textOf(lhs.argumentExpression) : '';
      if (key === 'cursor' && /(?:\.style\b|\[['"]style['"]\])/.test(resolve(lhs.expression)?.getText() ?? '')) fail(node, 'imperative style.cursor bypasses the cursor registry');
      if (key === 'cssText' && cursorDeclaration.test(textOf(resolve(node.right)))) fail(node, 'cssText contains an unregistered cursor');
      if (key === 'cursor' && ts.isPropertyAccessExpression(lhs) && /\.dataset$/.test(lhs.expression.getText())) {
        checkTarget('element', new Map([['data-cursor', strings(resolve(node.right))]]), false, registry, message => fail(node, message));
        domElements.get(resolve(lhs.expression.expression))?.attrs.set('data-cursor', strings(resolve(node.right)));
      } else if (ts.isPropertyAccessExpression(lhs)) {
        const event = key.startsWith('on') && !barrier(node.right) ? key.slice(2).toLowerCase() : null;
        if (event) recordListener(lhs.expression, event);
        const el = domElements.get(resolve(lhs.expression));
        if (el) {
          if (event) el.handlers.add(event);
          el.attrs.set(key === 'className' ? 'class' : key.toLowerCase(), strings(resolve(node.right)));
        }
      }
    } else if (ts.isCallExpression(node)) {
      const receiver = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression : undefined;
      const method = receiver ? node.expression.name.text : node.expression.getText();
      const [name, value] = node.arguments;
      const key = name && textOf(resolve(name));
      if (method === 'createElement' && key && value && !domElements.has(node)) {
        const props = resolve(value);
        if (ts.isObjectLiteralExpression(props)) host(node, key, props.properties);
        else if (props.kind !== ts.SyntaxKind.NullKeyword) checkTarget(key, new Map(), true, registry, m => fail(node, m));
      }
      const el = domElements.get(resolve(receiver));
      if (method === 'addEventListener' && key && !barrier(value)) {
        if (el) el.handlers.add(key);
        recordListener(receiver, key);
      }
      if (el && method === 'setAttribute' && key) el.attrs.set(key.toLowerCase(), strings(resolve(value)));
      if (method === 'assign' && name && /\.style\b/.test(name.getText())) for (const argument of node.arguments.slice(1)) checkStyle(argument);
      if (['setProperty', 'setAttribute'].includes(method) && key === 'cursor') fail(node, 'imperative cursor bypasses the cursor registry');
      if (method === 'setAttribute' && key === 'style' && value && cursorDeclaration.test(textOf(resolve(value)))) fail(node, 'style contains an unregistered cursor');
      if (method === 'setAttribute' && key === 'data-cursor') {
        checkTarget('element', new Map([['data-cursor', strings(resolve(value))]]), false, registry, message => fail(node, message));
      }
    }
    const text = textOf(node);
    if (!text) return;
    if (cursorUtility.test(text)) fail(node, 'cursor utility bypasses the cursor registry');
    if (/^\s*<[a-z!]/i.test(text)) {
      html(file, text, line(node), false);
      const originalDocument = file === 'src/lib/html-material.ts' && /data-type-surface=["']document-frame["']/.test(text);
      if (/<!doctype\s+html|<html[\s>]/i.test(text) && !originalDocument) {
        let prefix = ts.isTemplateExpression(node) ? node.head.text : '';
        let embedded = false;
        if (ts.isTemplateExpression(node)) for (const span of node.templateSpans) {
          if (prefix.lastIndexOf('<style>') > prefix.lastIndexOf('</style>') && ts.isIdentifier(span.expression) && rawCssBindings.has(span.expression.text)) embedded = true;
          prefix += span.literal.text;
        }
        if (!embedded) fail(node, 'standalone application HTML must embed the registered cursor stylesheet');
      }
    }
  });
  for (const [node, el] of domElements) {
    const drag = isDragTarget(el.attrs, el.handlers);
    checkTarget(el.tag, el.attrs, drag || [...el.handlers].some(event => gesture.test(event)), registry, message => fail(node, message), drag);
  }
}

export function checkCursors(root = rootDir) {
  const errors = new Set();
  const report = (file, line, text) => errors.add(file + ':' + line + ': ' + text);
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  try {
    const registry = { ...readRegistry(postcss.parse(read(registryFile)), report), targets: new Map(), listeners: new Map() };
    const hasImport = (css, from, wanted) => css.nodes.some(rule => rule.type === 'atrule' && rule.name === 'import' &&
      resolveLocal(from, /^["']([^"']+)["']/.exec(rule.params)?.[1]) === wanted);
    if (!hasImport(postcss.parse(read(appStyle)), appStyle, registryFile)) report(appStyle, 1, 'must import ' + registryFile);
    const scannedSheets = new Set([registryFile]);
    function checkLinkedCss(file) {
      if (!file || scannedSheets.has(file) || !fs.existsSync(path.join(root, file))) return;
      scannedSheets.add(file);
      const css = checkCss(read(file), (line, msg) => report(file, line, msg));
      css.walkAtRules('import', rule => {
        const ref = /^(?:url\(\s*)?['"]?([^"'()\s]+)/.exec(rule.params)?.[1];
        if (ref?.endsWith('.css')) checkLinkedCss(resolveLocal(file, ref));
      });
    }
    function html(file, text, start, standalone) {
      let loaded = false;
      const inspect = node => {
        if (node.tagName) {
          const attrs = new Map(node.attrs.map(({ name, value }) => [name, [value]]));
          const attr = key => attrs.get(key)?.[0];
          const loc = start + (node.sourceCodeLocation?.startLine ?? 1) - 1;
          const fail = message => report(file, loc, message);
          if (attr('style') && cursorDeclaration.test(attr('style'))) fail('inline CSS cursor bypasses the cursor registry');
          if (attr('class') && cursorUtility.test(attr('class'))) fail('cursor utility bypasses the cursor registry');
          if (attrs.has('cursor')) fail('SVG cursor must use a registered role');
          const handlers = new Set([...attrs.keys()].filter(key => key.startsWith('on')).map(key => key.slice(2)));
          const drag = isDragTarget(attrs, handlers);
          const action = [...attrs.keys()].some(name => gesture.test(name)) || drag ||
            attrs.has('tabindex') && Number(attr('tabindex')) >= 0 || interactiveRole.test(attr('role'));
          checkTarget(node.tagName, attrs, action, registry, fail, drag);
          if (node.tagName === 'style') {
            const body = node.childNodes.map(child => child.value).join('');
            if (standalone || cursorDeclaration.test(body) || /@apply\s/.test(body)) {
              const css = checkCss(standalone ? body : body.replaceAll('DYNAMIC', ''), (line, msg) => report(file, loc + line - 1, msg));
              loaded ||= hasImport(css, file, registryFile) || hasImport(css, file, appStyle);
            }
          }
          if (node.tagName === 'link' && attr('rel') === 'stylesheet') {
            const sheet = resolveLocal(file, attr('href'));
            if (sheet === registryFile || sheet === appStyle) loaded = true;
            checkLinkedCss(sheet);
          }
          if (standalone && node.tagName === 'script' && attr('src')) {
            const script = resolveLocal(file, attr('src'));
            if (script && fs.existsSync(path.join(root, script))) {
              const code = read(script);
              if (!/^(?:src|public)\//.test(script)) checkSource(script, code, registry, report, html);
              if (attr('type') === 'module') loaded ||= ts.preProcessFile(code).importedFiles.some(ref => resolveLocal(script, ref.fileName) === appStyle);
            }
          }
          if (standalone && node.tagName === 'script') {
            const inline = node.childNodes.map(child => child.value).join('');
            if (inline.trim()) checkSource(file, inline, registry, (f, line, msg) => report(f, loc + line - 1, msg), html);
          }
        }
        for (const child of node.childNodes ?? []) inspect(child);
        if (node.content) inspect(node.content);
      };
      const parser = standalone || /<!doctype\s+html|<html[\s>]/i.test(text) ? parse : parseFragment;
      inspect(parser(text, { sourceCodeLocationInfo: true }));
      if (standalone && !loaded) report(file, 1, 'application document must load its registered cursor stylesheet');
    }
    const files = [...sources(root, '.', false).filter(f => /\.html?$/.test(f)), ...['src', 'runtime', 'public', 'desktop'].flatMap(dir => sources(root, dir))];
    for (const file of files) {
      if (/\.html?$/i.test(file)) html(file, read(file), 1, true);
      else if (file.endsWith('.css')) checkLinkedCss(file);
      else if ((file.startsWith('src/') || file.startsWith('public/')) && sourceExt.test(file)) checkSource(file, read(file), registry, report, html);
    }
    for (const [id, handlers] of registry.listeners) for (const host of registry.targets.get(id) ?? []) {
      const drag = isDragTarget(host.attrs, handlers);
      if (drag || [...handlers].some(event => gesture.test(event))) checkTarget(host.tag, host.attrs, true, registry, host.fail, drag, false);
    }
  } catch (error) {
    errors.add('Cursor registry check failed: ' + error.message);
  }
  return [...errors];
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const errors = checkCursors();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('PASS cursor registrations and interaction targets');
}
