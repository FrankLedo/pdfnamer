# Changelog

All notable changes to this project will be documented in this file.

## 1.0.0 (2026-06-28)


### Features

* add rename_in_place and unmatched_prefix config options ([fc53fbc](https://github.com/FrankLedo/pdfnamer/commit/fc53fbc172defdfe8e0754581e132de5f25d3532))

## [1.0.0] - 2026-06-24

### Added

- Initial release of `pdfnamer`
- PDF text extraction powered by `pdfjs-dist` — no native dependencies required
- Config-driven company matching via `filename_patterns` (filename scan) and `keywords` (PDF text scan)
- Per-company `accounts` mapping (last-four digits → readable alias) and `subjects` mapping (keyword → document type label)
- `noAccountNumber` flag for companies without account numbers
- Configurable `output_path` template with tokens: `{year}`, `{month}`, `{date}`, `{company}`, `{account}`, `{doctype}`
- Configurable `date_format` and `date_labels` for flexible date extraction
- `--dry-run` flag to preview renames without moving files
- `--config <path>` flag to specify a custom config location
- `--init` flag to generate a starter config at `~/.config/pdfnamer/config.json`
- UNMATCHED fallback — unrecognized PDFs are renamed with a text snippet for easy identification
- TypeScript implementation compiled to ES modules
- Node.js 18.3+ requirement
