#!/usr/bin/env node

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, existsSync, readdirSync, renameSync, writeFileSync, mkdirSync, statSync, realpathSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { homedir } from 'os';
import { parseArgs } from 'node:util';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

// pdfjs-dist requires a worker even in Node — point it at the bundled file
const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

interface AccountEntry {
  number: string;
  alias: string;
}

interface SubjectEntry {
  match: string;
  alias: string;
}

interface CompanyConfig {
  name: string;
  output_path?: string;
  filename_patterns?: string[];
  keywords?: string[];
  keyword_search_chars?: number;
  accounts?: AccountEntry[];
  subjects?: SubjectEntry[];
  date_labels?: string[];
  noAccountNumber?: boolean;
}

interface Config {
  output_path: string;
  date_format: string;
  date_labels: string[];
  companies: CompanyConfig[];
}

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Config = {
  output_path: '~/Documents/PDFs/{year}/{company}/{date} - {company}[ - {doctype}]',
  date_format: 'YYYY-MM-DD',
  date_labels: [
    'Statement Date:', 'Statement Date',
    'Billing Date:', 'Billing Date',
    'Bill Date:', 'Bill Date',
    'Invoice Date:', 'Invoice Date',
  ],
  companies: [],
};

const SAMPLE_CONFIG: Config = {
  output_path: '~/Documents/Bills/{year}/{company}/{date} - {company}[ - {account}][ - {doctype}]',
  date_format: 'YYYY-MM-DD',
  date_labels: [
    'Statement Date:', 'Statement Date',
    'Billing Date:', 'Billing Date',
    'Bill Date:', 'Bill Date',
    'Invoice Date:', 'Invoice Date',
  ],
  companies: [
    {
      name: 'Riverside Electric',
      filename_patterns: ['riverside_bill_*', 'RiversideElectric_*'],
      keywords: ['Riverside Electric Company', 'riverside-electric.example.com'],
      subjects: [
        { match: 'Electric Bill', alias: 'Bill' },
        { match: 'Service Notice', alias: 'Notice' },
      ],
    },
    {
      name: 'Oakwood Bank',
      filename_patterns: ['OakwoodBank_*'],
      keywords: ['Oakwood Bank', 'oakwoodbank.example.com'],
      accounts: [
        { number: '1234', alias: 'Checking' },
        { number: '5678', alias: 'Savings' },
      ],
      subjects: [
        { match: 'Account Statement', alias: 'Statement' },
        { match: 'Annual Report', alias: 'Annual Report' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function getDefaultConfigPath(): string {
  return join(homedir(), '.config', 'pdfnamer', 'config.json');
}

function loadConfig(configPath?: string): Config {
  const p = configPath ?? getDefaultConfigPath();
  if (!existsSync(p)) {
    console.warn(`No config found at ${p} — run 'pdfnamer --init' to create a sample.`);
    return DEFAULT_CONFIG;
  }
  try {
    const user = JSON.parse(readFileSync(p, 'utf8')) as Partial<Config>;
    return { ...DEFAULT_CONFIG, ...user };
  } catch (e: unknown) {
    console.error(`Config parse error: ${(e as Error).message}`);
    return DEFAULT_CONFIG;
  }
}

function initConfig(configPath?: string): void {
  const p = configPath ?? getDefaultConfigPath();
  if (existsSync(p)) {
    console.log(`Config already exists at ${p}`);
    return;
  }
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(SAMPLE_CONFIG, null, 2) + '\n');
  console.log(`Created sample config at ${p}`);
}

// ---------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------

async function extractText(pdfPath: string): Promise<string> {
  try {
    const data = new Uint8Array(readFileSync(pdfPath));
    const doc = await getDocument({ data, verbosity: 0 }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        (content.items as Array<{ str: string; hasEOL?: boolean }>)
          .map(item => item.str + (item.hasEOL ? '\n' : ' '))
          .join('')
      );
    }
    return pages.join('\n');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

function globMatch(pattern: string, filename: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
    'i'
  );
  return re.test(filename);
}

// ---------------------------------------------------------------------------
// Company matching
// ---------------------------------------------------------------------------

interface MatchResult {
  company: CompanyConfig | null;
  text: string | null;
}

async function matchCompany(
  pdfPath: string,
  getText: () => Promise<string>,
  companies: CompanyConfig[]
): Promise<MatchResult> {
  const base = basename(pdfPath);

  for (const c of companies) {
    if (c.filename_patterns?.some(p => globMatch(p, base))) {
      return { company: c, text: null };
    }
  }

  const text = await getText();
  for (const c of companies) {
    const searchText = text.slice(0, c.keyword_search_chars ?? 2000);
    if (c.keywords?.some(k => searchText.includes(k))) {
      return { company: c, text };
    }
  }

  return { company: null, text };
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04',
  jun: '06', jul: '07', aug: '08',
  sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

function parseDate(str: string): string | null {
  // YYYY-MM-DD (ISO, also appears in filenames like eStmt_2025-12-31)
  let m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // "March 21, 2026" / "Mar. 21, 2026" / "March 21 2026" / "January 1 , 2026"
  m = str.match(/([A-Za-z]+)\.?\s+(\d{1,2})\s*,?\s+(\d{4})/);
  if (m) {
    const mo = MONTH_NAMES[m[1].toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[2].padStart(2, '0')}`;
  }
  // MM/DD/YYYY or MM-DD-YYYY
  m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  // MM/DD/YY or MM-DD-YY — expand to 20xx
  m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})\b/);
  if (m) return `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  // YYYYMMDDHHmmss embedded datetime (e.g. PG&E filenames: _20250329035431)
  m = str.match(/(\d{4})(\d{2})(\d{2})\d{6}/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Bare tax year (e.g. "Tax Year: 2025") — use December 31
  m = str.match(/\b(20\d{2})\b/);
  if (m) return `${m[1]}-12-31`;
  return null;
}

function rangeEndDate(s: string): string | null {
  let m = s.match(/\d{1,2}\/\d{1,2}\/\d{4}(?:\s*-\s*| to )(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/\d{1,2}\/\d{1,2}\/\d{2}(?:\s*-\s*| to )(\d{1,2})\/(\d{1,2})\/(\d{2})/i);
  if (m) return `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

function extractDate(text: string, dateLabels: string[]): string | null {
  // Try labeled date first (most specific) — case-insensitive label search
  const lowerText = text.toLowerCase();
  for (const label of dateLabels) {
    const idx = lowerText.indexOf(label.toLowerCase());
    if (idx === -1) continue;
    const segment = text.slice(idx + label.length, idx + label.length + 60);
    // Prefer range end date within the segment (e.g. "5/1/2026 - 5/31/2026" → May 31)
    const date = rangeEndDate(segment) ?? parseDate(segment);
    if (date) return date;
  }
  // Period range anywhere in document — take end date
  const rangeDate = rangeEndDate(text);
  if (rangeDate) return rangeDate;
  // Last resort: first date in document header
  return parseDate(text.slice(0, 2000)) ?? null;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function formatDate(isoDate: string, dateFormat: string): { formatted: string; year: string; month: string } {
  // isoDate is YYYY-MM-DD
  const [year, month, day] = isoDate.split('-');
  const formatted = dateFormat
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day);
  return { formatted, year, month };
}

// ---------------------------------------------------------------------------
// Account / Subject matching
// ---------------------------------------------------------------------------

function matchAccount(text: string, company: CompanyConfig): string {
  if (company.noAccountNumber) return '';
  if (!company.accounts?.length) return '';
  for (const acct of company.accounts) {
    if (text.includes(acct.number)) return acct.alias;
  }
  return '';
}

function matchSubject(text: string, company: CompanyConfig): string {
  if (!company.subjects?.length) return '';
  for (const subj of company.subjects) {
    if (text.includes(subj.match)) return subj.alias;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Output path computation
// ---------------------------------------------------------------------------

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return homedir() + p.slice(1);
  }
  return p;
}

function computeOutputPath(
  config: Config,
  company: CompanyConfig,
  isoDate: string,
  text: string
): { dir: string; name: string; full: string } {
  const { formatted, year, month } = formatDate(isoDate, config.date_format);
  const tokens: Record<string, string> = {
    year, month,
    date: formatted,
    company: company.name,
    account: matchAccount(text, company),
    doctype: matchSubject(text, company),
  };

  const substitute = (s: string) =>
    s.replace(/\{(\w+)\}/g, (_, k: string) => tokens[k] ?? '');

  let outputPath = company.output_path ?? config.output_path;

  // Optional segments [...]: drop entire block if any token inside is empty
  outputPath = outputPath.replace(/\[([^\]]*)\]/g, (_, block: string) => {
    const isEmpty = (block.match(/\{(\w+)\}/g) ?? []).some(t => tokens[t.slice(1, -1)] === '');
    return isEmpty ? '' : substitute(block);
  });

  // Substitute remaining (non-optional) tokens
  outputPath = substitute(outputPath);

  // Safety net for legacy configs without [...] syntax: collapse empty-token separators
  outputPath = outputPath
    .replace(/ -(\s*- )+/g, ' - ')
    .replace(/ - $/g, '')
    .replace(/^ - /g, '')
    .replace(/\/{2,}/g, '/');

  outputPath = expandHome(outputPath);
  outputPath = resolve(outputPath);

  const dir = dirname(outputPath);
  const name = basename(outputPath);
  return { dir, name, full: outputPath + '.pdf' };
}

// ---------------------------------------------------------------------------
// Unique target (avoid collisions)
// ---------------------------------------------------------------------------

function uniqueTarget(dir: string, name: string): string {
  const base = join(dir, `${name}.pdf`);
  if (!existsSync(base)) return base;
  let n = 2;
  while (existsSync(join(dir, `${name} (${n}).pdf`))) n++;
  return join(dir, `${name} (${n}).pdf`);
}

// ---------------------------------------------------------------------------
// Quick Action installer (macOS)
// ---------------------------------------------------------------------------

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function installQuickAction(): void {
  const nodePath = xmlEscape(process.execPath);
  const scriptPath = xmlEscape(fileURLToPath(import.meta.url));

  const wflowDir = join(homedir(), 'Library', 'Services', 'pdfnamer.workflow', 'Contents');
  mkdirSync(wflowDir, { recursive: true });

  const shellScript = [
    `summary=$(${nodePath} ${scriptPath} "$@" 2>&amp;1 | tail -1)`,
    `osascript -e "display notification \\"$summary\\" with title \\"pdfnamer\\""`,
  ].join('\n');

  const wflow = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>AMApplicationBuild</key>
\t<string>537</string>
\t<key>AMApplicationVersion</key>
\t<string>2.10</string>
\t<key>AMDocumentVersion</key>
\t<string>2</string>
\t<key>actions</key>
\t<array>
\t\t<dict>
\t\t\t<key>action</key>
\t\t\t<dict>
\t\t\t\t<key>AMAccepts</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Optional</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.string</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>AMActionVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>AMApplication</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t\t<key>AMProvides</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.string</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>ActionBundlePath</key>
\t\t\t\t<string>/System/Library/Automator/Run Shell Script.action</string>
\t\t\t\t<key>ActionName</key>
\t\t\t\t<string>Run Shell Script</string>
\t\t\t\t<key>ActionParameters</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<string>${shellScript}</string>
\t\t\t\t\t<key>CheckedForUserDefaultShell</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<integer>1</integer>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<string>/bin/zsh</string>
\t\t\t\t\t<key>source</key>
\t\t\t\t\t<string></string>
\t\t\t\t</dict>
\t\t\t\t<key>BundleIdentifier</key>
\t\t\t\t<string>com.apple.RunShellScript</string>
\t\t\t\t<key>CFBundleVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>CanShowSelectedItemsWhenRun</key>
\t\t\t\t<false/>
\t\t\t\t<key>CanShowWhenRun</key>
\t\t\t\t<true/>
\t\t\t\t<key>Category</key>
\t\t\t\t<array>
\t\t\t\t\t<string>AMCategoryUtilities</string>
\t\t\t\t</array>
\t\t\t\t<key>Class Name</key>
\t\t\t\t<string>RunShellScriptAction</string>
\t\t\t\t<key>InputUUID</key>
\t\t\t\t<string>C68943FC-2D8E-4FFF-8EA9-C52A39669A1B</string>
\t\t\t\t<key>OutputUUID</key>
\t\t\t\t<string>702828E2-A37A-4BDD-98EF-03587BCE45A6</string>
\t\t\t\t<key>UUID</key>
\t\t\t\t<string>FC9424EF-4CB6-4695-93DF-12CFA90A24CA</string>
\t\t\t\t<key>UnlocalizedApplications</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t\t<key>arguments</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>0</key>
\t\t\t\t\t<dict>
\t\t\t\t\t\t<key>default value</key>
\t\t\t\t\t\t<integer>0</integer>
\t\t\t\t\t\t<key>name</key>
\t\t\t\t\t\t<string>inputMethod</string>
\t\t\t\t\t\t<key>required</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>type</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>uuid</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t</dict>
\t\t\t\t</dict>
\t\t\t\t<key>conversionLabel</key>
\t\t\t\t<integer>0</integer>
\t\t\t\t<key>isViewVisible</key>
\t\t\t\t<integer>1</integer>
\t\t\t</dict>
\t\t\t<key>isViewVisible</key>
\t\t\t<integer>1</integer>
\t\t</dict>
\t</array>
\t<key>connectors</key>
\t<dict/>
\t<key>workflowMetaData</key>
\t<dict>
\t\t<key>inputTypeIdentifier</key>
\t\t<string>com.apple.Automator.fileSystemObject</string>
\t\t<key>outputTypeIdentifier</key>
\t\t<string>com.apple.Automator.nothing</string>
\t\t<key>presentationMode</key>
\t\t<integer>15</integer>
\t\t<key>processesInput</key>
\t\t<false/>
\t\t<key>serviceInputTypeIdentifier</key>
\t\t<string>com.apple.Automator.fileSystemObject</string>
\t\t<key>serviceOutputTypeIdentifier</key>
\t\t<string>com.apple.Automator.nothing</string>
\t\t<key>serviceProcessesInput</key>
\t\t<false/>
\t\t<key>systemImageName</key>
\t\t<string>NSTouchBarDocuments</string>
\t\t<key>useAutomaticInputType</key>
\t\t<false/>
\t\t<key>workflowTypeIdentifier</key>
\t\t<string>com.apple.Automator.servicesMenu</string>
\t</dict>
</dict>
</plist>
`;

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>NSServices</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSIconName</key>
\t\t\t<string>NSTouchBarDocuments</string>
\t\t\t<key>NSMenuItem</key>
\t\t\t<dict>
\t\t\t\t<key>default</key>
\t\t\t\t<string>Rename with pdfnamer</string>
\t\t\t</dict>
\t\t\t<key>NSMessage</key>
\t\t\t<string>runWorkflowAsService</string>
\t\t\t<key>NSSendFileTypes</key>
\t\t\t<array>
\t\t\t\t<string>public.item</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
`;

  writeFileSync(join(wflowDir, 'document.wflow'), wflow);
  writeFileSync(join(wflowDir, 'Info.plist'), infoPlist);

  const dest = join(homedir(), 'Library', 'Services', 'pdfnamer.workflow');
  console.log(`Installed: ${dest}`);
  console.log('Right-click any PDF or folder in Finder → Quick Actions → "Rename with pdfnamer"');
  console.log('(You may need to log out and back in for it to appear.)');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run':         { type: 'boolean', short: 'n', default: false },
      config:            { type: 'string',  short: 'c' },
      init:              { type: 'boolean',              default: false },
      'install-quickaction': { type: 'boolean',          default: false },
      help:              { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
pdfnamer — rename PDF documents by company and date

Usage:
  pdfnamer [options] <file|directory> [file|directory ...]
  pdfnamer --init

Options:
  -n, --dry-run            Preview renames without making changes
  -c, --config <path>      Config file path (default: ~/.config/pdfnamer/config.json)
      --init               Write a sample config and exit
      --install-quickaction Install a Finder Quick Action (macOS)
  -h, --help               Show this help

Output path:
  Configured via output_path in config. Supports tokens:
    {year}    — 4-digit year from document date
    {month}   — 2-digit month
    {date}    — formatted date (per date_format)
    {company} — matched company name
    {account} — matched account alias
    {doctype} — matched subject/document type alias
    `.trim());
    return;
  }

  if (values.init) {
    initConfig(values.config);
    return;
  }

  if (values['install-quickaction']) {
    installQuickAction();
    return;
  }

  if (positionals.length === 0) {
    console.error('Error: provide at least one file or directory. Run pdfnamer --help for usage.');
    process.exit(1);
  }

  // Collect PDF paths from all positional arguments (files and/or directories)
  const pdfs: string[] = [];
  for (const arg of positionals) {
    const p = resolve(expandHome(arg));
    if (!existsSync(p)) {
      console.error(`Error: not found: ${arg}`);
      process.exit(1);
    }
    if (statSync(p).isDirectory()) {
      let entries: string[];
      try {
        entries = readdirSync(p);
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code === 'EPERM') {
          console.error(`Error: cannot read directory: ${arg}`);
          console.error(`       If this is an iCloud or protected path, cd into it first and run: pdfnamer .`);
          process.exit(1);
        }
        throw e;
      }
      const found = entries
        .filter(f => f.toLowerCase().endsWith('.pdf') && !f.startsWith('.'))
        .map(f => join(p, f));
      pdfs.push(...found);
    } else if (p.toLowerCase().endsWith('.pdf')) {
      pdfs.push(p);
    } else {
      console.error(`Error: not a PDF or directory: ${arg}`);
      process.exit(1);
    }
  }

  if (pdfs.length === 0) {
    console.log('No PDF files found.');
    return;
  }

  const config = loadConfig(values.config);
  const dryRun = values['dry-run'];

  let nRenamed = 0, nUnchanged = 0, nSkipped = 0;

  for (const fullPath of pdfs) {
    const pdf = basename(fullPath);
    let cachedText: string | null = null;
    const getText = async (): Promise<string> => {
      if (cachedText === null) cachedText = await extractText(fullPath);
      return cachedText;
    };

    const { company, text } = await matchCompany(fullPath, getText, config.companies);
    if (text) cachedText = text;

    if (!company) {
      const snippet = (await getText()).slice(0, 300).replace(/\s+/g, ' ').trim();
      console.log(`UNMATCHED  ${pdf}`);
      console.log(`           ${snippet.slice(0, 120)}`);
      console.log();
      nSkipped++;
      continue;
    }

    const dateLabels = company.date_labels ?? config.date_labels;
    const isoDate = extractDate(await getText(), dateLabels)
      ?? parseDate(basename(fullPath, '.pdf'));

    if (!isoDate) {
      const snippet = (await getText()).slice(0, 300).replace(/\s+/g, ' ').trim();
      console.log(`NO DATE    ${pdf}  [${company.name}]`);
      if (snippet) console.log(`           ${snippet.slice(0, 120)}`);
      nSkipped++;
      continue;
    }

    const { dir: targetDir, name: newName, full: targetPath } = computeOutputPath(
      config, company, isoDate, await getText()
    );

    const realFull = (() => { try { return realpathSync(fullPath); } catch { return fullPath; } })();
    const realTarget = (() => { try { return realpathSync(targetPath); } catch { return targetPath; } })();
    if (realFull === realTarget) {
      console.log(`UNCHANGED  ${pdf}`);
      nUnchanged++;
      continue;
    }

    const target = uniqueTarget(targetDir, newName);

    const tag = dryRun ? 'DRY RUN' : 'RENAME ';
    console.log(`${tag}    ${pdf}`);
    console.log(`           → ${target}`);

    if (!dryRun) {
      mkdirSync(targetDir, { recursive: true });
      renameSync(fullPath, target);
    }
    nRenamed++;
  }

  console.log(`\n${nRenamed} renamed, ${nUnchanged} unchanged, ${nSkipped} skipped`);
}

main();
