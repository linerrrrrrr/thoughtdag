# Privacy and storage

## What stays local

Canvases, model credentials, imported documents, and local session mirrors stay on your machine. Canvas state defaults to browser IndexedDB; optional folder backup writes `.thoughtdag.json` files.

A local installation can set an absolute `THOUGHTDAG_HOME` and enable `THOUGHTDAG_DISK_STORAGE=1` to store canvases, attachments, and settings under its `browser-storage` directory, and agent workspaces under `workspaces`. On the first visit to each browser origin, the app copies and verifies its existing records before switching. The browser originals remain available; separate origins are not merged.

The browser still holds a locator and filesystem permissions. If browser data is cleared, reopen the same origin and choose the existing local data to reconnect. If the local storage service is unavailable, the app stops at a retry screen rather than silently opening an empty canvas. Folder backup remains a separate feature.

## What can leave the device

Content leaves the device only through a feature that requires transfer:

- a model request to a remote endpoint;
- a search or external tool call;
- a share URL you create and send;
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
