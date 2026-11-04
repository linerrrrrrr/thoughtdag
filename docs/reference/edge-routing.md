# Edge routing contract and references

Connections preserve their endpoint direction and remain readable as nodes move.
Facing, aligned ports connect straight. Facing ports with a transverse offset use
one continuous S-shaped cubic Bézier when the route is unobstructed. Curved mode
does not add a decorative bow to an already aligned connection.

This is the geometry contract for the local React Flow edge renderer. It does not
change the continuation/single-node-reference semantics, the connection editor,
or the ordering of nodes in a conversation chain.

## Direct implementation choice

Use `getBezierPath()` from the project's existing `@xyflow/react` dependency for
natural connections. The [official API](https://reactflow.dev/api-reference/utils/get-bezier-path)
accepts the endpoint coordinates and handle positions and returns the SVG path
and label coordinates. This directly adopts the renderer's maintained Bézier
utility; the local router remains responsible for obstacle checks and detours.
The installed dependency inspected for this decision is `@xyflow/react` 12.10.0.

This document records the selected implementation and its acceptance criteria.
It is not a statement that every obstacle, shared-port, or browser case has
already passed final verification.

## Separate routing from drawing

1. **Resolve endpoints.** Use the displayed node bounds and port sides to determine
   the source point, target point, and outward normals. Geometry never determines
   whether the edge continues context or references a single node.
2. **Find a safe corridor when needed.** First test the natural curve against
   obstacle bounds. Search for a detour only when that curve is obstructed. Search
   results describe where an edge may travel, rather than prescribing its final
   SVG shape.
3. **Draw the selected connection style.** Curved routes use cubic Bézier segments
   with continuous tangent directions. Elbow routes retain orthogonal segments
   and round their corners. These are separate drawing strategies.

A curve obstacle fallback must remain a curve. Replacing long orthogonal lines
with cubic commands whose controls are collinear, then rounding only their
corners, still produces a rounded orthogonal route. The presence of `C` commands
in the SVG is not sufficient evidence of curved routing.

For cubic endpoints `P0` and `P3`, with outward port normals `ns` and `nt`, the
controls have the form `C1 = P0 + hs * ns` and `C2 = P3 + ht * nt`. Thus the
departure direction is `C1 - P0`, while the arrival direction is `P3 - C2`.
Control distances follow the available span; a fixed small cap must not flatten
the middle of a long, offset connection. A routed spline must be collision-tested
after interpolation because smoothing safe waypoints can cut inside an obstacle.

## Inspected open-source references

The following official documentation and source files were inspected on
2026-11-04. Source links track upstream `main` or `master`; the algorithms and their
applicability are recorded here so that a later upstream change is not mistaken
for this project's contract.

| Reference | Verified behavior | Adopted principle |
| --- | --- | --- |
| [React Flow `getBezierPath()`](https://reactflow.dev/api-reference/utils/get-bezier-path) | The public utility generates a cubic Bézier from endpoint coordinates and handle positions, with label coordinates returned alongside the path. | Call the existing dependency directly for natural edges rather than maintaining a competing control-point formula. |
| Dify workflow [custom edge](https://github.com/langgenius/dify/blob/main/web/app/components/workflow/custom-edge.tsx) and [connection preview](https://github.com/langgenius/dify/blob/main/web/app/components/workflow/custom-connection-line.tsx) | Both components call React Flow's `getBezierPath()` with right-to-left handle directions and `curvature: 0.16`. The saved edge also applies its own endpoint offsets. | Treat this as a concrete behavior reference for whole-span curves and consistent connection previews. Do not copy its components, endpoint offsets, or horizontal-only assumptions into this canvas. |
| [X6 `smooth` source](https://github.com/antvis/X6/blob/master/src/registry/connector/smooth.ts) and [connector documentation](https://x6.antv.antgroup.com/en/api/registry/connector/#smooth) | Without route points, horizontal control points share the midpoint X coordinate; vertical control points share midpoint Y. With route points, `Curve.throughPoints()` interpolates the complete route. | Use a whole-span cubic for an unobstructed offset connection. Naturally aligned endpoints remain straight. |
| [X6 router documentation](https://x6.antv.antgroup.com/en/api/registry/router/) and [Manhattan options](https://github.com/antvis/X6/blob/master/src/registry/router/manhattan/options.ts) | Routers return intermediate points. `orth` creates orthogonal segments; `manhattan` additionally avoids obstacles and exposes padding and start/end direction constraints. | Keep obstacle search and final curve rendering separate; preserve explicit endpoint directions. |
| [JointJS `curve` source](https://github.com/clientIO/joint/blob/master/packages/joint-core/src/connectors/curve.mjs) and [connector documentation](https://docs.jointjs.com/api/connectors/#curve) | `getSourceTangentDirection()` and `getTargetTangentDirection()` resolve endpoint directions. `createCatmullRomCurves()` computes internal tangents, and `catmullRomToBezier()` creates cubic segments. Tangent lengths scale with neighboring distances; `distanceCoefficient` defaults to `0.6`. | A detour curve needs coherent endpoint and internal tangents, not isolated rounded corners. The exact upstream spline implementation is a reference, not a requirement to copy it. |
| [JointJS router documentation](https://docs.jointjs.com/api/routers/) and [Manhattan source](https://github.com/clientIO/joint/blob/master/packages/joint-core/src/routers/manhattan.mjs) | The Manhattan pathfinder uses obstacle bounds, direction constraints, turn penalties, and a bounded search. The curve connector itself does not promise obstacle avoidance. | Retain bounded collision-aware routing, then validate the generated curve. Do not assume that choosing a smooth connector makes an unsafe route safe. |

For the simple horizontal case, X6's controls are
`C1 = ((sx + tx) / 2, sy)` and `C2 = ((sx + tx) / 2, ty)`.
This is the useful baseline for assessing the visual result: the bend spans the
connection, rather than appearing only beside a short vertical segment.
Port directions, nearby obstacles, reversed connections, and tight gaps still
require their own handling.

React Flow can temporarily retain an old handle measurement when an offscreen
node changes size. Before searching, reconcile a clearly stale endpoint with its
displayed card boundary while keeping its chosen side. Normal handle protrusion
is preserved. This prevents a start point inside its own card from making every
detour fail and falling back to a curve through another visible card.

Shared endpoints retain stable edge ordering. Separation should respond to an
actual overlap or crossing; it should not insert a mandatory fan-out bend into
every connection. Position changes and obstacle detours must not create loops at
an endpoint, reverse an arrow's entry direction, or route through a node body.

## Licensing and adoption

- `@xyflow/react` is covered by the project's upstream [MIT license](https://github.com/xyflow/xyflow/blob/main/LICENSE),
  also present in the installed package. The direct call uses this existing
  dependency under its license. Dify is a behavior reference only; its workflow
  component source is not copied or incorporated.
- X6 is [MIT licensed](https://github.com/antvis/X6/blob/master/LICENSE). Copying a
  substantial implementation requires retaining its copyright and permission
  notice.
- JointJS core is [MPL-2.0 licensed](https://github.com/clientIO/joint/blob/master/LICENSE).
  Copied or adapted covered source remains subject to that license's notice and
  source-distribution requirements. Its geometry and architectural separation
  inform an independent local implementation; no JointJS source is included by
  this document.

The direct adoption is React Flow's `getBezierPath()`. X6 and JointJS inform the
endpoint/corridor/connector separation and detour handling. The existing canvas
renderer and context compiler remain their respective owners; importing another
diagramming framework is not required by this design.

## Acceptance cases

- A forward, aligned pair remains straight in curved mode without an artificial
  bump; a long, offset pair forms a continuous natural S curve.
- Source and target tangents follow their port normals, including reverse and
  vertical connections.
- Obstructed curved routes remain continuous curves; elbow routes remain
  orthogonal apart from rounded corners. Neither crosses node interiors.
- Tight gaps and changing node dimensions produce finite, visible paths with no
  backward endpoint loops or abrupt changes caused by stale geometry.
- Shared-source and shared-target connections are deterministic, with overlap
  and crossing checks based on geometry rather than the number of SVG commands.
- Changing route style does not move nodes, reorder context, or alter a model's
  input content.
