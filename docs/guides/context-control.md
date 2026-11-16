# Control context

For a worked example, follow [How to edit AI context while keeping past conversations](/tutorials/edit-ai-context).

## Inspect the next request

Inspect the incoming wires on the canvas. When several routes enter a node, its **Context · N sources** entry opens a nearby source card: trace the incoming sources, reorder conversation blocks, and inspect references separately. Closing it leaves the reading panel unchanged.

Conversation details contain no dedicated context-node list or source-ordering section. They retain token estimates, attachments, and recall. Use the detail header’s **More → Copy context / Export** actions when you need the context chain as text; these actions do not generate a new answer.

## Create a context path or reference

- Drag from a node handle to empty canvas space to continue with a new question on the structural path.
- Drag from a node handle to an existing node to add an explicit reference.
- Use an `@` mention in an ask box to reference a named node.

Solid wires carry the full upstream conversation path. A purple dashed summary reference carries the referenced node's question and answer plus the upstream question trail, without importing every upstream answer.

## Change what enters the request

- **Delete a wire** to remove that route while leaving both nodes on the canvas.
- **Archive a node** to keep it stored but exclude it from traversal.
- Select a convertible wire to switch between **full structural context** and a **summary reference**. The wire action shows an estimated token difference.

<img src="../prune-en.gif" alt="Removing one incoming context wire and regenerating the answer" width="100%" loading="lazy"/>

## Verify the effect

After changing a wire, use the same question and model to regenerate, then [compare the previous and new answer versions](/guides/versions-replay#compare-answer-versions). This separates a context intervention from a prompt or model change.

Deleting a wire is not deleting a node: the excluded work remains visible, inspectable, and available to reconnect elsewhere.
