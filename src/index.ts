#!/usr/bin/env node

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, existsSync, readdirSync, renameSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { homedir } from 'os';
import { parseArgs } from 'node:util';
import { createRequire } from 'module';

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
  filename_patterns?: string[];
  keywords?: string[];
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
  output_path: '~/Documents/PDFs/{year}/{company}/{date} - {company}',
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
  output_path: '~/Documents/Bills/{year}/{company}/{date} - {company} - {doctype}',
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
    if (c.keywords?.some(k => text.includes(k))) {
      return { company: c, text };
    }
  }

  return { company: null, text };
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

function parseDate(str: string): string | null {
  // MM/DD/YYYY
  let m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  // MM/DD/YY — expand to 20xx
  m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
  if (m) return `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

function extractDate(text: string, dateLabels: string[]): string | null {
  // Try labeled date first (most specific)
  for (const label of dateLabels) {
    const idx = text.indexOf(label);
    if (idx === -1) continue;
    const segment = text.slice(idx + label.length, idx + label.length + 60);
    const date = parseDate(segment);
    if (date) return date;
  }
  // Fallback: first date in the document header
  return parseDate(text.slice(0, 500)) ?? null;
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
  const account = matchAccount(text, company);
  const doctype = matchSubject(text, company);

  let outputPath = config.output_path;
  outputPath = outputPath.replaceAll('{year}', year);
  outputPath = outputPath.replaceAll('{month}', month);
  outputPath = outputPath.replaceAll('{date}', formatted);
  outputPath = outputPath.replaceAll('{company}', company.name);
  outputPath = outputPath.replaceAll('{account}', account);
  outputPath = outputPath.replaceAll('{doctype}', doctype);

  // Clean up double dashes or trailing dashes that come from empty tokens
  // e.g. "2026-01-15 - PG&E -  - Bill" → "2026-01-15 - PG&E - Bill"
  outputPath = outputPath
    .replace(/ - {2,}/g, ' - ')   // collapse "- -" runs
    .replace(/ - $/g, '')          // trailing " - "
    .replace(/\/{2,}/g, '/');      // collapse double slashes in dir

  outputPath = expandHome(outputPath);
  outputPath = resolve(outputPath);

  // Split into directory and file stem
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
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean', short: 'n', default: false },
      config:    { type: 'string',  short: 'c' },
      init:      { type: 'boolean',              default: false },
      help:      { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
pdfnamer — rename PDF documents by company and date

Usage:
  pdfnamer [options] <directory>
  pdfnamer --init

Options:
  -n, --dry-run       Preview renames without making changes
  -c, --config <path> Config file path (default: ~/.config/pdfnamer/config.json)
      --init          Write a sample config and exit
  -h, --help          Show this help

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

  const dir = positionals[0];
  if (!dir) {
    console.error('Error: directory required. Run pdfnamer --help for usage.');
    process.exit(1);
  }

  const resolvedDir = resolve(expandHome(dir));
  if (!existsSync(resolvedDir)) {
    console.error(`Error: directory not found: ${dir}`);
    process.exit(1);
  }

  const config = loadConfig(values.config);
  const dryRun = values['dry-run'];

  const pdfs = readdirSync(resolvedDir).filter(
    f => f.toLowerCase().endsWith('.pdf') && !f.startsWith('.')
  );

  if (pdfs.length === 0) {
    console.log('No PDF files found.');
    return;
  }

  let nRenamed = 0, nUnchanged = 0, nSkipped = 0;

  for (const pdf of pdfs) {
    const fullPath = join(resolvedDir, pdf);
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
    const isoDate = extractDate(await getText(), dateLabels);

    if (!isoDate) {
      console.log(`NO DATE    ${pdf}  [${company.name}]`);
      nSkipped++;
      continue;
    }

    const { dir: targetDir, name: newName, full: targetPath } = computeOutputPath(
      config, company, isoDate, await getText()
    );

    if (targetPath === fullPath) {
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
