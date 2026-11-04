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
typography:
  body:
    fontFamily: "'Inter Variable', 'Noto Sans SC', -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', 'Segoe UI', sans-serif"
    fontSize: "1rem"
    lineHeight: 1.6
  label:
    fontSize: "0.875rem"
    lineHeight: 1.45
  caption:
    fontSize: "0.8125rem"
    lineHeight: 1.35
  overview-name:
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.4
  node-meta:
    fontSize: "12px"
    lineHeight: 1.4
  mono:
    fontFamily: "'JetBrains Mono Variable', 'SF Mono', 'PingFang SC', monospace"
rounded:
  port: "2px"
  tag: "4px"
  control: "6px"
  content: "8px"
  node: "8px"
  overlay: "12px"
  panel: "14px"
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
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 16px"
  button-primary-hover:
    backgroundColor: "{colors.action-strong}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
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
    typography: "{typography.caption}"
    rounded: "{rounded.tag}"
    padding: "2px 6px"
  thought-node:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.node}"
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
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    width: "520px"
---

# Design System: ThoughtDAG

## Overview

ThoughtDAG is an editable conversation canvas: readable question-and-answer cards, directional context edges, and a continuous reading panel. Cool neutral surfaces keep graph structure legible; purple identifies the main conversation and orange identifies exploration.

This documents the implemented visual system, not a completed accessibility audit or a claim that every detail was individually approved. Rounded corners are welcome when outlines, dividers, and accents join coherently.

**Key Characteristics:**

- Stable graph geometry across interaction and appearance.
- Compact controls, readable content, and restrained overlay depth.
- Distinct start, note, and file identities at every semantic zoom tier.

## Colors

Primary purple carries mainline edges, selection, and the start-node identity. Filled actions use `action` and `action-strong` with white text; they do not inherit the lighter dark-theme accent.

Secondary orange carries exploration branches. Trace and watch colors identify ancestry and evaluator relationships. Material notes use warm paper and a muted ochre label; file nodes use cool borders and blue-grey identity marks, with extension-specific icon treatments.

Neutral surface, card, wash, line, and ink roles establish canvas, reading, hover, boundary, and text hierarchy. The `dark-*` entries record the same CSS roles under the dark-theme selector; they are appearance overrides, not additional semantic categories. Grid paper has a slightly cooler light canvas background in the source.

## Typography

Use the body family for interface and reading content; use the mono family for tokens, extensions, and technical metadata. Chinese fallback fonts remain part of the shared family stack.

The small interface scale is deliberately readable. Markdown answers use a more open line height (1.7), while note material uses (1.85). Overview names are medium-weight, at most two lines; nearby previews are secondary. Compact overviews reduce the screen-space name size to (12px), hide generic icons, and keep the first file extension visible. Zoom compensation has a lower clamp so names can shrink at extreme distances.

## Layout

The infinite canvas is the primary spatial model. Context arrows determine ordering. Vertical conversation chains share a column from top to bottom; horizontal chains share a top-aligned row from left to right. The layout tool offers manual, chain, or layer arrangement, direction, spacing, and default routing. Preview does not persist graph changes; Apply creates one undo step. Semantic zoom changes detail between working cards, named map cards, and compact names; it preserves graph footprints and settled port directions.

Canvas chrome shares a (16px) viewport inset: the project/session group, action toolbar, material palette, zoom controls, minimap, export dock, and focus panel. Toolbar shells use (8px) padding around (32px) controls, with (4px) between controls; the material and zoom rails therefore share a (50px) width. Both top groups share a (50px) row height and wrap within the visible canvas when the reading panel or a narrow window reduces available space. Dropdowns remain outside that row's flow.

The focus panel has a default width matching the thought card; it is resizable from (380px), constrained to the viewport, and capped at (70vw) from the medium breakpoint. Its header, reading sections, and bottom composer align to one (16px) content inset without accumulating nested horizontal padding.

Working cards and map overviews use (16px) content insets, compact names use (8px), and related overview text is separated by (8px). Map and compact insets follow the same zoom compensation as their text, keeping the text-to-padding ratio stable. Conversation headers use (8px) vertical padding around (28px) controls, with quieter (12px) token metadata; material headers retain (12px) vertical padding. Long names, URLs, and source text wrap within their surfaces. These spacing changes do not rearrange nodes or change context-arrow ordering.

## Elevation & Depth

Canvas nodes and content cards have no shadow. Borders, selection outlines, and surface tones provide hierarchy. Overlay elevation uses the shared shadow vocabulary: small for the minimap, medium for tooltips, large for menus and the focus panel. Exact shadow and motion values live in the sidecar.

The minimap has one light shadow, clipped corners, a block-level SVG, a thin viewport boundary, and a lightly tinted outside mask. Its hover enlargement grows from the bottom-right corner; node hover changes border appearance without moving the graph.

## Shapes

Use the semantic radius hierarchy from the frontmatter. Appearance changes never change geometry. A node has one continuous rounded outline; type colors also appear in its header control.

The start node deliberately strengthens its own left border (3px at working scale). This is part of the card boundary and shares its corners, not an independent stripe. Map and compact modes compensate that edge for zoom. Small squared ports remain visible outside the card, with larger invisible hit targets.

Working ports measure (12px), overview ports (16px), and the corner resize grip (18px) in canvas coordinates. Visible resize grips scale with the card; their invisible hit areas compensate for zoom. The bottom grip stays at three quarters of the width, clear of the central connection port. Arrowheads use a fixed canvas size independent of stroke thickness; selected and highlighted connections use a restrained (2.5px) stroke. Edge routes and node positions remain independent of these visual sizes.

## Components

- **Actions and navigation:** Filled actions retain white text in both themes. Secondary controls use a fine border and wash hover. The embedded view switch shares the project control's height; its active segment uses ink and card colors. Keyboard focus uses an accent outline.
- **Composer and fields:** The composer is an inset wash surface with an expanding, borderless textarea. Focus belongs to the padded container; standalone fields keep their focus outline.
- **First question:** One wash surface contains the textarea and a bottom action row, with (12px) padding and (8px) internal spacing. Search switches sit on the left and a (32px) send button on the right; all use (16px) icons. The send button follows the same submission path as Enter and is disabled for an empty draft. Only the container draws the active input boundary.
- **Tags:** Small rounded provenance and role labels carry concise metadata. Text remains the primary means of identification.
- **Conversation nodes:** A fine continuous border, type-colored header control, stable connection ports, and an accent selection outline. Start nodes additionally retain their own left-border identity.
- **Notes:** Warm paper distinguishes text material from a generated answer. An explicit material label, readable body spacing, and the same warm surface persist through reduced-detail modes.
- **Files:** A cool bordered surface contains file rows. Derive each icon category and visible extension from its actual filename; show the filename and available actual byte size. Tables, notebooks/code, images, and other documents use their corresponding identities. Existing image/PDF previews use source assets.
- **Overview names:** Start, note, and file variants carry identity across all three tiers. Reduce generic icon and preview detail before sacrificing the name; compact files retain one extension, larger overviews up to three.
- **Focus panel:** One reading surface with section dividers, compact header actions, and one pinned follow-up composer. Avoid repeated raised card shells inside it.
- **Connections:** Four possible edge sites share input/output roles; show used sites and the natural output, revealing candidates on hover or connection drag. Side ports align near the title baseline. Automatic facing sides follow geometry independently of continuation/reference semantics. Clicking a line opens a 340px right editing card whose height follows its content; it moves to the bottom on narrow screens. Ordinary connections offer only continuation or single-node reference: references carry the source turn's question and answer, without ancestors or attachments. There is no upstream preview or scope selector. Two illustrated routing choices offer curved and elbow paths, with no reset-to-layout action; annotations stay collapsed until needed. Aligned facing ports remain straight; offset facing ports use a whole-span S curve. Curved obstacle detours retain continuous tangents, independently of rounded orthogonal routing. Shared exits and entrances retain stable ordering and separate only where geometry requires it. The routing contract and implementation references live in [edge-routing.md](docs/reference/edge-routing.md). Route and annotation changes do not change context content, and no floating action bar obscures the line.

## Editing and dismissal

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

Source of truth: `src/index.css`, `src/components/NodeOverview.css`, and the corresponding node, project switcher, focus panel, and minimap components. Update this snapshot and its sidecar together when those definitions change. Sidecar tonal ramps are preview aids, not additional application tokens.

