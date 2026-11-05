import { Constraint, Solver, Variable } from 'webcola';
import type { LayoutLink, LayoutProjectionOptions, LayoutShape, LayoutSolution } from './layout-model';

type Axis = 'x' | 'y';
type Side = 'start' | 'end';
type Separation = { axis: Axis; before: string; after: string };
type Pair = { a: string; b: string; choices: Separation[] };
type Rule = { a: string; b: string; kind: 'size' | 'anchor' | 'chain' | 'flow' | 'containment' | 'sibling'; pair?: number };
const EPSILON = 0.0001;
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const dimension = (axis: Axis) => axis === 'x' ? 'width' : 'height';

/** Project ELK's geometry onto the canvas's hard equalities and separations.
 * VPSC minimizes displacement from the supplied layout; frame membership is
 * immutable throughout the solve. No layout result mutates its input. */
export function projectLayout(shapes: LayoutShape[], links: LayoutLink[], options: LayoutProjectionOptions): LayoutSolution {
  if (options.method === 'manual' || !shapes.length) return { shapes };
  if (shapes.some(s => ![s.x, s.y, s.width, s.height].every(Number.isFinite) || s.width <= 0 || s.height <= 0)) {
    return { error: 'obstacle-conflict' };
  }
  const primary: Axis = options.direction === 'horizontal' ? 'x' : 'y';
  const cross: Axis = primary === 'x' ? 'y' : 'x';
  const byId = new Map(shapes.map(s => [s.id, s]));
  const structural = links.filter(e => e.structural && byId.has(e.source) && byId.has(e.target));
  const continuations = links.filter(e => e.continuation && byId.has(e.source) && byId.has(e.target));
  const children = new Map<string | undefined, LayoutShape[]>();
  for (const shape of shapes) {
    const parent = shape.parent && byId.has(shape.parent) ? shape.parent : undefined;
    children.set(parent, [...(children.get(parent) ?? []), shape]);
  }
  const frames = shapes.filter(s => s.frame && !s.fixed);
  const hasFixed = shapes.some(s => s.fixed);
  const layerGroups = new Map<string, string[]>();
  if (options.method === 'layers') {
    const movable = shapes.filter(shape => !shape.fixed && !shape.frame);
    const movingIds = new Set(movable.map(shape => shape.id));
    const component = new Map(movable.map(shape => [shape.id, shape.id]));
    const componentRoot = (id: string): string => {
      let root = id;
      while (component.get(root) !== root) root = component.get(root)!;
      return root;
    };
    for (const edge of structural) if (movingIds.has(edge.source) && movingIds.has(edge.target)) {
      component.set(componentRoot(edge.target), componentRoot(edge.source));
    }
    const rank = new Map<string, number>();
    for (let pass = 0; pass < movable.length; pass++) {
      for (const shape of movable) {
        if (rank.has(shape.id)) continue;
        const parents = structural.filter(edge => edge.target === shape.id && movingIds.has(edge.source));
        if (parents.every(edge => rank.has(edge.source))) rank.set(shape.id, Math.max(0, ...parents.map(edge => rank.get(edge.source)! + 1)));
      }
    }
    for (const [id, level] of rank) {
      const key = `${componentRoot(id)}\0${byId.get(id)!.parent ?? ''}\0${level}`;
      layerGroups.set(key, [...(layerGroups.get(key) ?? []), id]);
    }
  }

  const chain = new Map(shapes.map(s => [s.id, s.id]));
  const find = (id: string): string => {
    let root = id;
    while (chain.get(root)! !== root) root = chain.get(root)!;
    let cursor = id;
    while (chain.get(cursor)! !== root) {
      const next = chain.get(cursor)!;
      chain.set(cursor, root); cursor = next;
    }
    return root;
  };
  for (const edge of continuations) chain.set(find(edge.target), find(edge.source));
  const leafCache = new Map<string, string[]>();
  const leaves = (id: string, visiting = new Set<string>()): string[] => {
    if (leafCache.has(id)) return leafCache.get(id)!;
    if (visiting.has(id)) return [];
    visiting.add(id);
    const descendants = children.get(id) ?? [];
    const found = byId.get(id)!.frame && descendants.length
      ? descendants.flatMap(s => leaves(s.id, visiting)) : [id];
    visiting.delete(id);
    leafCache.set(id, found);
    return found;
  };
  const next = new Map<string, string[]>();
  for (const edge of structural) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  const reachableCache = new Map<string, Set<string>>();
  const reachable = (id: string) => {
    if (reachableCache.has(id)) return reachableCache.get(id)!;
    const found = new Set<string>(), stack = [...(next.get(id) ?? [])];
    while (stack.length) {
      const target = stack.pop()!;
      if (found.has(target)) continue;
      found.add(target); stack.push(...(next.get(target) ?? []));
    }
    reachableCache.set(id, found);
    return found;
  };
  const precedes = (a: string, b: string) => leaves(a).some(source => leaves(b).some(target => reachable(source).has(target)));
  const sharesChain = (a: string, b: string) => {
    const roots = new Set(leaves(a).map(find));
    return leaves(b).some(id => roots.has(find(id)));
  };
  // A single global order for aligned chains prevents one region from placing
  // A left of B while a second region places the same chains B left of A.
  const crossCenters = new Map<string, { sum: number; count: number }>();
  for (const shape of shapes.filter(s => !s.frame)) {
    const key = find(shape.id), entry = crossCenters.get(key) ?? { sum: 0, count: 0 };
    entry.sum += shape[cross]; entry.count++; crossCenters.set(key, entry);
  }
  const crossPosition = (id: string) => {
    const values = leaves(id).map(leaf => crossCenters.get(find(leaf))).filter(v => v !== undefined);
    return values.length ? values.reduce((sum, v) => sum + v.sum / v.count, 0) / values.length : byId.get(id)![cross];
  };
  const order = (a: LayoutShape, b: LayoutShape, axis: Axis): Separation | undefined => {
    const ab = precedes(a.id, b.id), ba = precedes(b.id, a.id);
    if (axis === primary && ab && ba) return undefined;
    const before = axis === primary && (ab || ba) ? ab ? a : b
      : axis === cross ? crossPosition(a.id) < crossPosition(b.id) || (crossPosition(a.id) === crossPosition(b.id) && a.id < b.id) ? a : b
        : a[axis] + a[dimension(axis)] / 2 < b[axis] + b[dimension(axis)] / 2
          || (a[axis] === b[axis] && a.id < b.id) ? a : b;
    return { axis, before: before.id, after: before === a ? b.id : a.id };
  };
  const pairs: Pair[] = [];
  for (const siblings of children.values()) {
    const sorted = [...siblings].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (a.fixed && b.fixed) continue;
      if (sharesChain(a.id, b.id)) {
        const separation = order(a, b, primary);
        if (!separation) return { error: a.frame || b.frame ? 'frame-conflict' : 'boundary-conflict' };
        pairs.push({ a: a.id, b: b.id, choices: [separation] });
        continue;
      }
      const clearance = (axis: Axis) => Math.max(b[axis] - a[axis] - a[dimension(axis)], a[axis] - b[axis] - b[dimension(axis)]);
      const preferred: Axis = clearance(cross) >= clearance(primary) ? cross : primary;
      const alternate = preferred === cross ? primary : cross;
      const choices = [order(a, b, preferred), order(a, b, alternate)].filter((v): v is Separation => !!v);
      // Unrelated obstacles can be passed on either side. Keeping only the
      // initial order falsely rejects a chain pinned between fixed cards.
      const ordered = precedes(a.id, b.id) || precedes(b.id, a.id);
      choices.push(...choices.filter(choice => choice.axis === cross || !ordered)
        .map(choice => ({ axis: choice.axis, before: choice.after, after: choice.before })));
      pairs.push({ a: a.id, b: b.id, choices });
    }
  }

  const minimums = new Map(frames.map(s => [s.id, {
    width: s.minWidth ?? ((children.get(s.id)?.length ?? 0) ? 280 : s.width),
    height: s.minHeight ?? ((children.get(s.id)?.length ?? 0) ? 180 : s.height),
  }]));
  const solve = (choices: number[]) => {
    const result = new Map(shapes.map(s => [s.id, { ...s }]));
    const conflicts: Rule[] = [];
    for (const axis of [cross, primary]) {
      const dim = dimension(axis);
      const origin = new Variable(0, 1000);
      const variables = new Map<string, Variable>();
      const key = (id: string, side: Side) => `${id}\0${side}`;
      const variable = (id: string, side: Side) => variables.get(key(id, side))!;
      for (const shape of shapes) for (const side of ['start', 'end'] as const) {
        const desired = shape[axis] + (shape.frame && !shape.fixed ? shape[dim] / 2 : side === 'end' ? shape[dim] : 0);
        variables.set(key(shape.id, side), new Variable(desired, shape.frame && !shape.fixed ? 0.05 : 1));
      }
      const constraints: Constraint[] = [], rules: Rule[] = [];
      const add = (a: string, aSide: Side, b: string, bSide: Side, gap: number, equality: boolean, kind: Rule['kind'], pair?: number) => {
        constraints.push(new Constraint(variable(a, aSide), variable(b, bSide), gap, equality));
        rules.push({ a, b, kind, pair });
      };
      for (const shape of shapes) {
        const flexible = shape.frame && !shape.fixed;
        add(shape.id, 'start', shape.id, 'end', flexible ? minimums.get(shape.id)![dim] : shape[dim], !flexible, 'size');
        if (shape.fixed) {
          constraints.push(new Constraint(origin, variable(shape.id, 'start'), shape[axis], true));
          rules.push({ a: shape.id, b: shape.id, kind: 'anchor' });
        }
        if (shape.parent && byId.has(shape.parent)) {
          const before = axis === 'x' ? options.framePadding.left : options.framePadding.top;
          const after = axis === 'x' ? options.framePadding.right : options.framePadding.bottom;
          add(shape.parent, 'start', shape.id, 'start', before, false, 'containment');
          add(shape.id, 'end', shape.parent, 'end', after, false, 'containment');
        }
      }
      if (axis === cross) for (const edge of continuations) add(edge.source, 'start', edge.target, 'start', 0, true, 'chain');
      if (axis === primary) for (const edge of structural) add(edge.source, 'end', edge.target, 'start', options.gap, false, 'flow');
      if (axis === primary) for (const group of layerGroups.values()) {
        for (const id of group.slice(1)) add(group[0], 'start', id, 'start', 0, true, 'chain');
      }
      pairs.forEach((pair, i) => {
        const separation = pair.choices[choices[i]];
        if (separation.axis === axis) add(separation.before, 'end', separation.after, 'start', axis === primary ? options.gap : options.crossGap, false, 'sibling', i);
      });
      try { new Solver([origin, ...variables.values()], constraints).solve(); }
      catch { return { conflicts: [{ a: '', b: '', kind: 'sibling' as const }], result }; }
      constraints.forEach((constraint, i) => {
        // Redundant equalities may set unsatisfiable even at zero residual.
        // slack() also masks flagged constraints, so validate the original rule.
        const residual = constraint.right.position() - constraint.left.position() - constraint.gap;
        if (!Number.isFinite(residual) || (constraint.equality ? Math.abs(residual) > EPSILON : residual < -EPSILON)) conflicts.push(rules[i]);
      });
      for (const shape of shapes) {
        const start = variable(shape.id, 'start').position() - origin.position();
        const end = variable(shape.id, 'end').position() - origin.position();
        const projected = result.get(shape.id)!;
        projected[axis] = round(start);
        if (shape.frame && !shape.fixed) projected[dim] = round(end - start);
      }
    }
    return { result, conflicts };
  };

  let choices = pairs.map(() => 0);
  let lastConflicts: Rule[] = [];
  for (let ratioPass = 0; ratioPass < 12; ratioPass++) {
    let projected = solve(choices);
    // ELK ordering is a preference, not a hard requirement. A separation
    // axis or orientation may become infeasible after chain equalities or
    // fixed anchors are applied. Try alternatives without relaxing them.
    const visited = new Set([choices.join(',')]);
    let budget = 64;
    for (let retry = 0; projected.conflicts.length && retry < 32 && budget > 0; retry++) {
      const involved = new Set(projected.conflicts.flatMap(rule => [rule.a, rule.b]));
      const candidates = pairs.map((pair, index) => ({ pair, index }))
        .filter(({ pair }) => pair.choices.length > 1)
        .sort((a, b) => Number(involved.has(b.pair.a) || involved.has(b.pair.b)) - Number(involved.has(a.pair.a) || involved.has(a.pair.b)) || a.index - b.index);
      let best: { choices: number[]; projection: ReturnType<typeof solve> } | undefined;
      for (const { pair, index } of candidates) {
        if (budget <= 0) break;
        for (let alternative = 0; alternative < pair.choices.length && budget > 0; alternative++) {
          if (alternative === choices[index]) continue;
          const trial = [...choices]; trial[index] = alternative;
          const signature = trial.join(',');
          if (visited.has(signature)) continue;
          visited.add(signature);
          budget--;
          const projection = solve(trial);
          if (!best || projection.conflicts.length < best.projection.conflicts.length) best = { choices: trial, projection };
          if (!projection.conflicts.length) break;
        }
        if (best && !best.projection.conflicts.length) break;
      }
      if (!best) break;
      choices = best.choices; projected = best.projection;
    }
    if (projected.conflicts.length) {
      lastConflicts = projected.conflicts;
      break;
    }
    let expand = false;
    for (const frame of frames) {
      const ratio = frame.aspectRatio;
      if (!ratio || !Number.isFinite(ratio) || ratio <= 0) continue;
      const solved = projected.result.get(frame.id)!, min = minimums.get(frame.id)!;
      if (solved.width + EPSILON < solved.height * ratio) {
        min.width = solved.height * ratio; expand = true;
      } else if (solved.height + EPSILON < solved.width / ratio) {
        min.height = solved.width / ratio; expand = true;
      }
    }
    if (!expand) return { shapes: shapes.map(shape => shape.fixed ? shape : projected.result.get(shape.id)!) };
  }
  const fixedConflict = lastConflicts.some(rule => byId.get(rule.a)?.fixed || byId.get(rule.b)?.fixed);
  return { error: fixedConflict || hasFixed && !frames.length ? 'boundary-conflict' : frames.length ? 'frame-conflict' : 'obstacle-conflict' };
}
