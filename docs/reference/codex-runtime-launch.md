# Native CLI launch and Windows sandbox

The agent runtime starts one local `app-server` with JSON-RPC over stdio. It keeps the user's existing login and configuration. It does not edit global configuration, provision sandbox accounts, or replace a running desktop app.

## Executable selection

`runtime/agents/codex-launch.cjs` returns the full `command`, `args`, and `env` spawn contract. Selection order is:

1. `THOUGHTDAG_CODEX_PATH`, if explicitly set. An invalid explicit path is an error, not permission to choose another installation.
2. The official npm package installed under `node_modules/.thoughtdag-codex`.
3. Standalone installations in the normal runtime search directories.
4. On Windows, the desktop-bundled CLI on PATH or in `CODEX_APP_RUNTIME_CLI_PATH`, then the CLI in the current user's registered desktop package. The last lookup uses Windows PowerShell's `Get-AppxPackage` to resolve the package family's current install location, including when the backend starts from an ordinary terminal after a Store update. All three desktop launch paths require MXC for the child process.

For example, the official CLI can be installed without modifying global packages or this repository's dependencies:

```powershell
npm install --prefix node_modules/.thoughtdag-codex --no-audit --no-fund --ignore-scripts --save-exact @openai/codex@0.167.1
```

This directory is covered by the existing `node_modules` ignore rule. The package's native dependency must be installed too. Discovery checks that its version matches the wrapper. A Windows npm shim is resolved to that native executable so shutdown terminates the actual app-server, without a `cmd.exe` wrapper or a leftover Node child.

The pinned npm release above was checked against the official registry on 2026-11-11. Its large native-package download was interrupted during the local investigation; it is **not** the binary used for the successful real sandbox check below. Native history support is still negotiated by the backend, and an unsupported injection operation fails without flattening history into a prompt.

## Why MXC is required for the Windows fallback

The desktop app's legacy Registered Core sandbox expects an OS package identity. Directly spawning its `resources/codex.exe` does not supply that activation identity and can fail with:

```text
registered Core launch requires an installed app
```

MXC is a separate, officially supported native Windows sandbox. It does not require Registered Core's MSIX activation identity or legacy account provisioning. The launcher adds the process-local arguments `-c windows.sandbox=mxc` when selecting the desktop fallback, or when a standalone CLI inherits `CODEX_WINDOWS_REGISTERED_CORE=1`.

The launcher preserves that variable and all other inherited security settings. It does not change thread approval policies, permission profiles, writable roots, network restrictions, or managed requirements. If MXC is unavailable on the OS or prohibited by managed requirements, the CLI must fail; there is no automatic fallback to an unelevated or unsandboxed mode. No sandbox selection is written to the user's configuration file.

The official Windows sandbox documentation describes supported OS versions and the same configuration override: [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox). Official CLI installation options are documented in [Codex CLI](https://learn.chatgpt.com/docs/codex/cli).

## Verification

On 2026-11-11, Windows build `26200.9711` and the installed CLI `0.167.0-alpha.3.2` successfully ran the documented direct sandbox probe, with inherited security variables intact:

```powershell
codex -c windows.sandbox=mxc sandbox --include-managed-config --permission-profile :workspace -- cmd.exe /d /c echo MXC_OK
```

The process returned exit code `0` and `MXC_OK`. This proves a real child shell ran under the selected sandbox; it does not, by itself, prove mixed-node history, model tool selection, restart continuation, or official UI rendering. Those need the separate native-history end-to-end run.

Offline regressions run with:

```powershell
node scripts/test-agent-discovery.mjs
```

The tests cover standalone preference, desktop/MXC launch from an ordinary Windows terminal, package updates, inherited policy preservation, explicit-path failure, symlink detection, matching npm dependencies, and discovery retries. The Windows package query and CLI are simulated.
