import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';

import {
  WATCHER_LABEL,
  buildWatcherPlist,
  isEphemeralNodePath,
} from '../dist/watcher.js';

function programArgs(plist) {
  const block = plist.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
  return [...block[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]);
}

test('buildWatcherPlist embeds node, script, and folder as ProgramArguments in order', () => {
  const plist = buildWatcherPlist({
    nodePath: '/opt/homebrew/opt/node/bin/node',
    scriptPath: '/opt/homebrew/lib/node_modules/@frankledo/pdfnamer/dist/index.js',
    folder: '/Users/fxl/Downloads',
  });
  assert.deepEqual(programArgs(plist), [
    '/opt/homebrew/opt/node/bin/node',
    '/opt/homebrew/lib/node_modules/@frankledo/pdfnamer/dist/index.js',
    '/Users/fxl/Downloads',
  ]);
});

test('buildWatcherPlist uses the tool-branded label', () => {
  const plist = buildWatcherPlist({ nodePath: '/n', scriptPath: '/s', folder: '/f' });
  assert.equal(WATCHER_LABEL, 'com.pdfnamer.watcher');
  assert.match(plist, /<key>Label<\/key>\s*<string>com\.pdfnamer\.watcher<\/string>/);
});

test('buildWatcherPlist sets WatchPaths, RunAtLoad=false, ThrottleInterval=10', () => {
  const plist = buildWatcherPlist({
    nodePath: '/n',
    scriptPath: '/s',
    folder: '/Users/fxl/Downloads',
  });
  const watch = plist.match(/<key>WatchPaths<\/key>\s*<array>([\s\S]*?)<\/array>/)[1];
  assert.match(watch, /<string>\/Users\/fxl\/Downloads<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.match(plist, /<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
});

test('buildWatcherPlist sends stdout and stderr to ~/Library/Logs/pdfnamer.log', () => {
  const plist = buildWatcherPlist({ nodePath: '/n', scriptPath: '/s', folder: '/f' });
  const log = `${homedir()}/Library/Logs/pdfnamer.log`;
  const occurrences = plist.split(`<string>${log}</string>`).length - 1;
  assert.equal(occurrences, 2, 'log path should appear for both StandardOutPath and StandardErrorPath');
});

test('buildWatcherPlist XML-escapes special characters in the folder path', () => {
  const plist = buildWatcherPlist({
    nodePath: '/n',
    scriptPath: '/s',
    folder: '/Users/fxl/A & B <x>',
  });
  assert.ok(plist.includes('/Users/fxl/A &amp; B &lt;x&gt;'), 'special chars escaped');
  assert.ok(!plist.includes('A & B <x>'), 'raw unescaped path must not appear');
});

test('isEphemeralNodePath flags version-manager node paths', () => {
  const ephemeral = [
    '/Users/fxl/.nvm/versions/node/v22.22.3/bin/node',
    '/Users/fxl/.fnm/node-versions/v22.0.0/installation/bin/node',
    '/Users/fxl/.volta/tools/image/node/22.0.0/bin/node',
    '/Users/fxl/.n/bin/node',
  ];
  for (const p of ephemeral) {
    assert.equal(isEphemeralNodePath(p), true, p);
  }
});

test('isEphemeralNodePath clears stable node paths', () => {
  const stable = [
    '/opt/homebrew/opt/node/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];
  for (const p of stable) {
    assert.equal(isEphemeralNodePath(p), false, p);
  }
});
