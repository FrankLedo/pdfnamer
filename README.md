# pdfnamer

[![npm version](https://img.shields.io/npm/v/pdfnamer.svg)](https://www.npmjs.com/package/pdfnamer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

`pdfnamer` is a CLI tool that renames and organizes PDF bills and statements by automatically extracting the company name, date, and document type from the PDF content. Using a config file you maintain, it matches each PDF to a known company via filename patterns or keyword scanning, extracts the statement date, and moves the file to a structured output path — keeping your downloads folder clean with zero manual effort.

## Installation

```
npm install -g pdfnamer
```

Requires **Node.js 18.3 or later**. No other system dependencies are needed.

## Quick start

**1. Install**

```
npm install -g pdfnamer
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
  "output_path": "~/Documents/Bills/{year}/{company}/{date} - {company} - {doctype}",
  "date_format": "YYYY-MM-DD",
  "date_labels": ["Statement Date", "Bill Date", "Invoice Date", "Due Date", "Period Ending"],
  "companies": [
    {
      "name": "Chase",
      "filename_patterns": ["Chase", "chase_statement"],
      "keywords": ["JPMorgan Chase", "chase.com", "Chase Bank"],
      "accounts": [
        { "number": "1234", "alias": "Sapphire" },
        { "number": "5678", "alias": "Freedom" }
      ],
      "subjects": [
        { "match": "credit card", "alias": "Credit Card Statement" },
        { "match": "checking",    "alias": "Checking Statement" }
      ]
    },
    {
      "name": "Pacific Gas and Electric",
      "filename_patterns": ["PGE", "pge_bill"],
      "keywords": ["Pacific Gas and Electric", "pge.com"],
      "noAccountNumber": true,
      "subjects": [
        { "match": "electric", "alias": "Electric Bill" }
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
| `date_labels` | `["Statement Date", ...]` | Labels to search for when extracting the statement date from the PDF. |

### Output path tokens

| Token | Description |
|---|---|
| `{year}` | Four-digit year extracted from the statement date |
| `{month}` | Two-digit month (01–12) |
| `{date}` | Full date formatted per `date_format` |
| `{company}` | Company name from the matched config entry |
| `{account}` | Account alias (or last-four digits if no alias defined) |
| `{doctype}` | Document type alias from a matched subject, or a generic fallback |

### Per-company fields

| Field | Description |
|---|---|
| `name` | Display name used in the output path |
| `filename_patterns` | Strings to check against the PDF filename (case-insensitive). Matched first — fastest path. |
| `keywords` | Strings to scan for inside the PDF text when no filename pattern matches. |
| `accounts` | Array of `{ number, alias }` objects mapping account last-four digits to a readable name. |
| `subjects` | Array of `{ match, alias }` objects mapping a keyword found in the PDF to a document type label. |
| `noAccountNumber` | Set `true` to omit the account segment from the output path for companies that don't have account numbers. |

## CLI flags

| Flag | Description |
|---|---|
| `--dry-run` | Preview renames without moving any files |
| `--config <path>` | Use a custom config file instead of `~/.config/pdfnamer/config.json` |
| `--init` | Write a starter config to `~/.config/pdfnamer/config.json` and exit |
| `--help` | Show usage information |

## How matching works

pdfnamer processes each PDF in two phases:

**Company identification**

1. Check each company's `filename_patterns` against the PDF filename (fast, no PDF parsing needed).
2. If no pattern matches, extract the PDF text with `pdfjs-dist` and scan for each company's `keywords`.
3. If still no match, the file is renamed to `UNMATCHED - <snippet>` where `<snippet>` is the first meaningful text found in the PDF.

**Date extraction**

1. Search the PDF text for any string listed in `date_labels` followed by a date.
2. If no labeled date is found, fall back to scanning the document header for any date-like string.

## Contributing

Bug reports and pull requests are welcome on GitHub.

## License

MIT — see [LICENSE](LICENSE).
