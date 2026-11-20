import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import postcss from 'postcss';
import { checkTypographyHtml } from './check-typography-html.mjs';
import { makeRenderCheck } from './check-typography-render.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const registryFile = 'src/design-system/typography-registry.json';
const surfaceCss = 'src/design-system/typography-surfaces.css';
const codeExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const attrName = 'data-type-surface';

function sourceFiles(root, directory = 'src') {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const name = directory + '/' + entry.name;
    if (entry.isDirectory()) return sourceFiles(root, name);
    return entry.isFile() && (codeExtension.test(name) || name.endsWith('.css')) ? [name] : [];
  }).sort();
}

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, child => visit(child, fn));
}

const importedRenderNames = new WeakMap();
function calleeName(call) {
  const expression = call.expression;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (!ts.isIdentifier(expression)) return '';
  const source = call.getSourceFile();
  if (!importedRenderNames.has(source)) {
    const aliases = new Map();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !['react', 'react-dom', 'react-dom/client'].includes(statement.moduleSpecifier.text)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const spec of bindings.elements) aliases.set(spec.name.text, spec.propertyName?.text ?? spec.name.text);
    }
    importedRenderNames.set(source, aliases);
  }
  return importedRenderNames.get(source).get(expression.text) ?? expression.text;
}

function literalText(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map(part => part.literal.text)].join('${…}');
  return '';
}

function renderSite(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) return true;
  // React components may return text without ever emitting a JSX element.
  if (ts.isReturnStatement(node) && node.expression && (ts.isStringLiteralLike(node.expression) ||
      ts.isTemplateExpression(node.expression) || ts.isNumericLiteral(node.expression)) && /^[A-Z]/.test(renderOwner(node))) return true;
  if ((ts.isArrowFunction(node) && !ts.isBlock(node.body) || ts.isReturnStatement(node) && node.expression) &&
      /\.[jt]sx$/.test(node.getSourceFile().fileName)) {
    const value = ts.isArrowFunction(node) ? node.body : node.expression;
    if ([ts.SyntaxKind.NullKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.TrueKeyword].includes(value.kind) ||
        (ts.isIdentifier(value) && value.text === 'undefined')) return false;
    let fn = node;
    while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
    if (!fn) return false;
    const binding = ts.isVariableDeclaration(fn.parent) ? fn.parent : fn;
    const name = binding.name && ts.isIdentifier(binding.name) ? binding.name.text : '';
    // A named JSX component may simply return a prop, prebuilt element,
    // or string. Private all-uppercase callbacks are also used for data keys.
    if (/^[A-Z]/.test(name) && (/[a-z]/.test(name) ||
        binding.parent?.parent?.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))) return true;
  }
  if (/^\s*<(?:!doctype\s+html|[a-z][a-z\d]*(?:\s+[^<>]*|\/?)>)/i.test(literalText(node))) return true;
  if (ts.isCallExpression(node)) {
    return ['createElement', 'createElementNS', 'createPortal', 'createRoot', 'insertAdjacentHTML', 'fillText', 'strokeText'].includes(calleeName(node));
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)) {
    return ['innerHTML', 'outerHTML', 'textContent', 'innerText', 'srcdoc'].includes(node.left.name.text);
  }
  return false;
}

// A named component, a top-level render helper or the module's bootstrap owns
// its render sites. Inline map callbacks remain part of their enclosing view.
function renderOwner(node) {
  let owner = '(module)';
  for (let parent = node; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) ||
        ts.isClassDeclaration(parent) || ts.isVariableDeclaration(parent)) && parent.name && ts.isIdentifier(parent.name)) {
      const name = parent.name.text;
      if (/^[A-Z]/.test(name)) return name;
      owner = name;
    }
    if (ts.isFunctionDeclaration(parent) && !parent.name && ts.isSourceFile(parent.parent)) return 'default';
  }
  return owner;
}

function parse(file, contents) {
  return ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);
}

function owners(source) {
  const result = new Map();
  visit(source, node => {
    if (!renderSite(node)) return;
    const name = renderOwner(node);
    if (!result.has(name)) result.set(name, node);
  });
  return result;
}

export function inventoryTypography(root = projectRoot) {
  const modules = {};
  for (const file of sourceFiles(root).filter(file => codeExtension.test(file))) {
    const ast = parse(file, fs.readFileSync(path.join(root, file), 'utf8'));
    const names = [...owners(ast).keys()].sort();
    if (names.length) modules[file] = names;
  }
  return modules;
}

function attribute(node, name) {
  return node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText() === name);
}

function attrValue(attr) {
  if (!attr?.initializer) return '';
  return ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : attr.initializer;
}

function stringChoices(expr) {
  if (!expr) return [];
  if (ts.isJsxExpression(expr)) return stringChoices(expr.expression);
  if (ts.isStringLiteralLike(expr)) return [expr.text];
  if (ts.isParenthesizedExpression(expr)) return stringChoices(expr.expression);
  if (ts.isConditionalExpression(expr)) return [...stringChoices(expr.whenTrue), ...stringChoices(expr.whenFalse)];
  return [null];
}

function classNames(node) {
  const value = attrValue(attribute(node, 'className'));
  if (!value) return new Set();
  const names = new Set();
  visit(value, child => {
    if (ts.isStringLiteralLike(child) || ts.isTemplateHead(child) || ts.isTemplateMiddle(child) || ts.isTemplateTail(child)) {
      for (const name of child.text.split(/\s+/)) if (name) names.add(name);
    }
  });
  return names;
}

function matchesAnchor(node, anchor) {
  if (anchor.startsWith('.')) return classNames(node).has(anchor.slice(1));
  if (anchor.startsWith('#')) return stringChoices(attrValue(attribute(node, 'id'))).includes(anchor.slice(1));
  const data = /^\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(anchor);
  if (data) {
    const attr = attribute(node, data[1]);
    return !!attr && (!data[2] || stringChoices(attrValue(attr)).includes(data[2]));
  }
  return node.tagName.getText() === anchor;
}

function nearestSurface(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent)) {
      if (parent.openingElement === node || parent.openingElement === node.parent) continue;
      const attr = attribute(parent.openingElement, attrName);
      if (attr) return stringChoices(attrValue(attr));
    }
  }
  return [];
}

const policyPattern = /\[data-type-surface\s*=\s*["']?([\w-]+)["']?\]/g;
const fontUtility = /(?:^|[:\s'"`])!?text-(2xs|xs|sm|base|lg|xl|[2-9]xl|\[(?:length:|(?:calc|min|max|clamp)\(|[-.\d]+(?:px|em|rem|%|pt|vw|vh))[^\]]*\])(?=$|[/!:\s'"`])/g;
const geometryPolicies = new Set(['canvas-geometry', 'canvas-viewport']);
const isScale = value => /\bscale(?:[XYZ]|3d)?\(/i.test(value);
const scaledUtility = /(?:^|:)!?(?:(?:zoom|scale(?:-[xyz])?)-|\[(?:zoom|scale|transform):)/;
const inlineTypeUtility = /(?:^|:)!?\[(?:font-size|font|--text-[\w-]+|--canvas-[\w-]*(?:scale|compensation)):|(?:^|:)!?text-\[(?:length:|(?:[0-9.]+(?:px|em|rem|pt|%|vw|vh)))/;
const protectedVariable = name => typeof name === 'string' &&
  /^(?:--text-[\w-]+|--ui-scale|--overview-zoom|--canvas-(?:conversation-scale|summary-type-scale|summary-compensation|compact-compensation))$/.test(name);

function arbitraryFontUtility(token) {
  const custom = /(?:^|:)!?text-\[([^\]]+)\]/.exec(token)?.[1];
  if (!custom) return /(?:^|:)!?text-\(length:/.test(token);
  return !/^(?:(?:color:)|#|(?:rgba?|hsla?|oklch|oklab|color(?:-mix)?|hwb|lab|lch)\(|var\(--color-)/i.test(custom);
}

function unregisteredUtility(token, geometry = false) {
  return [...token.matchAll(fontUtility)].length > 0 || inlineTypeUtility.test(token) ||
    arbitraryFontUtility(token) || (!geometry && scaledUtility.test(token));
}

function activeInteriorScales(rules, policy) {
  const levels = new Set();
  if (geometryPolicies.has(policy) || policy === 'screen') return levels;
  for (const rule of rules.get(policy) ?? []) {
    if (!rule.nodes.some(decl => ((decl.prop === 'zoom' || decl.prop === 'scale') && !['1', 'inherit'].includes(decl.value)) ||
        (decl.prop === 'transform' && /\bscale(?:[XYZ]|3d)?\(/i.test(decl.value)))) continue;
    for (const selector of rule.selectors) {
      const surfaces = [...selector.matchAll(policyPattern)];
      if (surfaces.at(-1)?.[1] !== policy) continue;
      if (/\[data-node-detail-level=["']full["']\]/.test(selector)) levels.add('full');
      else if (selector.includes('[data-node-overview-surface')) levels.add('overview');
      else { levels.add('full'); levels.add('overview'); }
    }
  }
  return levels;
}

function readRegistration(root, diagnostics) {
  const load = filename => JSON.parse(fs.readFileSync(path.join(root, filename), 'utf8'));
  const registry = load(registryFile);
  const boundaries = { ...registry.boundaries };
  for (const section of ['canvas', 'interface']) {
    const file = 'src/design-system/typography-' + section + '.json';
    if (!fs.existsSync(path.join(root, file))) continue;
    const extra = load(file);
    for (const [module, anchors] of Object.entries(extra.boundaries ?? {})) {
      const merged = { ...boundaries[module] };
      for (const [anchor, policy] of Object.entries(anchors)) {
        if (Object.hasOwn(merged, anchor)) diagnostics.push(file + ': duplicate registration ' + module + ' ' + anchor);
        merged[anchor] = policy;
      }
      boundaries[module] = merged;
    }
    registry.documents = { ...registry.documents, ...extra.documents };
  }
  return { ...registry, boundaries };
}

function centralStyles(root, diagnostics) {
  const rules = new Map();
  const ruleFiles = new Map();
  const sheets = new Set();
  function read(file) {
    if (sheets.has(file)) return;
    sheets.add(file);
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) { diagnostics.push(file + ': missing central typography stylesheet'); return; }
    const css = postcss.parse(fs.readFileSync(abs, 'utf8'), { from: abs });
    css.walkAtRules('import', decl => {
      const imported = /^["'](\.[^"']+\.css)["']/.exec(decl.params)?.[1];
      if (imported) read(path.posix.normalize(path.posix.join(path.posix.dirname(file), imported)));
    });
    css.walkRules(rule => {
      if (!rule.nodes.some(node => node.type === 'decl' && (
        ['font-size', 'font', 'zoom', 'scale', '--overview-zoom'].includes(node.prop) ||
        (node.prop === 'transform' && isScale(node.value))))) return;
      for (const selector of rule.selectors) {
        for (const match of selector.matchAll(policyPattern)) {
          // A viewport ancestor in a toolbar selector doesn't itself receive
          // the toolbar's scale. Keep :where([a], [b]) alternatives together.
          const tail = selector.slice(match.index + match[0].length);
          if (/^[\s>+~]+[^,]*\[data-type-surface/.test(tail)) continue;
          const policy = match[1];
          if (!rules.has(policy)) rules.set(policy, []);
          rules.get(policy).push(rule);
          ruleFiles.set(rule, abs);
        }
      }
    });
  }
  read(surfaceCss);
  return { root, rules, sheets, ruleFiles };
}

function validFont(value, roles) {
  if (value.trim() === 'inherit') return true;
  const token = /^var\(\s*--text-([\w-]+)\s*\)$/.exec(value.trim());
  return !!token && roles.has(token[1]);
}

function checkStyleSheet(file, css, roles, central, report) {
  css.walkAtRules('apply', rule => {
    for (const utility of rule.params.split(/\s+/)) if (unregisteredUtility(utility)) {
      report(file, rule.source.start.line, '@apply uses unregistered typography utility ' + utility);
    }
  });
  css.walkDecls(decl => {
    const prop = decl.prop.toLowerCase();
    if (protectedVariable(prop)) {
      const themeToken = file === 'src/index.css' && decl.parent.type === 'atrule' && decl.parent.name === 'theme' && prop.startsWith('--text-');
      const density = file === 'src/index.css' && decl.parent.selector === ':root' && prop === '--ui-scale';
      if (!central && !themeToken && !density) report(file, decl.source.start.line, prop + ' can only be defined by the typography system');
      if (themeToken) {
        const name = prop.slice(7).replace(/--line-height$/, '');
        const alias = /^var\(--text-([\w-]+?)((?:--line-height)?)\)$/.exec(decl.value);
        if (!roles.has(name) && !(alias && roles.has(alias[1]))) report(file, decl.source.start.line, 'unregistered role definition: ' + prop);
      }
    }
    const scale = prop === 'scale' || (prop === 'transform' && isScale(decl.value));
    if (!scale && !['font', 'font-size', 'zoom'].includes(prop)) return;
    // The minimap hover enlarges a text-free third-party SVG. Transient
    // keyframes never own a text surface's steady-state screen size.
    if (scale && decl.parent.selector === '.react-flow__minimap:hover') return;
    if (scale && decl.parent.selectors?.every(s => /(?:^|[\s>+~])(?:path|circle|rect|line|ellipse|polygon|polyline)(?:[.#:\[][\w\-="')\]]+)*$/.test(s))) return;
    if (scale && decl.parent.parent?.type === 'atrule' && decl.parent.parent.name.endsWith('keyframes')) return;
    if (central && decl.parent.selectors?.every(selector => [...selector.matchAll(policyPattern)].length)) return;
    if (prop === 'font-size' ? validFont(decl.value, roles) : decl.value === 'inherit') return;
    report(file, decl.source.start.line, prop + ': ' + decl.value + ' must use a registered typography role or surface rule');
  });
}

function surface(node) { return stringChoices(attrValue(attribute(node, attrName))); }

function usesPosterFonts(node) {
  if (ts.isConditionalExpression(node)) return usesPosterFonts(node.whenTrue) && usesPosterFonts(node.whenFalse);
  if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) return false;
  return node.getSourceFile().statements.some(statement => ts.isImportDeclaration(statement) &&
    /(?:^|\/)design-system\/poster-typography(?:\.[jt]s)?$/.test(statement.moduleSpecifier.text) &&
    statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) &&
    statement.importClause.namedBindings.elements.some(spec => (spec.propertyName?.text ?? spec.name.text) === 'posterFonts' && spec.name.text === node.expression.text));
}

function projectCode(file, source, registry, styles, trace, report) {
  const line = node => 1 + source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const fail = (node, reason) => report(file, line(node), reason);
  const declared = new Set(registry.modules?.[file] ?? []);
  const actual = owners(source);
  for (const [name, node] of actual) if (!declared.has(name)) fail(node, name + ' renders UI without a typography registration');
  for (const name of declared) if (!actual.has(name)) fail(source, 'registered UI owner no longer exists: ' + name);
  const anchors = Object.entries(registry.boundaries?.[file] ?? {});
  const found = new Set();
  const roles = new Set(registry.roles);
  // Resolve common style={local} and {...local} forms with actual AST
  // declarations, as well as style objects written directly at the call site.
  const locals = new Map();
  visit(source, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) locals.set(node.name.text, node.initializer);
    if (ts.isFunctionDeclaration(node) && node.name) locals.set(node.name.text, node);
  });
  function inlineStyle(value, geometry, seen = new Set()) {
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (ts.isIdentifier(value)) return inlineStyle(locals.get(value.text), geometry, seen);
    if (ts.isCallExpression(value)) {
      const callee = value.expression;
      return inlineStyle(ts.isIdentifier(callee) ? locals.get(callee.text) : undefined, geometry, seen);
    }
    if (ts.isFunctionLike(value) && value.body) {
      if (!ts.isBlock(value.body)) return inlineStyle(value.body, geometry, seen);
      function returns(part) {
        if (ts.isReturnStatement(part)) inlineStyle(part.expression, geometry, seen);
        else if (!ts.isFunctionLike(part)) ts.forEachChild(part, returns);
      }
      returns(value.body);
      return;
    }
    if (ts.isConditionalExpression(value)) { inlineStyle(value.whenTrue, geometry, seen); inlineStyle(value.whenFalse, geometry, seen); }
    if (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) return inlineStyle(value.expression, geometry, seen);
    if (!ts.isObjectLiteralExpression(value)) return;
    for (const prop of value.properties) {
      if (ts.isSpreadAssignment(prop)) { inlineStyle(prop.expression, geometry, seen); continue; }
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
      const name = prop.name.text;
      const expression = ts.isPropertyAssignment(prop) ? prop.initializer : locals.get(name);
      const str = expression ? literalText(expression) : '';
      const scale = name === 'scale' || (name === 'transform' && isScale(str));
      if ((scale && !geometry) || name === 'zoom' || (name === 'font' && str !== 'inherit') ||
          (name === 'fontSize' && !validFont(str, roles)) || protectedVariable(name)) {
        fail(prop, 'inline ' + name + ' bypasses the typography registry');
      }
    }
  }
  function geometricText(node, policy) {
    const issue = trace(node);
    if (issue) {
      const location = issue.getSourceFile();
      const origin = location.fileName + ':' + (1 + location.getLineAndCharacterOfPosition(issue.getStart()).line);
      fail(node, policy + ' contains text without a registered destination surface (' + origin + ')');
    }
  }
  function imperativeClasses(expression) {
    const value = ts.isIdentifier(expression) ? locals.get(expression.text) : expression;
    if (!value) return;
    visit(value, part => {
      for (const token of literalText(part).split(/\s+/)) {
        if (unregisteredUtility(token)) fail(part, 'unregistered DOM typography utility: ' + token);
      }
    });
  }
  visit(source, node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const marker = attribute(node, attrName);
      const policy = stringChoices(attrValue(marker));
      let matched = false;
      for (const [anchor, wanted] of anchors) {
        if (!matchesAnchor(node, anchor)) continue;
        matched = true;
        found.add(anchor);
        const expected = Array.isArray(wanted) ? wanted : [wanted];
        if (!marker || !policy.length || policy.some(id => !expected.includes(id)) || expected.some(id => !policy.includes(id))) {
          fail(node, anchor + ' must use ' + attrName + '="' + expected.join('|') + '"');
        }
      }
      if (marker) {
        if (!matched) fail(marker, 'surface marker has no matching registered element in ' + file);
        if (!policy.length || policy.some(id => !id || !styles.rules.has(id))) fail(marker, 'unknown or unstyled typography surface: ' + (policy.join('|') || '(empty)'));
        if (policy.some(id => geometryPolicies.has(id)) && ts.isJsxElement(node.parent)) {
          for (const child of node.parent.children) geometricText(child, policy.join('|'));
        }
        if (policy.includes('canvas-viewport')) {
          for (const name of ['nodeTypes', 'edgeTypes']) {
            const renderers = attrValue(attribute(node, name));
            if (renderers) geometricText(renderers, name);
          }
        }
        const parent = nearestSurface(node);
        if (policy.some(id => parent.some(outer => [...activeInteriorScales(styles.rules, id)].some(level =>
          activeInteriorScales(styles.rules, outer).has(level))))) {
          fail(marker, 'nested ' + policy.join('|') + ' applies its scale twice');
        }
      }
      const props = node.attributes.properties;
      // Scaling a text-free SVG shape or icon changes its geometry. A
      // wrapper containing visible labels still goes through the text rules.
      const tag = node.tagName.getText();
      const svgShape = /^(?:path|circle|rect|polygon|polyline|ellipse|line)$/.test(tag);
      const svgOnly = tag === 'svg' && ts.isJsxElement(node.parent) && !trace(node.parent);
      const icon = source.statements.some(s => ts.isImportDeclaration(s) && s.moduleSpecifier.text === 'lucide-react' &&
        s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) &&
        s.importClause.namedBindings.elements.some(part => part.name.text === tag));
      const pureGeometry = svgShape || svgOnly || icon;
      const classValue = attrValue(attribute(node, 'className'));
      const classes = classNames(node);
      if (classValue && ts.isIdentifier(classValue) && locals.has(classValue.text)) {
        visit(locals.get(classValue.text), child => { for (const token of literalText(child).split(/\s+/)) classes.add(token); });
      }
      for (const token of classes) {
        if (unregisteredUtility(token, pureGeometry)) fail(node, 'unregistered typography utility: ' + token);
      }
      const style = attrValue(attribute(node, 'style'));
      if (style) inlineStyle(style, pureGeometry);
      for (const prop of props) {
        if (ts.isJsxSpreadAttribute(prop) && ts.isObjectLiteralExpression(prop.expression)) {
          for (const entry of prop.expression.properties) if (ts.isPropertyAssignment(entry) && entry.name.text === 'style') inlineStyle(entry.initializer, pureGeometry);
        }
      }
      if (/^[a-z]/.test(node.tagName.getText()) && attribute(node, 'fontSize')) {
        const expr = attrValue(attribute(node, 'fontSize'));
        if (!expr || !validFont(literalText(expr), roles)) fail(node, 'SVG fontSize must use a registered role or surface');
      }
      if (/^[a-z]/.test(node.tagName.getText()) && attribute(node, 'font-size')) {
        const expr = attrValue(attribute(node, 'font-size'));
        if (!expr || !validFont(literalText(expr), roles)) fail(node, 'SVG font-size must use a registered role or surface');
      }
    } else if (ts.isCallExpression(node) && calleeName(node) === 'createPortal') {
      geometricText(node.arguments[0], 'createPortal');
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === 'classList' &&
        ['add', 'toggle', 'replace'].includes(calleeName(node))) {
      for (const value of node.arguments.slice(calleeName(node) === 'replace' ? 1 : 0)) imperativeClasses(value);
    } else if (ts.isCallExpression(node) && ['setProperty', 'setAttribute'].includes(calleeName(node)) && node.arguments[0] && node.arguments[1]) {
      const property = literalText(node.arguments[0]).toLowerCase();
      const value = literalText(node.arguments[1]);
      if (property === 'class' && calleeName(node) === 'setAttribute') imperativeClasses(node.arguments[1]);
      if ((property === 'font-size' && !validFont(literalText(node.arguments[1]), roles)) ||
          ['font', 'zoom', 'scale'].includes(property) || protectedVariable(property) ||
          (property === 'transform' && isScale(value)) ||
          (property === 'style' && (/(?:^|;)\s*(?:font|font-size|zoom|scale)\s*:/i.test(value) || /(?:^|;)\s*transform\s*:[^;]*\bscale\(/i.test(value)))) {
        fail(node, 'imperative ' + property + ' bypasses the typography registry');
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)) {
      const prop = node.left.name.text;
      if (prop === 'className') imperativeClasses(node.right);
      if (prop === 'font' && !usesPosterFonts(node.right) && literalText(node.right) !== 'inherit') fail(node, 'use a registered font for this renderer');
      if (prop === 'fontSize' && !validFont(literalText(node.right), roles)) fail(node, 'imperative fontSize bypasses the typography registry');
      if (['zoom', 'scale'].includes(prop) && /\.style\b/.test(node.left.getText())) fail(node, 'imperative ' + prop + ' bypasses the typography registry');
      if (prop === 'transform' && /\.style\b/.test(node.left.getText()) && isScale(literalText(node.right))) fail(node, 'imperative transform scale bypasses the typography registry');
      if (prop === 'cssText') {
        const css = literalText(node.right);
        if (/(?:^|;)\s*(?:zoom|scale|font-size|font)\s*:/i.test(css) || /(?:^|;)\s*transform\s*:[^;]*\bscale\(/i.test(css)) fail(node, 'inline cssText contains unregistered typography');
      }
    }
    const str = literalText(node);
    if (str) {
      for (const [anchor, wanted] of anchors.filter(([name]) => name === 'html')) {
        const tag = /<html(?=\s|>)[^>]*>/i.exec(str)?.[0];
        if (!tag) continue;
        found.add(anchor);
        if (!tag.includes(attrName + '="' + wanted + '"') && !tag.includes(attrName + "='" + wanted + "'")) {
          fail(node, 'HTML template requires its registered surface ' + wanted);
        }
        // An exported HTML document has no access to the application's
        // stylesheet. Require the actual sheet for this surface inside its
        // own <style> block, not just an unused import or a matching name.
        const sheets = new Set((styles.rules.get(wanted) ?? []).map(rule => path.resolve(styles.ruleFiles.get(rule))));
        const includes = new Set();
        for (const statement of source.statements) {
          if (!ts.isImportDeclaration(statement) || !statement.importClause?.name || !statement.moduleSpecifier.text.endsWith('.css?raw')) continue;
          const imported = path.resolve(styles.root, path.posix.dirname(file), statement.moduleSpecifier.text.slice(0, -4));
          if (sheets.has(imported)) includes.add(statement.importClause.name.text);
        }
        let embedded = false;
        if (ts.isTemplateExpression(node)) {
          let prefix = node.head.text;
          for (const part of node.templateSpans) {
            if (prefix.lastIndexOf('<style>') > prefix.lastIndexOf('</style>') && ts.isIdentifier(part.expression) && includes.has(part.expression.text)) embedded = true;
            prefix += part.literal.text;
          }
        }
        if (!embedded) fail(node, 'HTML template does not embed the registered ' + wanted + ' typography stylesheet');
      }
      if (/^\s*<!doctype\s+html|<html(?=\s|>)/i.test(str) && !anchors.some(([name]) => name === 'html')) {
        fail(node, 'standalone HTML template requires a registered html boundary');
      }
      if (/<[a-z][\w:-]*(?:\s|>)/i.test(str)) {
        // Application-authored declarations in HTML templates follow the
        // same rules. Interpolated document contents are data, not source CSS.
        const html = str.replaceAll('${…}', '');
        const at = (_, local, reason) => report(file, line(node) + local - 1, reason);
        for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
          checkStyleSheet(file, postcss.parse(match[1], { from: file }), roles, false, at);
        }
        for (const match of html.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gi)) {
          checkStyleSheet(file, postcss.parse('element{' + match[2] + '}', { from: file }), roles, false, at);
        }
        for (const match of html.matchAll(/\bclass\s*=\s*(["'])(.*?)\1/gi)) {
          for (const token of match[2].split(/\s+/)) if (unregisteredUtility(token)) fail(node, 'unregistered HTML typography utility: ' + token);
        }
      }
    }
  });
  for (const [anchor] of anchors) if (!found.has(anchor)) fail(source, 'registered rendering boundary not found: ' + anchor);
}

export function checkTypography(root = projectRoot) {
  const diagnostics = [];
  const report = (file, line, reason) => diagnostics.push(file + ':' + line + ': ' + reason);
  try {
    const registry = readRegistration(root, diagnostics);
    const files = sourceFiles(root);
    const styles = centralStyles(root, diagnostics);
    const roles = new Set(registry.roles);
    const sources = new Map(files.filter(file => codeExtension.test(file)).map(file =>
      [file, parse(file, fs.readFileSync(path.join(root, file), 'utf8'))]));
    const trace = makeRenderCheck(sources, surface);
    for (const file of new Set([...Object.keys(registry.modules ?? {}), ...Object.keys(registry.boundaries ?? {})])) {
      if (!fs.existsSync(path.join(root, file))) report(registryFile, 1, 'registered source does not exist: ' + file);
    }
    for (const file of files) {
      if (file.endsWith('.css')) {
        const css = postcss.parse(fs.readFileSync(path.join(root, file), 'utf8'), { from: file });
        if (file === 'src/index.css') {
          if (!css.nodes.some(rule => rule.type === 'atrule' && rule.name === 'import' &&
            /^["']\.\/design-system\/typography-surfaces\.css["']$/.test(rule.params))) report(file, 1, 'the application must import the typography surface stylesheet');
          const tokens = new Set();
          css.walkAtRules('theme', theme => { for (const decl of theme.nodes) if (decl.type === 'decl' && decl.value.trim()) tokens.add(decl.prop); });
          for (const role of roles) if (!tokens.has('--text-' + role)) report(file, 1, 'registered role has no @theme definition: --text-' + role);
        }
        checkStyleSheet(file, css, roles, styles.sheets.has(file), report);
      } else {
        projectCode(file, sources.get(file), registry, styles, trace, report);
      }
    }
    checkTypographyHtml(root, registry, styles, report, { checkStyleSheet, unregisteredUtility });
  } catch (error) {
    diagnostics.push('Typography registry check failed: ' + error.message);
  }
  return diagnostics;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--inventory')) console.log(JSON.stringify(inventoryTypography(), null, 2));
  else {
    const problems = checkTypography();
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exitCode = 1;
    } else console.log('PASS typography registrations and source boundaries');
  }
}
