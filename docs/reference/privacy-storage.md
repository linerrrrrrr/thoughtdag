# Privacy and storage

## What stays local

When running from a source checkout, the canvas catalog, nodes, edges, attachment records, and application settings default to the SQLite database at `local-data/data/thoughtdag.sqlite`. The checkout's local browser and Electron entry points share this database. Separate checkouts retain independent libraries. Git ignores `local-data/`. A static web deployment uses browser IndexedDB. Optional folder backup writes `.thoughtdag.json` files.

Local installations can select a data root explicitly with an absolute `THOUGHTDAG_HOME` and `THOUGHTDAG_DISK_STORAGE=1`. Existing custom directories retain file storage compatibility. Local addresses and ports that use the same data directory share canvases, attachments, and settings.

To migrate an existing installation into its checkout, close the instances using the old directory and run `node scripts/migrate-project-data.mjs "<old data root>" "<checkout>/local-data/data"`. Migrate each library into its own checkout. External files and editable documents live in `workspaces/` beside the database. Include the entire `local-data/data/` directory in a complete backup.

The first upgrade merges the catalogs from earlier local addresses. Canvases with distinct IDs keep their own entries even when their names match. Verified empty default canvases can be skipped. Retired storage directories are preserved under `browser-storage/legacy-backup/`. The first connection also copies and verifies any eligible browser-only records and retains their originals. Reopening the app after clearing browser data reconnects to the same library. The page offers a retry if the local service is unavailable.

Each locally hosted canvas has a folder for external tools. Creating or importing a canvas creates `workspaces/<project storage ID>/<canvas ID>/external/` under the data directory. Upgrading provisions missing folders for older canvases. Canvases that already had external files keep their original folder. Codex starts in the corresponding folder when launched from a canvas. Renaming or archiving a canvas preserves the path. Deleting a canvas preserves the external files. You manage these files independently of the canvas nodes and attachments.

## Editing a canvas file by number

Importing a file copies its contents into the canvas. With a local file host, each attachment has an ordinary file under `.thoughtdag/documents/` in the canvas workspace. Two nodes can each hold a file with the same name. Ask a native agent to “edit the conclusion in #12” to select that node in the current canvas. Saving the file updates the node and its reader. Tools that stream paragraph replacements can also show DOCX edits before saving.

You retain control of the original import source. Native agents use their own working directory and permission settings for other files unless you choose a canvas approval mode. Browser-only deployments keep documents in browser storage.

## What can leave the device

Content leaves the device only through a feature that requires transfer:

- a model request to a remote endpoint;
- a search or external tool call;
- a backup folder managed by a third-party sync service;
- an exported file you distribute.

PDF files remain local during ordinary reading. Extracted text or selected material may be sent when it is included in a remote model request.

## Credentials

Keys configured in the interface are kept in local application data and are not included in normal canvas backups. With disk storage enabled, settings files may contain plaintext keys; restrict operating-system access to the data directory. Review the policy of any model or tool endpoint you connect.

## Local why index

The CLI and MCP keep rebuildable indexes and caches in `THOUGHTDAG_HOME`, or `~/.thoughtdag` when it is unset, separate from source logs. These may contain historical questions, answers, file paths, and material excerpts—not just filenames.

```bash
thoughtdag purge --cache  # Remove rebuildable caches only
thoughtdag purge          # Remove derived data, not source sessions
```

Later indexing or queries can read source logs again while those logs still exist. Purging the index does not erase source history.

## Harness plugin

The embedded canvas uses browser storage under the Harness web origin. Harness manages its model configuration, credentials, and session logs. The plugin accesses supported logs on the machine running Harness, which need not be the browser client's machine.

Matching history returned by query tools may enter an agent's next model request and be sent to the selected remote provider. New turns through **DeepSeek Harness · Agent** are recorded in Harness logs; editing the canvas does not delete those logs.

## Web demo

The hosted demo uses browser-local canvas storage and browser-direct model connections where supported. It does not provide the full set of desktop-local capabilities.
