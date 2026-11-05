---
name: thoughtdag-design-system
description: Apply ThoughtDAG's established design language when adding, refining, or reviewing its application UI, including tool cards, reading panels, canvas nodes, and settings. Use for typography, spacing, shapes, colors, states, and responsive or zoom behavior; exclude backend-only work and unrelated websites.
---

# ThoughtDAG design system

Preserve the user's requested scope and the established application identity. This skill selects and verifies project rules; it does not authorize a redesign or changes to graph behavior.

## Find the relevant rule

Paths below are relative to this skill's installed location at `.agents/skills/thoughtdag-design-system/`.

- Read the relevant sections of [DESIGN.md](../../../DESIGN.md) and inspect the affected component. The **Overview** defines authority and surface profiles; **Typography**, **Layout**, **Shapes**, and **Components** define the visual rules.
- For inputs, menus, dialogs, or panels, classify the interaction using [interaction-contract.md](../../../docs/reference/interaction-contract.md). Keep its shared dismissal hooks and draft behavior.
- For toolbar entries, cards, or selection controls, read [Toolbar and card visibility](../../../DESIGN.md#toolbar-and-card-visibility) and use its four entry roles before choosing visibility or emphasis. Verify the affected [transition sequences](../../../docs/reference/design-acceptance.md#toolbar-card-visibility), including replacement and responsive overflow.
- Choose checks from [design-acceptance.md](../../../docs/reference/design-acceptance.md). The development specimen at `/design-system.html` uses application styles; inspect the actual affected application surface as well.

User decisions define the target. Runtime CSS defines implemented values. DESIGN.md records the intended roles and a checked token snapshot. A mismatch is migration work, not permission to silently change the user's direction. Generic design skills may improve the method but do not replace project references.

## Choose by purpose

| Surface | Reference and constraint |
| --- | --- |
| Tools, menus, property panels | More (`src/App.tsx`, `data-toolbar-more-panel`) and Object Format (`src/components/SelectionToolbar.tsx`) establish the card, control, section, and action language. Reuse their single boundaries and restrained selection states. |
| Conversation and material reading | Share card and text roles; preserve reading rhythm, wrapping, speaker distinction, and material identity. |
| Canvas objects and overviews | Separate canvas-space geometry from screen-space type. Preserve graph footprints, context direction, semantic zoom, and editing protection. |

Use the semantic type roles (`text-meta`, `text-control`, `text-body`, `text-title`, `text-heading`, `text-section`, `text-page`) and existing color, spacing, radius, and shadow tokens. Read actual values from `src/index.css`; scoped conversation aliases are in `src/components/ConversationSurface.css`. Do not create another value table in this skill.

Treat a control as a composition: type, icon, hit area, padding, shape, and states. Treat a panel as a composition: header, fields, groups, and actions. Reuse an existing component or recipe before introducing a new one. Apply concentric corners to genuinely nested contours. Document a necessary exception with its purpose and surface, rather than making it a universal rule.

Width pressure is handled through wrapping and existing disclosure/overflow behavior. Visual-only work keeps controls and interaction routes in place. Do not shrink ordinary controls or long text to metadata size. Editing and display use the same text role. Theme changes preserve geometry.

## Implement and verify

1. Identify affected surfaces and check for concurrent edits before changing shared files. Read only the relevant rules and references.
2. Update the owning token or component within scope. Keep ports, drag targets, focus, drafts, undo, and explicit-submit semantics intact.
3. Run `node scripts/check-design-system.mjs` for UI style or design-snapshot changes. After reviewing an intentional token change, `--write` updates mapped snapshots only; review prose and sidecar snippets separately. Never use synchronization to conceal a regression.
4. Render the changed surface at its relevant widths, themes, languages, and zoom levels. Check competing emphasis, repeated borders/fills, icon weight, grouping, wrapping, and editing states. A numerically correct layout can still be visually incoherent.
5. Run the targeted checks from the acceptance reference and report what passed, what was visually inspected, and any remaining limitation. Do not claim whole-site coverage from a specimen or one route.

Keep `DESIGN.md` authoritative for visual meaning, CSS authoritative for runtime values, and `.impeccable/design.json` a derived preview. Update references when a confirmed shared rule changes; avoid appending every local exception to this entrypoint.
