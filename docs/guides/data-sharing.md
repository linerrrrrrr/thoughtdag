# Data, backup, and sharing

## Start with automatic folder backup

ThoughtDAG keeps canvases in local application storage by default. To keep a **visible file that you can copy and import again**, enable automatic folder backup when you first use the desktop app.

![Open local auto-backup from the upper-right canvas toolbar and write the active canvas](../auto-backup-en.gif)

### Turn it on

1. Click the **folder backup** button in the upper-right canvas toolbar to open **Local auto-backup**.
2. Choose a folder that you intend to keep.
3. When permission is granted, an existing active canvas is written immediately.
4. Each later node or wire change restarts a roughly one-minute wait. Once editing stops, ThoughtDAG updates a `.thoughtdag.json` file named after the canvas.

Pointing it at a synced folder lets the file follow that folder's existing sync mechanism. ThoughtDAG does not require an account or upload the backup to its own server.

### What it saves

Each canvas gets a complete backup containing nodes, wires, attachment content, and events. The filename uses the canvas name and ID to avoid collisions. Unsupported filename characters are replaced.

| Situation | What automatic backup does |
|---|---|
| Backup is enabled while the active canvas contains work | Writes the active canvas immediately |
| Nodes or wires are edited continuously | Waits until about one minute after the last change, avoiding repeated writes |
| Another canvas becomes active and is edited | Writes that canvas to its own file |

Automatic backup writes the **active canvas**. It does not rescan and rewrite every canvas once a minute. To verify immediately, reopen the backup control center and click **Back up this canvas now**. The same dialog shows the folder, last-write time, change-folder action, and stop control.

Whenever the desktop app opens, ThoughtDAG restores the previously recorded backup folder and attempts to resume watching canvas changes. Backup continues immediately while folder permission remains valid. If the operating system asks for confirmation again, use **Re-authorize & keep backing up** to resume.

### Restore from a backup

Open the canvas menu, choose **Import backup**, and select a `.thoughtdag.json` file. This restores the complete canvas rather than a read-only text export.

The desktop app provides the complete experience; the browser entry appears only where folder access is supported.

## Manual import and export

- Choose **More actions → Export canvas (.html)** in the upper-right corner. Open the file in a browser to explore the canvas and read nodes and documents offline.
- **Export backup** for a complete graph file and later restoration.
- Export a context chain or selected nodes as Markdown.
- Export highlights, memory, or event metadata when needed.
- Import a compatible ThoughtDAG backup or supported conversation export.

Imported edits and regenerated alternatives can become visible graph branches rather than being flattened into one transcript.

## Share a canvas file

Use **Share canvas** to export a complete `.json` file or a thought-map image. A read-only mark prompts the recipient on import. Importing can still create an editable copy.

Choose **Export canvas (.html)** in the canvas menu to save the entire canvas in one offline file, including nodes outside the current view. The file opens at the same position and zoom, with the same node detail and colors. The toolbar, minimap and any open reader or node details panel keep their appearance.

Recipients can pan, zoom, navigate to frames and open node details or the reader. The file preserves saved document revisions, pages and annotations. Ruler ticks lead to the corresponding passage or PDF annotation.

| Surface | Removed from the read-only copy |
| --- | --- |
| Workspace | Project and model switching, application search, canvas chat, settings, the More menu, undo and redo |
| Canvas structure | Creation palette, layout and selection tools, edge editing, resize handles and the interaction lock |
| Conversation and details | Composers, editing, deletion, sending, regeneration, execution and terminal controls |
| Materials | Import and save actions, editor toolbars, annotation editing, recognition, digest generation and follow-up prompts |

Project names, source labels, attachment thumbnails and other saved information remain visible when the associated command is removed. Remaining controls perform local reading or navigation actions.

## Recover recent changes

Use `Cmd+Z` / `Ctrl+Z` and redo for recent operations. Automatic folder backup provides recoverable files; make another manual backup before major restructuring or version upgrades.

**Local-first** does not mean data can never leave the device. Transfer can occur through an explicit action, such as a remote model or tool request, export, or backup folder.
