// ---------------------------------------------------------------------------
// Folder watcher (macOS launchd)
//
// Pure builders (buildWatcherPlist / isEphemeralNodePath) carry the bug-prone
// logic and are unit-tested. The install/uninstall wrappers are thin shells over
// filesystem + launchctl side effects and are verified by hand.
// ---------------------------------------------------------------------------

import { homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync, statSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';

export const WATCHER_LABEL = 'com.pdfnamer.watcher';

interface WatcherPlistInput {
  nodePath: string;
  scriptPath: string;
  folder: string;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Mirrors expandHome() in index.ts: a shell leaves a quoted "~/Downloads"
// unexpanded, so we expand a leading ~ ourselves to match the rest of the CLI's
// path handling. Kept local (not imported from index.ts) to avoid a circular
// dependency — index.ts imports this module, not the other way around.
export function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return homedir() + p.slice(1);
  }
  return p;
}

// Version managers install Node under ephemeral, version-stamped directories that
// move or vanish when you switch/uninstall versions. A launchd agent pinned to such
// a path can silently stop working, so we detect and warn about these locations.
const EPHEMERAL_NODE_MARKERS = ['/.nvm/', '/.fnm/', '/.volta/', '/.n/'];

export function isEphemeralNodePath(nodePath: string): boolean {
  return EPHEMERAL_NODE_MARKERS.some((marker) => nodePath.includes(marker));
}

function watcherLogPath(): string {
  return join(homedir(), 'Library', 'Logs', 'pdfnamer.log');
}

function watcherPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${WATCHER_LABEL}.plist`);
}

export function buildWatcherPlist({ nodePath, scriptPath, folder }: WatcherPlistInput): string {
  const log = xmlEscape(watcherLogPath());
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${WATCHER_LABEL}</string>

\t<key>ProgramArguments</key>
\t<array>
\t\t<string>${xmlEscape(nodePath)}</string>
\t\t<string>${xmlEscape(scriptPath)}</string>
\t\t<string>${xmlEscape(folder)}</string>
\t</array>

\t<key>WatchPaths</key>
\t<array>
\t\t<string>${xmlEscape(folder)}</string>
\t</array>

\t<key>RunAtLoad</key>
\t<false/>

\t<key>ThrottleInterval</key>
\t<integer>10</integer>

\t<key>StandardOutPath</key>
\t<string>${log}</string>
\t<key>StandardErrorPath</key>
\t<string>${log}</string>
</dict>
</plist>
`;
}

function launchctlDomain(): string {
  // Guarded by the darwin check in the callers, so getuid is always present here.
  return `gui/${process.getuid!()}`;
}

// scriptPath is passed in by the caller (index.ts) because import.meta.url here
// would resolve to dist/watcher.js, not the CLI entrypoint dist/index.js.
export function installWatcher(folderArg: string | undefined, scriptPath: string): void {
  if (process.platform !== 'darwin') {
    console.error('--install-watcher: folder watching uses launchd and is macOS-only.');
    process.exit(1);
  }

  const folder = resolve(
    folderArg && folderArg.length > 0 ? expandTilde(folderArg) : join(homedir(), 'Downloads')
  );
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    console.error(`--install-watcher: not a directory: ${folder}`);
    process.exit(1);
  }

  const nodePath = process.execPath;
  const plist = buildWatcherPlist({ nodePath, scriptPath, folder });

  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  const dest = watcherPlistPath();
  writeFileSync(dest, plist);

  const domain = launchctlDomain();
  // Reload idempotently: bootout any prior instance (ignored if not loaded), then bootstrap.
  try {
    execFileSync('launchctl', ['bootout', domain, dest], { stdio: 'ignore' });
  } catch {
    /* not currently loaded — fine */
  }
  try {
    // Pipe stderr so a launchctl rejection (e.g. "Load failed: 5: Input/output
    // error") surfaces in the message instead of a generic "Command failed".
    execFileSync('launchctl', ['bootstrap', domain, dest], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim();
    const detail = stderr && stderr.length > 0 ? stderr : (e as Error).message;
    console.error(`--install-watcher: failed to load the agent via launchctl: ${detail}`);
    process.exit(1);
  }

  console.log(`pdfnamer watcher installed. Watching: ${folder}`);
  console.log(`Logs: ${watcherLogPath()}`);
  if (isEphemeralNodePath(nodePath)) {
    console.log('');
    console.log('Warning: the watcher is pinned to a version-managed Node at:');
    console.log(`  ${nodePath}`);
    console.log('That path may disappear when you uninstall or switch Node versions,');
    console.log('which would silently stop the watcher. Consider installing pdfnamer');
    console.log('under a stable Node (e.g. Homebrew) and re-running --install-watcher.');
  }
}

export function uninstallWatcher(): void {
  if (process.platform !== 'darwin') {
    console.error('--uninstall-watcher: folder watching is macOS-only.');
    process.exit(1);
  }

  const dest = watcherPlistPath();
  try {
    execFileSync('launchctl', ['bootout', launchctlDomain(), dest], { stdio: 'ignore' });
  } catch {
    /* not loaded — fine */
  }

  if (existsSync(dest)) {
    rmSync(dest);
    console.log('pdfnamer watcher uninstalled.');
  } else {
    console.log('pdfnamer watcher was not installed; nothing to do.');
  }
}
