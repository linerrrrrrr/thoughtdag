// Follow what JSX actually places under coordinate-only containers and into
// portals. Reading only the nearest JSX parent misses helpers and fragments.
import path from 'node:path';
import ts from 'typescript';

function callName(node) {
  return (ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression).getText();
}

function declaredName(node) {
  return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
}

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, child => visit(child, fn));
}

export function makeRenderCheck(sources, getSurface) {
  const info = new Map();
  const callSites = new Map();
  for (const [file, source] of sources) {
    const locals = new Map(), imports = new Map();
    let defaultExport;
    visit(source, node => {
      if (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isClassDeclaration(node)) {
        const name = declaredName(node);
        if (name) {
          const list = locals.get(name) ?? [];
          list.push(node);
          locals.set(name, list);
        }
        if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) defaultExport = node;
      }
      if (ts.isExportAssignment(node)) defaultExport = node.expression;
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
      const module = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name) imports.set(clause.name.text, { module, name: 'default' });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) imports.set(element.name.text, { module, name: element.propertyName?.text ?? element.name.text });
      }
    });
    info.set(source, { file, locals, imports, defaultExport });
  }

  function resolve(name, node) {
    const context = info.get(node.getSourceFile());
    const imported = context.imports.get(name);
    if (imported?.module.startsWith('.')) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(context.file), imported.module));
      const target = [base, base + '.tsx', base + '.ts', base + '.jsx', base + '/index.tsx', base + '/index.ts']
        .map(file => sources.get(file)).find(Boolean);
      if (target) {
        const module = info.get(target);
        return imported.name === 'default' ? module.defaultExport : module.locals.get(imported.name)?.[0];
      }
    }
    const matches = context.locals.get(name) ?? [];
    if (matches.length === 1) return matches[0];
    // Prefer the innermost declaration in the enclosing lexical scope.
    for (let scope = node; scope; scope = scope.parent) {
      const match = matches.find(decl => decl.pos >= scope.pos && decl.end <= scope.end);
      if (match) return match;
    }
  }

  function forwardedChildren(node) {
    let owner = node.parent;
    while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
    if (!owner || !owner.parameters.some(param => ts.isObjectBindingPattern(param.name) &&
        param.name.elements.some(element => declaredName(element) === 'children'))) return;
    const component = ts.isVariableDeclaration(owner.parent) ? owner.parent : owner;
    if (!callSites.has(component)) {
      const matches = [];
      for (const source of sources.values()) {
        visit(source, child => {
          if (!ts.isJsxElement(child)) return;
          const name = child.openingElement.tagName.getText();
          if (/^[A-Z]/.test(name) && resolve(name, child) === component) matches.push(...child.children);
        });
      }
      callSites.set(component, matches);
    }
    return callSites.get(component);
  }

  const textFreeLibraryTags = new Set(['Handle', 'Background', 'MiniMap', 'BaseEdge', 'NodeResizeControl', 'NodeResizer']);
  function trace(node, active = new Set()) {
    if (!node || active.has(node)) return;
    active.add(node);
    try {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        if (getSurface(opening).length) return;
        const name = opening.tagName.getText();
        const children = ts.isJsxElement(node) ? node.children : [];
        if (/^[A-Z]/.test(name) && !name.endsWith('.Provider') && name !== 'Fragment' && name !== 'React.Fragment') {
          const imported = info.get(node.getSourceFile()).imports.get(name);
          if (imported?.module === 'lucide-react' || (imported?.module === '@xyflow/react' && textFreeLibraryTags.has(imported.name))) return;
          if (!(imported?.module === '@xyflow/react' && imported.name === 'EdgeLabelRenderer')) {
            const component = resolve(name, node);
            if (!component) return node;
            const offending = trace(component, active);
            if (offending) return offending;
            // A component can forward its children even if its own render is
            // text-free. A surfaced component takes ownership of those children.
            if (children.length && hasRootSurface(component)) return;
          }
        }
        if (['input', 'textarea', 'select', 'iframe', 'foreignObject'].includes(name) ||
            opening.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText() === 'dangerouslySetInnerHTML')) return node;
        for (const child of children) {
          const offending = trace(child, active);
          if (offending) return offending;
        }
        return;
      }
      if (ts.isJsxFragment(node)) {
        for (const child of node.children) { const issue = trace(child, active); if (issue) return issue; }
        return;
      }
      if (ts.isJsxText(node) || ts.isStringLiteralLike(node)) return node.text.trim() ? node : undefined;
      if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) ||
          ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return trace(node.expression, active);
      if (ts.isConditionalExpression(node)) return trace(node.whenTrue, active) ?? trace(node.whenFalse, active);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return trace(node.right, active);
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
        return trace(node.left, active) ?? trace(node.right, active);
      }
      if (ts.isVariableDeclaration(node)) return trace(node.initializer, active);
      if (ts.isObjectLiteralExpression(node)) {
        // React Flow receives its node/edge render functions in keyed maps.
        for (const prop of node.properties) {
          const value = ts.isPropertyAssignment(prop) ? prop.initializer
            : ts.isShorthandPropertyAssignment(prop) ? prop.name : ts.isSpreadAssignment(prop) ? prop.expression : prop;
          const issue = trace(value, active);
          if (issue) return issue;
        }
        return;
      }
      if (ts.isIdentifier(node)) {
        if (node.text === 'undefined') return;
        if (node.text === 'children') {
          const forwarded = forwardedChildren(node);
          if (forwarded?.length) {
            for (const child of forwarded) { const issue = trace(child, active); if (issue) return issue; }
            return;
          }
        }
        const decl = resolve(node.text, node);
        return decl ? trace(decl, active) : node;
      }
      if (ts.isFunctionLike(node)) {
        if (!node.body || !ts.isBlock(node.body)) return trace(node.body, active);
        let offending;
        function returns(child) {
          if (offending || ts.isFunctionLike(child)) return;
          if (ts.isReturnStatement(child)) offending = trace(child.expression, active);
          else ts.forEachChild(child, returns);
        }
        returns(node.body);
        return offending;
      }
      if (ts.isCallExpression(node)) {
        const name = callName(node);
        if (name === 'map' || name === 'flatMap' || name === 'memo' || name === 'forwardRef') return trace(node.arguments[0], active);
        if (name === 'createPortal') return; // Its own destination is checked independently.
        if (ts.isIdentifier(node.expression)) {
          const fn = resolve(name, node);
          if (fn) return trace(fn, active);
        }
      }
      if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return;
      return node;
    } finally { active.delete(node); }
  }

  function hasRootSurface(component) {
    // Used only for a component receiving explicit JSX children. The usual
    // function return is a directly marked host element.
    if (ts.isVariableDeclaration(component) && component.initializer) return hasRootSurface(component.initializer);
    if (ts.isFunctionLike(component) && component.body) {
      const returns = ts.isBlock(component.body) ? component.body.statements.filter(ts.isReturnStatement).map(s => s.expression) : [component.body];
      return returns.length > 0 && returns.every(value => {
        while (value && ts.isParenthesizedExpression(value)) value = value.expression;
        return value && (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value)) &&
          getSurface(ts.isJsxElement(value) ? value.openingElement : value).length > 0;
      });
    }
    return false;
  }
  return trace;
}
