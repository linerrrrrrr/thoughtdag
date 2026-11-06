# Canvas, navigation, and frames

## Move around the canvas

- **Hold the middle or right mouse button and drag** to pan, or **hold Space and left-drag**.
- **Wheel or two-finger scroll** pans by default; scrolling inside node text still reads that text. The ⋯ menu can switch ordinary scrolling back to zoom.
- **Ctrl/⌘ + scroll or pinch** zooms around the canvas viewport center, including when the pointer is inside a node or editor. On a Magic Mouse, Control + click opens the context menu.
- **Left-drag on empty space** to select the object type chosen under **Select → Nodes / Lines** in the top toolbar. Each node must fit inside the box. Lines are selected where their visible paths cross the box. Ctrl / Cmd / Shift adds to the selection, and Ctrl / Cmd + A selects all objects of the current type.
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

The recording cycles through **Search nodes → Frame navigator → Tidy layout**. It shows the previous layout entry; the action now lives inside **More actions → Layout design**.

## Arrange the graph

Open **Layout design** from the [More actions menu](/guides/interface-overview#more-actions-menu), then choose **Auto layout** in the panel to arrange the selection, or the whole canvas when nothing is selected. It uses saved layout settings and preserves unapplied settings drafts. The panel also offers direction, spacing, preview, and an explicit apply action. Vertical layouts keep each conversation chain in a column, while horizontal layouts keep it in a row, following wire direction in both cases.

Automatic layout applies to the selected nodes while unselected nodes stay in place. When a frame is included, its current contents join the layout and its bounds fit the result, including nested frames. Each applied layout is one undo step.

**Align** and **Create frame** appear side by side in Selection properties. Align offers six edge or center alignments and horizontal or vertical distribution, relative to the selection or the visible canvas. Each selected node participates independently. Manual alignment and distribution allow offset chains, reversed spatial order, and overlapping nodes; distribution uses equal gaps even when the gaps are negative. Actions execute immediately, support undo, and preserve context wiring. Linked frames carry their contents using the existing membership rules.

**Layers** appears beside **Align**. Bring selected nodes or frames forward or backward by one object, or send them to the front or back. Multiple objects retain their relative stacking order. Each command is one undoable step; stacking persists after deselection and reload, without changing positions or context wiring. Changing a frame's layer applies only to the selected frame, not its contents.

Drag anywhere in the tinted selection region, including gaps between cards, to move the selected objects together. Linked frames carry their contents without moving any object twice. Drag the selection's right, bottom, or bottom-right handle to change all selected nodes' width, height, or both while their positions stay fixed. Aspect locks and size limits are respected; corner drags use the larger relative dimension change for locked nodes. Each move or resize is one undo step, and Escape cancels an active drag while keeping the selection. Focus the move region or a handle and use arrow keys for 1 px adjustments, or Shift + arrow for 10 px. Explicitly resized heights remain visible in compact overviews.

The marquee remains after release. Switch between **Nodes / Lines** to select the fully enclosed nodes or crossing lines from that same area, even when one type has no matches. The area follows canvas zoom and pan; clicking outside or leaving the selection clears it. Without a retained area, switching from nodes selects connections between those nodes, and switching back selects the lines' endpoints. **Edit selected lines** uses the same purpose options, path diagrams, and label styling as the single-line editor. Different values show **Mixed values**; each changed field saves immediately, including a cleared label, while untouched fields keep their values. There are no Apply or Cancel buttons. Each choice and each continuous label edit is undoable. Special connections keep their fixed purpose. Closing keeps the saved settings; Escape ends label editing without reverting changes. Confirmed deletion removes only the selected lines.

Use a node's book button or **View details** context-menu action to read it while keeping the selection and Object format panel available. Reading stays on that node while canvas clicks change the selection. Another explicit **View details** action switches the reader; closing it preserves the selection.

## Use frames

Frames label and visually organize a region. Use them when several branches still belong to the same project but need readable sections: click or drag the **Frame** button at the bottom of the left material palette, place the frame, then edit its title and color.

You can also click **Create frame** beside Align in the Object format panel. The new frame surrounds the selected nodes while their positions and context wires stay intact. This action is unavailable if the selection already includes a frame.

The chain button at a frame's top right controls movement. When **linked**, dragging or aligning the frame carries its contents; when **unlinked**, only the frame moves. Frames created from a selection start linked. Manually drawn frames start unlinked so their bounds can be adjusted first.

Membership is spatial: each node or nested frame must fit entirely inside. Enclosed nodes move with a linked frame, while outside nodes stay in place. Moving nodes in or out, or changing frame bounds, changes membership. Overlapping frames can share objects, which are deduplicated for movement, selection, and copying. Frames name, organize, and navigate regions without entering context. Use the **Frame navigator** to jump between named regions. Hiding annotations simplifies the view without deleting content.

Click a frame's title or border to select it; Ctrl / Cmd / Shift adds it to the selection. Empty space inside a frame can start a marquee. Selecting a frame does not select its contents. Double-click its title to rename it, or use the carry icon to change movement behavior. Other properties are centralized in **Frame settings**.

Frame settings contains name, color, size and position, aspect lock, movement behavior, and current membership counts. Names can be cleared. Multiple selected frames can share color, dimensions, ratio lock, and movement behavior; their names are not edited together. Name and geometry inputs retain the Enter-to-commit and Escape-to-cancel conventions.

- **Select contents** selects fully enclosed nodes for explicit content actions such as synthesis, archive, and Markdown export. Frames themselves are excluded from content actions.
- **Select frames and contents** also selects the outer and nested frames, without duplicates.
- **Fit bounds to contents** takes a snapshot of current contents and adjusts the frame with padding. Empty frames are unchanged, contents never move or resize, and locked frames retain their ratio.
- **Duplicate frames only** copies only the selected frames. **Duplicate frames and contents** also copies contained objects and internal edges, and omits outside nodes and boundary edges.
- **Delete frames, keep contents** removes only the frame objects. A mixed selection's deletion confirmation states the separate frame and node counts.

Mixed node/frame selections show counts and a **Nodes / Frames** scope switch. Geometry edits affect only the active type, preventing one width from being applied to both cards and their surrounding frames. Coordinate fields remain unavailable whenever the overall selection contains multiple objects. Moving or aligning linked frames together with selected contents moves each object once.

## Object format panel

Left-drag on empty canvas space to fully enclose nodes. Ctrl / Cmd / Shift-click adds or removes objects, and modifier-drag adds another rectangle to the current selection. A plain marquee replaces the selection. Ctrl / Cmd+A selects all selectable nodes; Tab / Shift+Tab cycles objects while the canvas has focus. Text fields retain normal editing and form navigation.

Selecting one or more objects opens **Object format** below the toolbar to adjust node geometry. It can collapse without clearing the selection and reopens when the selection changes. It remains available alongside the reading panel. Use a node's book button or **View details** context-menu action to open its reader. Each panel names its own target; narrow windows stack them with independent scrolling.

**Size** edits width and height in canvas pixels, independently of zoom. Lock aspect ratio couples the other dimension to the node's current ratio, including manual resize handles. Mixed values are shown for a multi-selection: editing an axis updates each selected node, with locked nodes preserving their individual ratios. Dimensions and ratio locks are saved with the canvas.

**Position** edits the top-left X and Y coordinates for a single object. Multi-selection has no shared coordinate fields. Moving a linked frame carries its contents; resizing a frame changes only its bounds. Size and position share one edit boundary: Tab inside it does not commit, Enter or leaving the boundary commits one undoable operation, and Escape discards the draft.

**Align** opens the arrangement menu, and **Create frame** directly surrounds the selected nodes with a frame. Alignment and distribution execute immediately and remain undoable. Marquees follow the Nodes / Lines mode in the top toolbar. Content actions stay expanded. The table below explains each action.

| Action | Result |
|---|---|
| **Merge Summary** | Keep the originals and create a synthesis node |
| **Merge & Delete** | Create the synthesis, then remove the selected originals |
| **Weave highlights** | When highlights exist, weave the selected excerpts into cited prose |
| **Archive** | Keep the nodes but exclude them from context traversal |
| **Duplicate** | Copy the selection and its internal wires, excluding wires that cross its boundary |
| **Align** | Align or distribute the selected objects, preserving context order |
| **Create frame** | Surround the selected nodes with a named region, retaining positions and wires |
| **Export .md** | Export the selected nodes as Markdown |
| **Delete All** | Delete the selection after confirmation |

Click outside the selection or press `Esc` to leave multi-selection; the clicked target still works. The selection's format panel, alignment menu, and object-type switch remain usable without clearing it. Ctrl/Cmd/Shift still append or toggle objects.

Here, **Merge Summary** and **Weave highlights** create new [content representations](/guides/organize), **Archive** changes [context traversal](/guides/context-control#change-what-enters-the-request), and **Export .md** belongs to [data and sharing](/guides/data-sharing#import-and-export).

## Canvases and recovery

Use the canvas menu to create, rename, switch, or delete canvases. Each canvas keeps its own graph, materials, layout, and history. Use separate canvases for work that should not share a context graph; use branches or frames for directions that still belong together.

Use `Cmd+Z` / `Ctrl+Z` and redo for recent changes. For longer-term recovery, enable [automatic folder backup](/guides/data-sharing#automatic-folder-backup).
