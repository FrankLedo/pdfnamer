# pdfnamer

[![npm version](https://img.shields.io/npm/v/@frankledo/pdfnamer.svg)](https://www.npmjs.com/package/@frankledo/pdfnamer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

`pdfnamer` is a CLI tool that renames and organizes PDF bills and statements by automatically extracting the company name, date, and document type from the PDF content. Using a config file you maintain, it matches each PDF to a known company via filename patterns or keyword scanning, extracts the statement date, and moves the file to a structured output path — keeping your downloads folder clean with zero manual effort.

## Installation

```
npm install -g @frankledo/pdfnamer
```

Requires **Node.js 18.3 or later**. No other system dependencies are needed.

## Quick start

**1. Install**

```
npm install -g @frankledo/pdfnamer
```

**2. Generate a starter config**

```
pdfnamer --init
```

This writes `~/.config/pdfnamer/config.json` with an annotated example you can edit.

**3. Run on a folder of PDFs**

```
pdfnamer ~/Downloads
```

Use `--dry-run` to preview renames without moving any files:

```
pdfnamer --dry-run ~/Downloads
```

## Configuration

The config file lives at `~/.config/pdfnamer/config.json` by default. Pass `--config <path>` to use a different location.

### Full annotated example

```json
{
  "output_path": "~/Documents/Bills/{year}/{company}/{date} - {company}[ - {account}][ - {doctype}]",
  "date_format": "YYYY-MM-DD",
  "date_labels": ["Statement Date:", "Bill Date:", "Invoice Date:", "Closing Date:"],
  "companies": [
    {
      "name": "Riverside Electric",
      "filename_patterns": ["riverside_bill_*", "RiversideElectric_*"],
      "keywords": ["Riverside Electric Company", "riverside-electric.example.com"],
      "noAccountNumber": true,
      "subjects": [
        { "match": "Electric Bill", "alias": "Bill" }
      ]
    },
    {
      "name": "Oakwood Bank - Sapphire Visa - 1234",
      "keywords": ["Sapphire Visa", "oakwoodbank.example.com"],
      "keyword_search_chars": 8000,
      "noAccountNumber": true,
      "date_labels": ["Closing Date:", "Statement Date:"],
      "subjects": [
        { "match": "Statement", "alias": "Statement" }
      ]
    },
    {
      "name": "Oakwood Bank - Rewards Visa - 5678",
      "keywords": ["Rewards Visa", "oakwoodbank.example.com"],
      "keyword_search_chars": 8000,
      "noAccountNumber": true,
      "date_labels": ["Closing Date:", "Statement Date:"],
      "subjects": [
        { "match": "Statement", "alias": "Statement" }
      ]
    },
    {
      "name": "Oakwood Bank",
      "keywords": ["oakwoodbank.example.com", "Oakwood Bank"],
      "accounts": [
        { "number": "9012", "alias": "Checking" }
      ],
      "subjects": [
        { "match": "Account Statement", "alias": "Statement" }
      ]
    }
  ]
}
```

### Top-level fields

| Field | Default | Description |
|---|---|---|
| `output_path` | required | Template for the output file path. See tokens below. |
| `date_format` | `YYYY-MM-DD` | Format for `{date}` in the output path. |
| `date_labels` | `["Statement Date:", ...]` | Labels searched in every PDF when extracting the statement date. Can be overridden per company. |
| `rename_in_place` | `false` | When `true`, rename files in their current directory instead of moving them to `output_path`. The filename format is still controlled by the basename of `output_path`. Useful for receipts folders you want to keep in place but make searchable. |
| `unmatched_prefix` | `false` | When `true`, files that don't match any company entry are still renamed: a date prefix (`{date} - `) is prepended to the original filename. Files that can't yield any date, or whose name already starts with a date, are left unchanged. Pairs well with `rename_in_place`. |

### Output path tokens

| Token | Description |
|---|---|
| `{year}` | Four-digit year extracted from the statement date |
| `{month}` | Two-digit month (01–12) |
| `{date}` | Full date formatted per `date_format` |
| `{company}` | Company name from the matched config entry |
| `{account}` | Account alias from a matched `accounts` entry |
| `{doctype}` | Document type alias from a matched `subjects` entry |

Wrap a token and its surrounding delimiter in `[...]` to make the whole segment optional — it is omitted entirely when the token is empty:

```
{date} - {company}[ - {account}][ - {doctype}]
{date}_{company}[_{account}][_{doctype}]
{year}/{company}/{date} - {company}[/{doctype}]
```

Companies that have no `accounts` entry will silently skip the `[ - {account}]` block; companies that do will include it. This works with any delimiter style.

### Per-company fields

| Field | Description |
|---|---|
| `name` | Display name used in the output path. |
| `output_path` | Override the global `output_path` for this company only. |
| `filename_patterns` | Glob patterns checked against the PDF filename (case-insensitive, supports `*`). Matched before keywords — no PDF parsing needed. |
| `keywords` | Strings to scan for in the PDF text when no filename pattern matches. |
| `keyword_search_chars` | How many characters from the start of the PDF text to search for keywords. Default `2000`. Increase for documents where card-specific branding appears later in the file. |
| `date_labels` | Override the global `date_labels` for this company. Useful when a company uses non-standard date field names. |
| `accounts` | Array of `{ number, alias }` objects. When a number is found in the PDF text the corresponding alias is used as `{account}`. |
| `subjects` | Array of `{ match, alias }` objects. When `match` is found in the PDF text the alias is used as `{doctype}`. First match wins. |
| `noAccountNumber` | Set `true` to suppress account matching entirely (omits `{account}` token). |

## CLI flags

| Flag | Description |
|---|---|
| `-n, --dry-run` | Preview renames without moving any files |
| `-c, --config <path>` | Use a custom config file instead of `~/.config/pdfnamer/config.json` |
| `--init` | Write a starter config to `~/.config/pdfnamer/config.json` and exit |
| `--install-quickaction` | Install a Finder Quick Action (macOS) so you can right-click PDFs to rename them. After running, go to **System Settings → Privacy & Security → Extensions → Finder** and enable the pdfnamer action. |
| `-h, --help` | Show usage information |

## How matching works

pdfnamer processes each PDF in two phases. **Company order matters: the first matching entry wins.** Place specific entries before catch-alls.

**Company identification**

1. Check each company's `filename_patterns` against the PDF filename (fast, no PDF parsing needed). First match wins.
2. If no pattern matches, extract the PDF text and scan for each company's `keywords` in order. First match wins.
3. If still no match, report `UNMATCHED` with a text snippet to help you add a new entry.

**Ordering example:** Two credit cards from the same bank share a generic bank keyword. Put the card-specific entries first; the generic bank entry acts as a catch-all:

```json
{ "name": "Oakwood Bank - Sapphire Visa", "keywords": ["Sapphire Visa", "oakwoodbank.example.com"], "keyword_search_chars": 8000 },
{ "name": "Oakwood Bank - Rewards Visa",  "keywords": ["Rewards Visa",  "oakwoodbank.example.com"], "keyword_search_chars": 8000 },
{ "name": "Oakwood Bank",                 "keywords": ["oakwoodbank.example.com", "Oakwood Bank"] }
```

The catch-all only matches files that didn't already match a card-specific entry. Similarly, if two companies share a keyword, the one listed first always wins.

**Date extraction**

Dates are extracted in this order — the first successful result is used:

1. Search for each label in `date_labels` (case-insensitive). When found, parse the date in the following 60 characters.
2. Detect a date range anywhere in the document (`MM/DD/YYYY - MM/DD/YYYY`, `MM/DD/YYYY to MM/DD/YYYY`, `MM/DD/YY-MM/DD/YY`) and use the **end** date.
3. Fall back to the first parseable date in the document header (first 2000 characters).
4. Fall back to a date embedded in the filename itself.

**Recognized date formats**

- `YYYY-MM-DD` (ISO)
- `Month DD, YYYY` and `Month DD , YYYY` (e.g. `January 1 , 2026`)
- `MM/DD/YYYY` and `MM-DD-YYYY`
- `MM/DD/YY` and `MM-DD-YY`
- `YYYYMMDDHHmmss` embedded in filenames (e.g. utility download filenames)
- Bare `YYYY` (tax year — mapped to December 31 of that year)

## Contributing

Bug reports and pull requests are welcome on GitHub.

## License

MIT — see [LICENSE](LICENSE).
