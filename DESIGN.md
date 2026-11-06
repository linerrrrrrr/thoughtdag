---
name: ThoughtDAG
description: Editable conversations on an infinite context graph.
colors:
  accent: "#6B5CE7"
  accent-strong: "#5A4BD6"
  action: "#6251D8"
  action-strong: "#5141BF"
  warm: "#E08A3C"
  trace: "#F59E0B"
  watch: "#DC2626"
  surface: "#F4F5F7"
  card: "#FFFFFF"
  wash: "#EBEEF3"
  line: "#CDD3DD"
  line-strong: "#939FAF"
  ink: "#202632"
  ink-muted: "#515E70"
  ink-faint: "#5D6B82"
  material-note: "#FFFCF5"
  material-note-line: "#DBCEAE"
  material-note-ink: "#866424"
  material-file-line: "#B7C8DC"
  material-file-ink: "#456986"
  material-file-wash: "#EBF1F7"
  dark-accent: "#A79FF4"
  dark-accent-strong: "#B9B2F7"
  dark-warm: "#E3A45E"
  dark-trace: "#D9A83E"
  dark-watch: "#E0796F"
  dark-surface: "#171B22"
  dark-card: "#222833"
  dark-wash: "#2B3240"
  dark-line: "#465164"
  dark-line-strong: "#728098"
  dark-ink: "#E9EDF4"
  dark-ink-muted: "#BAC3D2"
  dark-ink-faint: "#A1AFC1"
  dark-material-note: "#2C2922"
  dark-material-note-line: "#655A40"
  dark-material-note-ink: "#D5BB83"
  dark-material-file-line: "#485E76"
  dark-material-file-ink: "#A9C7E3"
  dark-material-file-wash: "#2A3748"
  conversation-surface: "#FFFFFF"
  conversation-user-bg: "#EDF2FA"
  conversation-user-ink: "#263851"
  conversation-line: "#CDD3DD"
  conversation-muted: "#515E70"
  conversation-composer-bg: "#EBEEF3"
  conversation-code-bg: "#EBEEF3"
  dark-conversation-surface: "#222833"
  dark-conversation-user-bg: "#263B58"
  dark-conversation-user-ink: "#E6EEFB"
  dark-conversation-line: "#465164"
  dark-conversation-muted: "#BAC3D2"
  dark-conversation-composer-bg: "#2B3240"
  dark-conversation-code-bg: "#2B3240"
typography:
  meta:
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "'Inter Variable', 'Noto Sans SC', -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
  title:
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  heading:
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.5
  section:
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
  page:
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.333333
  mono:
    fontFamily: "'JetBrains Mono Variable', 'SF Mono', 'PingFang SC', monospace"
rounded:
  port: "2px"
  tag: "4px"
  control: "6px"
  content: "8px"
  node: "14px"
  overlay: "12px"
  panel: "14px"
  toolbar: "15px"
  conversation: "14px"
  conversation-inner: "13px"
  conversation-bubble-corner: "4px"
  conversation-bubble: "8px 8px 4px 8px"
  conversation-code: "8px"
  conversation-send: "50%"
spacing:
  compact: "4px"
  tight: "6px"
  related: "8px"
  inset: "12px"
  standard: "16px"
  content: "20px"
  canvas-inset: "16px"
  surface-inset: "16px"
  toolbar-inset: "8px"
  control-gap: "4px"
  section-gap: "12px"
  control-size: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "#FFFFFF"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 16px"
  button-primary-hover:
    backgroundColor: "{colors.action-strong}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  composer:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.content}"
    padding: "10px 16px"
  view-switch:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.control}"
    padding: "2px"
    height: "32px"
  provenance-tag:
    textColor: "{colors.accent}"
    typography: "{typography.control}"
    rounded: "{rounded.tag}"
    padding: "2px 6px"
  thought-node:
    backgroundColor: "{colors.conversation-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.conversation}"
    width: "520px"
  note-node:
    backgroundColor: "{colors.material-note}"
    textColor: "{colors.ink}"
    rounded: "{rounded.node}"
  file-node:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.node}"
  focus-panel:
    backgroundColor: "{colors.conversation-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    width: "520px"
  conversation-user-message:
    backgroundColor: "{colors.conversation-user-bg}"
    textColor: "{colors.conversation-user-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.conversation-bubble}"
    padding: "12px 16px"
  conversation-answer:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "0"
  focus-user-message:
    backgroundColor: "{colors.conversation-user-bg}"
    textColor: "{colors.conversation-user-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.conversation-bubble}"
    padding: "12px 16px"
  conversation-composer:
    backgroundColor: "{colors.conversation-composer-bg}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.content}"
    padding: "12px"
  node-metadata-editor:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "0px"
    padding: "8px 0 12px"
  node-summary-preview:
    backgroundColor: "{colors.conversation-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    padding: "16px"
---

# Design System: ThoughtDAG

## Overview

ThoughtDAG is an editable conversation canvas: readable question-and-answer cards, directional context edges, and a continuous reading panel. Cool neutral canvas controls keep graph structure legible; purple identifies mainline edges and selection, and orange identifies passage and role branches. Conversation cards and the reading panel share the canvas tool cards' surface and boundary roles, with right-aligned blue user messages and plain assistant text.

This is the application design contract and its implemented token snapshot, not a completed accessibility audit or a claim that every detail was individually approved. Rounded corners are welcome when outlines, dividers, and accents join coherently.

### Authority and maintenance

The user's confirmed direction defines the target: balanced typography, with controls at 14px and reading text at 16px at the default root size; More and Selection Properties establish the tool-card language. A component's incumbent value does not become a rule merely because it exists. When implementation differs, identify the affected role and migrate it within the requested scope.

`src/index.css` owns the shared runtime values; scoped conversation variables alias those roles in `ConversationSurface.css`. The frontmatter is a portable snapshot, checked by `node scripts/check-design-system.mjs`. After reviewing an intentional token change, `--write` synchronizes mapped fields while preserving prose and unmapped component recipes. The check covers core type, color, spacing, and radius mappings; it does not certify every override or rendered composition. Review component examples in `.impeccable/design.json` when their owning styles change. That sidecar is a derived preview, not another source of visual decisions.

The project skill at [.agents/skills/thoughtdag-design-system/SKILL.md](.agents/skills/thoughtdag-design-system/SKILL.md) routes UI work through this contract. The [acceptance guide](docs/reference/design-acceptance.md) selects checks by impact. Run the development server and open `/design-system.html` for a live specimen using application styles; verify the actual changed feature as well. The specimen uses illustrative content and local state, without writing to a user's canvas.

### Surface profiles

| Surface | Shared language | Purpose-specific behavior |
| --- | --- | --- |
| Tools and settings | More/Selection Properties surfaces, control/title roles, common selection and focus vocabulary | Compact groups, explicit actions, responsive overflow; controls remain reachable |
| Reading | Shared card, text, inset, and outline roles; body and Markdown hierarchy | Continuous prose, speaker distinction, local code scrolling, readable line width |
| Canvas | Shared object identity and full-detail reading roles | Canvas-space geometry, bounded screen-space overview compensation, stable graph footprints and editing protection |

Choose the role before choosing a size. A component recipe includes type, icon, hit area, padding, shape, and states together. Separate visible icon size from hit area. Apply concentric corners only to genuinely nested contours. Maintain optical balance across Chinese, English, and icons; repeated borders, fills, and shadows must not give auxiliary controls the weight of the primary task.

Theme changes preserve geometry. Width pressure is handled through wrapping and the existing disclosure/overflow rules. Necessary exceptions state their purpose and scope in the relevant section; they do not introduce an independent visual system. This application contract does not restyle the marketing website, exported artwork, or coordinate-based diagrams without a task that includes those surfaces.

**Key Characteristics:**

- Stable graph geometry across interaction and appearance.
- Compact controls, readable content, and restrained overlay depth.
- Distinct start, note, and file identities at every semantic zoom tier.

## Colors

Primary purple carries mainline edges, selection, and the start-node identity. Filled actions use `action` and `action-strong` with white text; they do not inherit the lighter dark-theme accent.

Secondary orange carries passage and role branches, including branches retained from existing canvases. Trace and watch colors identify ancestry and evaluator relationships. Material notes use warm paper and a muted ochre label; file nodes use cool borders and blue-grey identity marks, with extension-specific icon treatments.

Neutral surface, card, wash, line, and ink roles establish canvas, reading, hover, boundary, and text hierarchy. The `dark-*` entries record the same CSS roles under the dark-theme selector; they are appearance overrides, not additional semantic categories. Grid paper has a slightly cooler light canvas background in the source.

The `conversation-surface`, `conversation-line`, and `conversation-muted` colors alias the shared `card`, `line`, and `ink-muted` roles; composer and code backgrounds alias `wash`. Thought cards, their metadata editor, and the focus panel therefore follow More, Selection Properties, and the layout inspector in both themes. The frontmatter records the resolved light and dark values. The blue user-message surface identifies the speaker; it does not replace graph selection or the material-file identity. Assistant answers share the surrounding card surface. Material nodes and graph accents retain their existing palettes.

## Typography

Use the shared body family for interface and reading content; use the mono family for file extensions, code, and technical identifiers. Chinese fallbacks remain in the shared family stack. Estimated token counts use the body family with tabular numerals and the complete word `tokens`.

Typography is assigned by purpose, not by component. The source tokens are `--text-meta`, `--text-control`, `--text-body`, `--text-title`, `--text-heading`, `--text-section`, and `--text-page` in `src/index.css`, each paired with a `--line-height` token. At the default 16px root size, meta is 12px/18px, control is 14px/21px, body is 16px/28px, title is 16px/24px, heading is 18px/27px, section is 20px/28px, and page is 24px/32px. The title and heading roles use weight 600; body and metadata use 400, with 500 available for emphasized controls. Compatibility utilities retain their ordinary meanings: `text-xs` is 12px, `text-sm` is 14px, and `text-base` is 16px; authored application UI uses the semantic roles.

Buttons, menus, labels, short form fields, disclosures, and explanatory text share the control role across cards, panels, and settings. Reserve meta for short dates, counts, statuses, and technical identifiers. Questions, answers, activity prose, notes, source reading, and multiline editors share body, including the same text before and during editing. Compact card and panel headings use title, large dialogs use section, and page headings use page. Markdown h1/h2/h3 use page/section/heading consistently in every reading surface. Narrow layouts wrap or move secondary content rather than introduce smaller component-specific text.

Full canvas cards at 100% zoom and the focus panel share the same reading size. Overview names use title with weight 600, summary previews use control, and compact names and file identities use meta. Summary previews are intentionally denser than their full multiline editors. Overview type and insets keep the existing bounded zoom compensation: summary zoom is clamped from 0.32 to 1, and compact overview compensation retains its 0.22 lower clamp. Names can therefore appear smaller than 12 screen pixels at extreme distances; this is a canvas navigation rule, not a smaller application type role. Names remain at most two lines, with secondary previews reduced before essential identity.

Exported `.tmap-art` artwork, tutorial SVG diagrams, and the timeline ladder's dynamic type progression retain their own coordinate-dependent scales. They are separate from application UI typography; do not mechanically replace their numeric size or zoom formulas with the ordinary role scale.

## Layout

Selection Properties places Width and Height on separate rows, with labels on the left and equal-width inputs aligned to the right content edge, retaining the card's 16px horizontal inset and 12px row gap. A selection with differing dimensions shows each axis's minimum~maximum range; entering one number still applies that dimension uniformly. The size section contains only those two fields and Lock Aspect Ratio. Coordinate fields retain their existing layout.

The infinite canvas is the primary spatial model. Context arrows determine ordering. Vertical conversation chains share a column from top to bottom; horizontal chains share a top-aligned row from left to right. The layout tool offers manual, chain, or layer arrangement, direction, spacing, and default routing. Preview does not persist graph changes; Apply creates one undo step. Semantic zoom changes detail between working cards, named map cards, and compact names; it preserves graph footprints and settled port directions.

With Lock Aspect Ratio enabled, typing Width immediately updates the displayed Height, and typing Height immediately updates Width. The last edited axis drives the change; multiple nodes each retain their own ratio and show a range when their derived dimensions differ. Enter or Apply commits one reversible edit; leaving or closing the geometry editor preserves its session draft, including empty fields. Escape cancels pending dimensions without submitting. Toggling ratio lock with pending geometry first applies those fields under the previous ratio, then changes the lock state in the same undo step. Automatic content sizing remains an internal layout behavior, without a height-mode label, instructional hint, or restore action in Selection Properties.

Canvas chrome shares a (16px) viewport inset: the project/session group, action toolbar, material palette, zoom controls, minimap, export dock, and focus panel. Toolbar shells use (8px) padding around (32px) controls, with (4px) between controls; the material and zoom rails therefore share a (50px) width. Both top groups share a (50px) row height and remain on one line. As available canvas width decreases, controls shorten their labels and move secondary entries into More; open tool panels and drafts remain mounted. Dropdowns and search remain outside that row's flow.

The left project toolbar owns project and session controls: models, working directory, permissions, and transient status. Its tool cards align with the left edge below that toolbar. The right toolbar owns navigation, canvas chat, search, display preferences, layout, More, and history. Layout follows Detail; automatic backup is available inside More at every toolbar density. Its tool cards, canvas chat, object geometry, and layout inspectors dock below its right edge. Their shared active slot follows [Toolbar and card visibility](#toolbar-and-card-visibility). The independent reading panel remains available when space permits.

Top toolbar corners follow the nested controls concentrically: the (6px) control radius plus (8px) padding and the (1px) shell border gives a (15px) outer radius. Keep this inset equal on every side, including compact layouts. Project and source-session entries use borderless resting states with hover, expanded, and keyboard-focus feedback; model connection retains a quiet accent fill without another outline. This applies Apple's [concentric corner principle](https://developer.apple.com/videos/play/wwdc2023/10076/) to the existing desktop control scale, rather than importing spatial-input target sizes.

The action toolbar separates functional groups with 16px gaps and uses 4px between related controls. Selected modes and open tools share the same 9% accent fill and accent text while retaining their distinct ARIA semantics; open tools keep this feedback on hover, including model, directory, and permission entries. Non-default detail settings use a small accent dot instead of a persistent filled trigger. The detail trigger uses a short label; its tooltip and accessible name identify the current setting. Node/connection/frame selection belongs to the confirmed marquee's contextual controls, not the permanent top toolbar; it uses the same restrained selection vocabulary without another filled track.

Search is subordinate to the toolbar: its 40px input row uses 14px regular text, a short placeholder, and a single enclosing focus boundary without an added shadow or nested ring. The 14px keyboard instructions appear below results only and describe the input for assistive technology. Search remains outside the toolbar row and retains its existing selection, location, and dismissal behavior.

Double-clicking the non-interactive node header opens its focus panel, switches to that node, or closes the panel if it already shows that node, retaining session drafts; the details icon follows the same toggle behavior without changing canvas selection, while the context-menu entry explicitly opens details. The focus panel has a default width matching the thought card; it is resizable from (380px), constrained to the viewport, and capped at (70vw). Its resize grip has no hover or click tooltip. Windows below (960px) automatically close the panel while retaining selection and session drafts; expanding the window does not reopen it. Reading sections, metadata, inspection sections, and the header share a (16px) horizontal inset at every panel width; the maximum reading width remains (760px). The header has a (56px) minimum height and (12px 16px) padding. The scrolling content has (12px) vertical padding; metadata ends with a (12px) gap, and question and answer sections each end with a (16px) gap. Narrow panels retain their insets and message padding while widening user messages to (94%). Answered nodes have no pinned composer; the reading area extends to the panel bottom.

Conversation cards have three regions: a draggable status/action header, a full-width name-and-summary section, and the question-and-answer body. The header has a (52px) minimum height, (12px 16px) padding, and (10px) column gaps with (8px) row gaps. Its token estimate is immediately followed by the wrench and tool-call count on one line with a (12px) gap. A (6px)-high composition bar with a continuous (1px) neutral perimeter below spans the full group width, with a (104px) minimum group width. The number, bar, tool mark, and surrounding header remain drag targets. The metadata section shares the (16px) horizontal inset, a bottom divider, and a background mixing (40%) wash with the card surface. Its folded entry has a (38px) minimum height; the expanded fields use (12px) gaps and (8px 0 12px) padding with no inner border, radius, or filled card. Working conversation bodies use (16px) padding on every side. User messages use (12px 16px) padding with no extra top margin and a (16px) gap before the answer. They align right and occupy at most (88%) of the card reading width, increasing to (94%) in narrow cards; panel messages use (90%) before their narrow override. Assistant text uses the full reading width without another padded box.

Token estimates are static header metadata: hovering, focusing, or clicking the total, tool count, or bar never opens a detail popup. The group has no extra keyboard stop. The estimate covers the current turn's saved question, answer, tool records, and recorded thinking; it excludes ordinary attachments and upstream context and does not represent API billing usage. Missing thinking contributes no invented segment. Muted purple, blue-grey, ochre, and teal identify the four parts in both themes. The bar uses one hard-stop linear gradient clipped to the padding box inside a continuous (1px) neutral perimeter. The tool indicator shows only its wrench icon and count. All parts remain header drag targets.

Material working cards and general map overviews retain their (16px) content insets, compact names use (8px), and related overview text is separated by (8px). General map and compact insets retain zoom compensation. Conversation summary previews show a two-line name above a three-line summary with (16px) padding on every side; their shared title (16px) and control (14px) type roles and inset values describe screen-space targets. The summary scale divides these values by the canvas zoom clamped between (0.32) and (1), preserving readability without unbounded growth at extreme distances. Long names, URLs, and source text wrap within their surfaces. These presentation rules do not rearrange nodes or change context-arrow ordering.

## Toolbar and card visibility

The confirmed marquee's node/connection/frame choice is a small screen-space toolbar above the right tool-card dock, right-aligned with the card and showing three independently computed candidate counts. Toolbar-to-choice and choice-to-card gaps both use the 16px canvas inset token. Frames are canvas organization objects and never count as graph nodes. This position is consistent across viewport widths and remains independent of the selection rectangle, canvas zoom, and pan. Right tool cards reserve this row; narrow left cards also avoid it. All three text choices remain visible, including when the card is closed or replaced while the selection region remains. It does not participate in the cards' replacement slot. Ordinary clicks and select-all do not create it, and a completely empty marquee has no type controls. A new non-additive marquee starts with nodes; clearing the region ends its type choice.

Selection Properties is one inspector for nodes, connections, frames, and mixed selections. Object type determines its fields; quantity determines the edit scope and mixed-value state; click and marquee selection use the same inspector and session draft. The fixed title is followed by typed counts. Mixed selections expose labeled sections, each editing only its stated objects without changing the selected set. Shared values are shown directly; differing values remain distinct from empty values and untouched fields. Geometry and connection edits apply only changed fields, with explicit submission and reversible commits. Single connections may additionally expose endpoint navigation. Frame selection does not select its contents; content selection, linked movement, fitting boundaries, and frame-only deletion remain explicit operations. Closing the inspector preserves selection and drafts and removes previews; Escape cancels the top editing layer before closing the inspector. Property fields and content-generating or destructive actions occupy separate groups. The independently pinned reading subject is not the selection's implicit edit target.

Classify an entry before choosing its visibility or emphasis. The same accent vocabulary can support different roles, but an open surface, an effective setting, a selection scope, and an executable action are separate states.

| Entry role | Examples | Visibility and feedback |
| --- | --- | --- |
| Card trigger | Layout, canvas chat, search, navigation, More, project, model, directory, permissions | Expanded feedback and `aria-expanded` follow the surface actually displayed. Closing or replacing it clears expanded feedback, including while hovered; current project/model values remain visible. Activating an already open toggle closes its card. |
| Persistent setting | Detail level | The value remains effective after its card closes. Use the current value or a light marker for that state; Detail uses its accent dot for a non-default value. The trigger's expanded fill still ends with the card. |
| Selection context | Nodes/connections/frames within a confirmed marquee | Show the choice only after a marquee establishes a selection region, within that region's contextual controls. Clearing the region removes the choice; an empty result for one type retains the region and the ability to switch back. Use selection semantics, such as `aria-pressed`, rather than expanded feedback. |
| Direct action | Undo, redo | Show availability, focus, and press feedback. A completed action does not acquire a persistent expanded state. |

At the same available width, opening, closing, or replacing a card preserves top-toolbar order, grouping, dimensions, and button positions. Feedback stays on the relevant trigger; do not recolor or replace the whole toolbar. Card bodies, search, previews, and apply/cancel actions remain outside its row. Temporarily unavailable actions retain their place with disabled feedback and an accessible reason. Contextual controls appear because their task context exists, not merely because another card is open or closed; their appearance must not shift the top toolbar.

The left/right toolbar cards, Selection Properties, Layout, and canvas chat share one active slot. Replacement closes the previous card; it is not a hidden stack. For example, Layout → More → close More leaves the slot empty. Only an explicit reopening action restores a card and its retained session draft. Replacement itself preserves canvas selection and never applies configuration or sends content. The independent node reading panel is outside this slot. Drafts, invalidated previews, sensitive fields, and layered Escape behavior follow the [interaction contract](docs/reference/interaction-contract.md); visual unification does not make temporary menus and working panels share the same outside-click behavior.

Responsive overflow is a separate transition: changing available width may shorten labels or move entries into More, but does not itself close an active tool card or discard its draft. Keyboard exit returns to the available trigger, or More when the trigger is collected there. Check visibility transitions in the actual application using the [acceptance sequences](docs/reference/design-acceptance.md#toolbar-card-visibility); a token snapshot or static specimen cannot establish these behaviors.

## Elevation & Depth

Canvas nodes and content cards have no shadow. Borders, selection outlines, and surface tones provide hierarchy. Overlay elevation uses the shared shadow vocabulary: small for the minimap, medium for tooltips, and large for menus. The conversation focus panel has its own soft overlay shadow. Exact shadow and motion values live in the sidecar.

The minimap has one light shadow, clipped corners, a block-level SVG, a thin viewport boundary, and a lightly tinted outside mask. Its hover enlargement grows from the bottom-right corner; node hover changes border appearance without moving the graph.

## Shapes

Use the semantic radius hierarchy from the frontmatter. Appearance changes never change geometry. A node has one continuous rounded outline; type colors also appear in its header control.

Conversation, note, and file cards use the shared node radius, which aliases the (14px) panel radius. Conversation headers and summary ends use a (13px) inner radius inside the (1px) border. User bubbles use the (8px) content radius with a (4px) lower-right tag corner; assistant answers have no bubble border or background. Code blocks, question editors, and composers use the (8px) content radius, and metadata actions use the (6px) control radius. Conversation metadata fields sit directly in their full-width section with no nested rounded editor. Send controls are circular. The focus panel retains the shared (14px) panel radius. Compact overview corners retain their separate zoom-compensated form.

The start node deliberately strengthens its own left border (3px at working scale). This is part of the card boundary and shares its corners, not an independent stripe. Map and compact modes compensate that edge for zoom. Small squared ports remain visible outside the card, with larger invisible hit targets.

Working ports measure (12px) and overview ports (16px) in canvas coordinates. Conversation and material cards share the same resize controls: a short edge mark and a two-line diagonal corner mark, inset (6px) in screen coordinates toward the corner. Visible length follows (14px × zoom), bounded to (12–16px) on screen; edge strokes stay (2px), and transparent targets stay (32px) throughout the zoom range. This keeps controls legible when zoomed out and restrained when enlarged. Marks use `ink-faint` at rest and `accent` for hover, keyboard focus, or the active drag; they have no filled tile or enclosing border. Above 100% zoom, the node corner target shifts inward by up to (4px) on screen to follow the enlarged rounded contour; fit checks include this offset. The multi-selection boundary uses the same screen-size recipe and suppresses individual node handles.

The width grip sits on the right edge, moving below the header-level connection port on short cards. The height grip prefers three quarters of the bottom edge and shifts between the central connection port and corner when needed. Both reserve a (4px) screen gap between invisible targets. If the available screen length cannot fit an edge control, it yields to the corner and Selection Properties controls; crowded multi-selection boundaries also hide the affected edge grip. An active grip remains available until its gesture ends. Wiring hides resize controls; resizing quiets and disables the relevant connection targets. Single-node and multi-selection gestures support arrow-key adjustments (1 unit, or 10 with Shift), Escape/pointer-cancel restoration, and one undo step per completed drag. Resizing a working card preserves its existing semantic-zoom behavior. While the metadata editor temporarily owns natural height, only unlocked width adjustment remains available; fixed-height and proportional handles resume when the editor closes. Fixed-height material cards scroll their name and body together inside the shared surface inset so short cards retain their outer boundary and ports.

At extreme distances, a corner control also yields when it would cover connection targets or exceed the shortest multi-selection boundary. Selection Properties remains the precise-size route. These fit checks never change semantic-detail thresholds or end an active resize gesture.

Arrowheads use a fixed canvas size independent of stroke thickness, reducing only when a very short connection cannot accommodate one. They sit on their own route before the receiving port, follow the local tangent, and stagger at shared entrances so the port does not cover the direction. Selected and highlighted connections use a restrained (2.5px) stroke. Edge routes and node positions remain independent of these visual sizes.

## Components

- **Actions and navigation:** Filled actions retain white text in both themes. Secondary controls use a fine border and wash hover. The embedded view switch shares the project control's height; its active segment uses ink and card colors. Keyboard focus uses an accent outline.
- **Pointer semantics:** Grab appears only on an enabled drag target; grabbing follows an active drag. Click actions use pointer, prose and inputs use text, inert card padding uses default, and the canvas marquee uses crosshair. Node handles follow actual drag availability, including read-only and preview states. Header controls must opt out of dragging; resize and connection targets keep their dedicated cursors. See the [interaction contract](docs/reference/interaction-contract.md).
- **Layout inspector:** Follow the More and Selection Properties cards. Use the shared canvas-tool-panel shell, 16px horizontal and 12px vertical content padding, 12px group gaps, and 6px label-to-control spacing. Titles use the shared 16px/24px semibold title role; field labels use 14px medium text. Segmented choices match More's appearance controls: one 6px-radius outer border, internal dividing lines, 14px text, 6px vertical padding, and no padded track or separate rounded tiles. Selected options use accent at 10% opacity with accent text and 500 weight. Cancel and Preview use Selection Properties's plain 32px-minimum actions; Apply uses its filled action style. The footer uses 8px padding and 4px gaps. Appearance does not change draft, preview, apply, or dismissal behavior.
- **Question entry:** Answered cards and their reading panels contain no follow-up field, send toolbar, or composer settings. Continue by dragging a connection into an empty question node. The new node owns its input and explicit send action. Ordinary text selection has no question action; the highlighter remains an explicit reading tool. Existing generic composers elsewhere retain their wash surface and control vocabulary.
- **First question:** One conversation-composer surface contains the textarea and a bottom action row, with (12px) padding and (8px) internal spacing. Search switches sit on the left and a circular (32px) send button on the right; all use (16px) icons. The send button follows the same submission path as Enter and is disabled for an empty draft. Only the container draws the active input boundary.
- **Tags:** Small rounded provenance and role labels carry concise metadata. Text remains the primary means of identification.
- **Conversation nodes:** A fine continuous border, type-colored header control, stable connection ports, and an accent selection outline. Start nodes additionally retain their own left-border identity. The question is a right-aligned blue message; the answer is continuous text on the card surface. Compact answer actions follow the text. The status/action header remains the drag target; editing controls and readable content retain their own interaction boundaries.
- **Node name and summary:** Complete cards show a disclosure in their own full-width section until editing begins. Reduced-detail cards display the saved name and summary directly; a click enters the same editor. The title and summary sit directly in that section, with AI fill at the lower left and cancel/save at the lower right. AI results fill the draft; explicit Save commits both fields. The canvas and focus panel share the same session drafts, including cleared values. Opening the editor temporarily accommodates its full height without replacing the stored node dimensions.
- **Highlights:** Full conversation cards and reading panels place a separate collapsible highlights section after name and summary. Its header keeps the highlighter available even when the list is empty or folded; folding only changes visibility. Expanded content shows complete passages, deletion, and downstream highlight modes within a bounded scroll area. The answer keeps its inline marks without duplicate excerpt chips. Regenerate, copy response, and edit response stay below the answer with explicit hover labels.
- **Notes:** Warm paper distinguishes text material from a generated answer. An explicit material label, readable body spacing, and the same warm surface persist through reduced-detail modes.
- **Files:** A cool bordered surface contains file rows. Derive each icon category and visible extension from its actual filename; show the filename and available actual byte size. Tables, notebooks/code, images, and other documents use their corresponding identities. Existing image/PDF previews use source assets.
- **Overview names:** Start, note, and file variants carry identity across all three tiers. Reduce generic icon and preview detail before sacrificing the name; compact files retain one extension, larger overviews up to three.
- **Focus panel:** The header identifies the reading node and exposes compact actions. The name-and-summary editor precedes the user question; the assistant answer follows on the continuous neutral surface. Role, attachments, recall, and context inspection follow the conversation with restrained dividers. The reading surface fills the remaining height without a follow-up footer. Active tasks expose Stop in the header and a temporary instruction editor through More; completed tasks have neither. Avoid repeated raised card shells inside it.
- **Connections:** Four possible edge sites share input/output roles; show used sites and the natural output, revealing candidates on hover or connection drag. Side ports align near the title baseline. Automatic facing sides follow geometry independently of continuation/reference semantics. Clicking a line opens a 340px right editing card whose height follows its content; it moves to the bottom on narrow screens. Ordinary connections offer only continuation or single-node reference: references carry the source turn's question and answer, without ancestors or attachments. There is no upstream preview or scope selector. Two illustrated routing choices offer curved and elbow paths, with no reset-to-layout action; annotations stay collapsed until needed. Aligned facing ports remain straight; offset facing ports use a whole-span S curve. Curved obstacle detours retain continuous tangents, independently of rounded orthogonal routing. Shared exits and entrances retain stable ordering and separate only where geometry requires it. The routing contract and implementation references live in [edge-routing.md](docs/reference/edge-routing.md). Route and annotation changes do not change context content, and no floating action bar obscures the line.

## Editing and dismissal

Multi-source conversation headers expose a light **Context · N sources / 上下文 · N 路** entry. It opens a nearby temporary source card without changing the canvas selection or reading subject. Ordinary wires carry no permanent order numbers. While inspecting, structural order numbers sit beside their own routes; hovering or focusing a source traces its edge and endpoints. The source card lists incoming conversation blocks in order and separates references from that ordering. Reordering is explicit and reversible; closing the card clears inspection only. Used ports remain visible but quiet at rest and gain emphasis during hover, keyboard focus, wiring, or source tracing. Port sides remain geometric, never semantic.

Object actions use one semantic vocabulary across cards, menus, and reading surfaces. Creating another canvas object is **Duplicate / 创建副本** (`Files`); clipboard operations name the content, such as **Copy response / 复制回答**, **Copy context / 复制上下文**, or **Copy link / 复制链接** (`ClipboardCopy`). File actions use **Export (.extension) / 导出 (.扩展名)** (`FileDown`), with an object name when the scope needs it. Selection exports include selected content nodes; context-chain exports retain their distinct scope. Frame actions explicitly distinguish frame-only copies, copies with contents, and deleting frames while keeping contents. Do not invent missing actions to complete a three-button set.

Compact card actions use the scope already stated by their card or section: **Duplicate / Export / Delete** (**创建副本 / 导出 / 删除**). Fixed export formats belong in the supplemental tooltip or accessible name; export menus with multiple outputs still identify the format or target. Frame actions retain the visible **仅分区 / 含内容** distinction, and **仅删除分区** states the restricted deletion scope; its confirmation still explains that contents remain. Shorten redundant wording before changing spacing, and keep the control text size and hit area. At the standard tool-card width, the three object actions share one row in both languages.

Deleting an object uses `Trash2`, never the close icon. Text delete actions use the shared watch color; icon-only delete actions stay muted until hover or keyboard focus. Their `object-action-danger` feedback uses theme tokens, not hard-coded red palettes. Accessible names identify the target (node, response version, highlight, role, provider, or canvas). Removing an attachment, reference, or scan-folder configuration remains **Remove / 移除** because it does not delete its source object. Sizes and placement follow the owning surface; long labels wrap instead of shrinking. Keep existing handlers, confirmation flows, drafts, and undo semantics. See the [card action inventory](docs/reference/design-acceptance.md#card-action-inventory) for scope and checks.

Only concise action names, shortcuts, scope labels, and clipped names or paths may use the shared short-hint surface. Authored DOM must not use native `title` attributes: retained hints opt in through `data-tooltip`, with permanent accessible names on icon controls. Use `data-tooltip-icon-only` for responsive controls and `data-tooltip-overflow` for actual clipping. Do not create rich token breakdowns, independent timeline previews, paragraph-sized explanations, or help-only focus stops. Necessary authorization or execution information belongs visibly beside its action. Retained hints use the shared control text, neutral card/line/ink roles, and control radius; they dismiss on Escape or pointer down and never restore a native title or consume canvas gestures. The current inventory and individual decisions are in [tooltip-audit.md](docs/reference/tooltip-audit.md).

Short, reversible names commit on outside click or focus leaving the complete editor. Content editors suspend with a session draft; explicit save commits, Escape cancels. Sending, generation, authorization, deletion, and configuration submission require an explicit action. Escape dismisses only the topmost layer. Pointer dismissal never steals the next target's focus. Persistent work panels remain available beside the canvas.

Use the shared dismiss-layer and inline-edit hooks. Preserve empty drafts, protect IME composition, keep editor buttons inside the same boundary, and manage modal focus. The scenario matrix, implementation contract, and acceptance checks live in [interaction-contract.md](docs/reference/interaction-contract.md).

## Do's and Don'ts

### Do

- Do use the semantic radius tokens and a continuous card outline.
- Do preserve context-arrow order and the selected row or column alignment within each conversation chain.
- Do keep top-left project and session controls aligned at the same height.
- Do retain node names and file extensions when reducing visual detail.
- Do use actual filenames, extensions, and available file sizes.
- Do verify light and dark appearances without changing component geometry.

### Don't

- Don't replace coherent rounded corners with an all-square interface.
- Don't add a detached decorative stripe that breaks a card's outline.
- Don't translate nodes on hover or clip their external connection ports.
- Don't add stacked shadows to the minimap or turn its viewport mask into a dark slab.
- Don't nest raised cards throughout the focus panel's reading area.
- Don't invent file metadata, previews, or promotional third-party UI copy.

Source of truth: `src/index.css`, `src/components/NodeOverview.css`, `src/components/ConversationSurface.css`, `src/components/NodeTokenUsage.css`, `src/components/focus-panel/FocusPanel.css`, and the corresponding node, metadata editor, token usage, tooltip, project switcher, focus panel, and minimap components. Update this snapshot and its sidecar together when those definitions change. Sidecar tonal ramps are preview aids, not additional application tokens.

