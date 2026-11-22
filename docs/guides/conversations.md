# Conversation nodes and panel

## Start and continue

Enter a question in an ask box. The question and streamed answer become one conversation node. Ask from that node to continue the same path.

Use the paperclip or paste files into the question input on the start page, canvas node, or side panel. Attachments appear above the question. Click an image thumbnail to see the whole image or switch to its original size to inspect details. Open an attachment to edit its name, image description, or the text sent with the question. For PDF and .docx files, edits apply to the extracted text copy. Choose **Save** to apply your changes. Clicking outside keeps your draft for later, and Escape discards it. You can remove individual attachments before sending. Supported formats include images, PDF, .docx, .ipynb, and text files.

Drag a connection from a node to empty canvas to create an empty child. Enter the next question in that new node and explicitly send it. See [Interface overview](/guides/interface-overview) for where each area sits.

## Understand a conversation node

All ordinary conversation nodes use the same model. The start label follows the current incoming conversation connections; several children are simply different paths through the graph. Connections select context. To update an answer after its context changes, regenerate that node. A question about selected material includes the quotation in its visible question text.

The node card supports quick scanning rather than every control:

- the top shows the node state and actions;
- the body shows the active answer version;
- the Highlights section contains the highlighter. The answer footer has actions for regenerating, copying, and editing the answer.
- each answer version records its model and generation time;
- an amber mark means upstream content changed after this answer was generated;
- semantic zoom folds the full card into a takeaway and then an icon marker.

**Double-click the node** for the complete panel. Use **right-click** for lower-frequency node actions.

## Floating-panel areas

The panel floats above the right side of the canvas without moving nodes. Drag its left edge to resize it; double-click the edge to restore the default width.

| Area | Purpose |
|---|---|
| Header status and actions | Inspect the node state and use node-level shortcuts |
| Question | Read or edit the question; waiting nodes also receive their question here |
| Answer and versions | Read the full answer, switch versions, and inspect the generating model |
| Turn information | Inspect the token estimate and attachment count below the answer |
| Attachments | Add [materials](/guides/materials) and control whether inherited attachments enter this context |
| Highlights | Choose Reading only to keep downstream context unchanged, Tag important, or Highlights only; see [Highlight and weave](/guides/organize#highlight-and-weave) |
| Recall | Review retrieved history and its retrieval state |

Conversation details have no context-node list, context-chain navigation, or source-ordering section. For multiple incoming routes, use the canvas node’s **Context · N sources** entry; see [Control context](/guides/context-control). The header’s **More** menu still offers copying or exporting the context chain.

## Continue from an existing node

Drag a connection from the source node to empty canvas, then enter and send a question in the new node. Create several children from the same source to discuss different directions while keeping the original questions and answers.

Turn on the pen in **Highlights**, then select a passage in your question, a follow-up instruction, or the answer. Releasing the mouse saves the highlight for that speaker. Press Esc to put the pen away and resume ordinary text selection.

When a document or conversation has highlights, an **overview ruler** appears to the right of its node. Each tick marks a passage's position in the full text. Click a tick to jump to its highlight. Drag a tick to another node to connect them, or to empty canvas to start a connected question. Send the question when you're ready. In a DOCX, switch on the highlighter in the document toolbar and drag across a passage. Its tick appears when you release the pointer. Hover over the pen to choose a color. Click the pen again or press Esc to stop marking. Save writes your highlights and text edits to the node document.

## Edit a node

- **Double-click the question** to edit it.
- Use the **pencil button** at the end of an answer to edit that answer.
- **Double-click the node** to open its floating panel.

Editing upstream content can make dependent answers stale. ThoughtDAG marks them rather than silently presenting them as current.

## Regenerate and compare

**Regenerate in place** adds an answer version to the same node. Use a new sibling node when the alternatives should remain visible side by side. See [Versions, staleness, and replay](/guides/versions-replay).

## Node right-click menu

The right-click menu holds lower-frequency actions. [Interface overview: Nodes](/guides/interface-overview#_3-nodes) explains each item once, so this page only adds two state rules: available actions vary by node type and state, and right-click preserves the browser's native menu when text is selected.
