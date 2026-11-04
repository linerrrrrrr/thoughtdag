# Canvas, navigation, and frames

## Move around the canvas

- **Hold the middle or right mouse button and drag** to pan, or **hold Space and left-drag**.
- **Wheel or two-finger scroll** pans by default; scrolling inside node text still reads that text. The ⋯ menu can switch ordinary scrolling back to zoom.
- **Ctrl/⌘ + scroll or pinch** zooms around the canvas viewport center, including when the pointer is inside a node or editor. On a Magic Mouse, Control + click opens the context menu.
- **Left-drag on empty space** to select the object type chosen under **Select → Nodes / Lines** in the top toolbar. Nodes and complete groups must fit inside the box; lines are selected where their visible paths cross the box. Ctrl / Cmd / Shift adds to the selection, and Ctrl / Cmd + A selects all objects of the current type.
- **Drag a node** to change its position.

The minimap and zoom controls provide another way to move through a large graph.

<img src="../map-en.gif" alt="A real canvas moving between full nodes, takeaway plaques, and icon-level semantic zoom" width="100%" loading="lazy"/>

## Change reading distance

With **Detail → Follow zoom**, zooming out changes a node from a full card to a named overview and then to a compact name. Its position and connections stay the same. Detail changes presentation only; it does not change model context or generate summaries.

Use **Detail** in the toolbar to choose **Compact**, **Summary**, or **Full** for unlocked nodes, independently of zoom. Full keeps content available even in a distant overview. Select a node in the same panel, or right-click it, to lock that node to a level. **Follow canvas (unlock)** restores the global setting. Node locks are saved with the project and can be undone; the global preference is remembered in this browser. Editors and pending human-input controls stay expanded until the interaction ends. Use a locked node's reading action to read its content without changing its lock.

At the map and glyph tiers, two actions appear at the bottom of the canvas: **Export thought map** and **Continue last thread**.

<img src="../map-dock-en.png" alt="A real ThoughtDAG map tier showing Export thought map and Continue last thread at the bottom" width="100%" loading="lazy"/>

## Generate a thought map from the canvas

Choose **Export thought map** to recompose the current nodes, wires, materials, and key marks as a shareable image. It is not a screenshot of the current viewport.

You can:

- write a public title, note, and signature, or ask the current model to draft the words;
- switch between **Tidy** and **As arranged**;
- adjust rotation, paper, map language, type size, counts, time ink, and date;
- check the feed thumbnail before downloading the PNG.

<img src="../thought-map-dialog-en.png" alt="The real ThoughtDAG thought-map exporter with text, layout, paper, language, counts, and date controls" width="100%" loading="lazy"/>

Exporting creates a separate image. It does not move canvas nodes or change model context.

Four exports, from a single thread to a branching literature review:

<img src="../thought-map-four-en.png" alt="Four Thought Map exports showing different patterns of exploration, from a single thread to a branching literature review." width="100%" loading="lazy"/>

## Continue the last thread

Hover **Continue last thread** to reveal the most recently active conversation node on the map. Click it to fly back, restore a readable zoom, and open that node's panel.

<img src="../continue-last-thread-en.gif" alt="Clicking Continue last thread on a zoomed-out map, flying back to the most recently active node, and opening its panel" width="100%" loading="lazy"/>

After arriving, continue the conversation directly or choose **Summarize to a note**. The recap lands as an unwired note: it is editable and deletable, but does not enter model context automatically.

Use search and keyboard navigation below when you know the target. Use **Continue last thread** when you are returning after a break and want to resume where the work last changed.

## Find a node

- Choose **Search** at the top right, or press `Cmd+F` / `Ctrl+F`, to find questions, answers, notes, highlights, links, or material names.
- As you type, non-matching nodes fade. Use `↑` / `↓` to choose a result and press `Enter` to fly there, open its panel, and reveal the matching passage.
- Select a node to reveal its structural path toward the root.
- Use the arrow keys to move along structural wires and press `Esc` to step out. See [Keyboard shortcuts](/reference/shortcuts) for the complete list.
- When frames exist, the **Frame navigator** appears at the top right and jumps between named regions.

<img src="../canvas-navigation-en.gif" alt="The real interface showing node search, the frame navigator, and Tidy layout in the More actions menu" width="100%" loading="lazy"/>

The recording cycles through **Search nodes → Frame navigator → Tidy layout in More actions**.

## Arrange the graph

**Tidy layout** lives in the top-right [More actions menu](/guides/interface-overview#more-actions-menu). After confirmation, it follows wire direction, keeps a conversation chain vertically aligned, and moves branches to the side. Frames keep their positions. Ungroup the canvas before running Tidy layout so it cannot break a group's internal arrangement.

When multiple objects are selected, **Align** and **Group** appear side by side in the upper-right selection toolbar. Align offers six edge or center alignments and horizontal or vertical distribution, relative to the selection or the visible canvas. Each group counts as one rigid object. These actions preserve context wiring; arrangements that would overlap nodes or violate conversation order report the reason. **Arrange in conversation order** remains available for a vertical conversation column.

Drag anywhere in the tinted selection region, including gaps between cards, to move the selected objects together. Linked frames carry their contents without moving any object twice. Drag the selection's right, bottom, or bottom-right handle to change all selected nodes' width, height, or both while their positions stay fixed. Aspect locks and size limits are respected; corner drags use the larger relative dimension change for locked nodes. Each move or resize is one undo step, and Escape cancels an active drag while keeping the selection. Focus the move region or a handle and use arrow keys for 1 px adjustments, or Shift + arrow for 10 px. Explicitly resized heights remain visible in compact overviews.

Switch to **Lines** to edit connections independently. Switching from nodes selects connections between those nodes; switching back selects the chosen lines' endpoints. **Edit selected lines** applies only changed purpose, path, or label fields in one undoable step. Special connections keep their fixed purpose. Closing retains the session draft, including a cleared label; Escape cancels the draft first. Confirmed deletion removes only the selected lines.

**Group** fixes the relative positions of its members during dragging, alignment, and distribution. Groups are saved with the canvas and remain after deselection or reload, until **Ungroup** is used. **Regroup** restores surviving former members that have not joined another group. Grouping creates no context node, merges no answers, and triggers no synthesis. Use a member's View details button to read it without changing the group selection; content actions still operate on the explicitly selected nodes. Align nodes first, then group them to keep that arrangement.

Use a group member's book button or **View details** context-menu action to read it while keeping the group selection and Object format panel available. Reading stays on that node while canvas clicks change the selection. Another explicit **View details** action switches the reader; closing it preserves the selection.

## Use frames

Frames label and visually group a region. Use them when several branches still belong to the same project but need readable sections: click or drag the **Frame** button at the bottom of the left material palette, place the frame, then edit its title and color.

You can also choose **Create frame from selection** in the selection toolbar's **Group** menu. Grouping first is optional. The new frame surrounds the selected nodes and complete groups, ready for a title, while their positions, existing groups, and context wires stay intact. Frames themselves cannot join a group.

The chain button at a frame's top right controls movement. When **linked**, dragging or aligning the frame carries its contents; when **unlinked**, only the frame moves. Frames created from a selection start linked. Manually drawn frames start unlinked so their bounds can be adjusted first.

Membership is spatial: independent nodes, complete groups, and nested frames must fit entirely inside. Cross-boundary objects stay intact and are not carried. Changing frame bounds changes membership; overlapping frames can share objects, which are deduplicated for movement, selection, and copying. Frames name, organize, and navigate regions without entering context. Use the **Frame navigator** to jump between named regions. Hiding annotations simplifies the view without deleting content.

Click a frame's title or border to select it; Ctrl / Cmd / Shift adds it to the selection. Empty space inside a frame can start a marquee. Selecting a frame does not select its contents. Double-click its title to rename it, or use the carry icon to change movement behavior. Other properties are centralized in **Frame settings**.

Frame settings contains name, color, size and position, aspect lock, movement behavior, and current membership counts. Names can be cleared. Multiple selected frames can share color, dimensions, ratio lock, and movement behavior; their names are not edited together. Name and geometry inputs retain the Enter-to-commit and Escape-to-cancel conventions.

- **Select frame contents** selects contained nodes and complete groups for explicit content actions, such as synthesis, exploration, archive, and Markdown export. Frames themselves are excluded from content actions.
- **Select frames and contents** also selects the outer and nested frames, without duplicates.
- **Fit bounds to contents** takes a snapshot of current contents and adjusts the frame with padding. Empty frames are unchanged, contents never move or resize, and locked frames retain their ratio.
- **Copy frames** copies only the selected frames. **Copy frames and contents** also copies contained objects and internal edges, gives groups independent identities, and omits boundary edges.
- **Delete frames, keep contents** removes only the frame objects. A mixed selection's deletion confirmation states the separate frame and node counts.

Mixed node/frame selections show counts and a **Nodes / Frames** scope switch. Geometry edits affect only the active type, preventing one width from being applied to both cards and their surrounding frames. Coordinate fields remain unavailable whenever the overall selection contains multiple objects. Moving or aligning linked frames together with selected contents moves each object once.

## Object format panel

Left-drag on empty canvas space to fully enclose objects. A group must be enclosed completely. Ctrl / Cmd / Shift-click adds or removes objects, and modifier-drag adds another rectangle to the current selection. A plain marquee replaces the selection. Ctrl / Cmd+A selects all selectable nodes; Tab / Shift+Tab cycles objects while the canvas has focus. Text fields retain normal editing and form navigation.

Selecting one or more objects opens **Object format** below the toolbar. It can collapse without clearing the selection and reopens when the selection changes. It remains available alongside the reading panel. For a single node, **View details** opens its reader. Each panel names its own target; narrow windows stack them with independent scrolling.

**Size** edits width and height in canvas pixels, independently of zoom. Lock aspect ratio couples the other dimension to the node's current ratio, including manual resize handles. Mixed values are shown for a multi-selection: editing an axis updates each selected node, with locked nodes preserving their individual ratios. Dimensions and ratio locks are saved with the canvas.

**Position** edits the top-left X and Y coordinates for a single object. Multi-selection has no shared coordinate fields. Moving a linked frame carries its contents; resizing a frame changes only its bounds. Size and position share one edit boundary: Tab inside it does not commit, Enter or leaving the boundary commits one undoable operation, and Escape discards the draft.

**Align** and **Group** remain separate controls. Alignment and distribution execute immediately and remain undoable. Marquees select nodes only; click a wire directly to select it. Content actions stay expanded. The table below explains each action.

| Action | Result |
|---|---|
| **Merge Summary** | Keep the originals and create a synthesis node |
| **Merge & Delete** | Create the synthesis, then remove the selected originals |
| **Weave highlights** | When highlights exist, weave the selected excerpts into cited prose |
| **Explore** | Ask a new question using the selection as material |
| **Archive** | Keep the nodes but exclude them from context traversal |
| **Duplicate** | Copy the selection and its internal wires, excluding wires that cross its boundary |
| **Align** | Align or distribute relative to the selection or visible canvas, preserving groups and conversation order |
| **Group** | Fix, release, or restore the spatial relationship between selected nodes |
| **Create frame from selection** | Surround the selected objects with a named region, retaining existing groups and wires |
| **Export .md** | Export the selected nodes as Markdown |
| **Delete All** | Delete the selection after confirmation |

Click outside the selection or press `Esc` to leave multi-selection; the clicked target still works. The selection's format panel, alignment/group menus, and object-type switch remain usable without clearing it. Ctrl/Cmd/Shift still append or toggle objects.

Here, **Explore** opens a [conversation branch](/guides/conversations#explore-from-selected-text), **Merge Summary** and **Weave highlights** create new [content representations](/guides/organize), **Archive** changes [context traversal](/guides/context-control#change-what-enters-the-request), and **Export .md** belongs to [data and sharing](/guides/data-sharing#import-and-export).

## Canvases and recovery

Use the canvas menu to create, rename, switch, or delete canvases. Each canvas keeps its own graph, materials, layout, and history. Use separate canvases for work that should not share a context graph; use branches or frames for directions that still belong together.

Use `Cmd+Z` / `Ctrl+Z` and redo for recent changes. For longer-term recovery, enable [automatic folder backup](/guides/data-sharing#automatic-folder-backup).
