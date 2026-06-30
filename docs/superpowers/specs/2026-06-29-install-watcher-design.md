# Design: `--install-watcher` / `--uninstall-watcher`

## Purpose

Let any pdfnamer user set up automatic filing of a folder with one command, instead
of hand-authoring a launchd plist. `pdfnamer --install-watcher ~/Downloads` generates
and loads a macOS LaunchAgent that runs `pdfnamer <folder>` whenever the folder
changes, auto-renaming and moving matched PDFs. This packages, as a first-class
feature, the watcher that was previously set up by hand.

## CLI surface

- `pdfnamer --install-watcher [folder]` — `folder` is an optional positional,
  defaulting to `~/Downloads`. Generates the agent, writes the plist, and loads it.
- `pdfnamer --uninstall-watcher` — boots out and removes the agent. Idempotent.
- Both short-circuit and exit, mirroring how `--init` and `--install-quickaction`
  behave today. `--help` text gains both flags.

## Behavior

### Install flow
1. Guard `process.platform === 'darwin'`; otherwise print a clear error
   ("Folder watching uses launchd and is macOS-only") and exit non-zero.
2. Resolve `folder` to an absolute path. Validate it exists and is a directory;
   error clearly if not.
3. Generate the plist text (pure function).
4. Write it to `~/Library/LaunchAgents/com.pdfnamer.watcher.plist`
   (creating `~/Library/LaunchAgents` if missing).
5. Reload idempotently: `launchctl bootout gui/<uid> <plist>` (ignore failure when
   not already loaded), then `launchctl bootstrap gui/<uid> <plist>`.
6. Print a confirmation showing the watched folder and log path. If the pinned node
   path looks ephemeral, print the warning described below.

### Uninstall flow
1. `launchctl bootout gui/<uid> <plist>` (ignore failure if not loaded).
2. `rm -f` the plist.
3. Print confirmation. No error if nothing was installed (idempotent).

## Generated plist

Parameterized version of the verified hand-built agent:

- `Label` = `com.pdfnamer.watcher`
- `ProgramArguments` = `[ <nodePath>, <scriptPath>, <folder> ]`
  - `nodePath` = `process.execPath` (the node running the install)
  - `scriptPath` = absolute path to this CLI's `dist/index.js` (same resolution the
    Quick Action installer uses)
  - `folder` = the absolute watched folder
- `WatchPaths` = `[ <folder> ]`
- `RunAtLoad` = `false`
- `ThrottleInterval` = `10`
- `StandardOutPath` / `StandardErrorPath` = `~/Library/Logs/pdfnamer.log`

All interpolated string values are XML-escaped.

## Node-path handling

Pin `process.execPath` — the node currently running pdfnamer. This is consistent with
the existing Quick Action installer and is guaranteed to exist at install time.

If `process.execPath` matches an ephemeral version-manager location — path contains
`/.nvm/`, `/.fnm/`, `/.volta/`, or `/.n/` — print a non-fatal warning: the baked-in
node path may disappear when that version is uninstalled or switched, so the agent
could silently stop working; recommend installing pdfnamer under a stable node
(e.g. Homebrew). Installation still proceeds.

## Constraints & limitations

- **macOS-only**, like the Quick Action (launchd-specific). A Linux systemd
  equivalent is out of scope.
- **Single watcher.** One fixed label (`com.pdfnamer.watcher`). Re-running
  `--install-watcher` with a different folder *repoints* the single agent rather than
  adding a second; uninstall therefore needs no folder argument. Multi-folder support
  is a deliberate future extension, not part of v1.
- **Tool-branded label**, `com.pdfnamer.watcher`, since this ships to other users —
  not the `com.frankledo.pdfnamer.watch` label used by the pre-existing hand-built
  agent. The feature does not touch or migrate that hand-built agent.

## Code structure (for testability)

The existing `installQuickAction` mixes string generation with side effects and can't
be unit-tested. The watcher is split into pure core + thin effectful shell:

- `buildWatcherPlist({ nodePath, scriptPath, folder })` → `string` — pure, no I/O.
- `isEphemeralNodePath(path)` → `boolean` — pure heuristic.
- `installWatcher(folder)` / `uninstallWatcher()` — thin wrappers performing
  validation, `writeFile`, `mkdir`, and `launchctl` calls.

The bug-prone logic (plist content, ephemeral detection) lives in pure functions.

## Testing

The project currently has no test framework. Add Node's built-in `node:test` +
`node:assert` (zero new dependencies; runs on the Node ≥22.13 floor) and an
`npm test` script. Tests cover the pure functions:

- `buildWatcherPlist` emits the expected `Label`, `ProgramArguments`, `WatchPaths`,
  and log paths for given inputs, and XML-escapes a folder path containing `&`,
  `<`, or spaces.
- `isEphemeralNodePath` flags `/.nvm/`, `/.fnm/`, `/.volta/`, `/.n/` paths and
  clears `/opt/homebrew/opt/node/bin/node` and `/usr/bin/node`.

The `launchctl`-touching wrappers (`installWatcher` / `uninstallWatcher`) are verified
by hand — loading a real LaunchAgent in CI is not practical. This boundary is
intentional: pure logic is unit-tested; the OS integration is manually verified.

## Out of scope (v1)

- Multiple simultaneously watched folders.
- A notify/dry-run watcher variant (auto-move only).
- Non-macOS platforms.
- Migrating the pre-existing hand-built `com.frankledo.pdfnamer.watch` agent.
