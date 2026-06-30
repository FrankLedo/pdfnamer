# Changelog

All notable changes to this project will be documented in this file.

## [2.1.0](https://github.com/FrankLedo/pdfnamer/compare/v2.0.0...v2.1.0) (2026-06-30)


### Features

* folder watcher (--install-watcher / --uninstall-watcher) ([#11](https://github.com/FrankLedo/pdfnamer/issues/11)) ([be0c555](https://github.com/FrankLedo/pdfnamer/commit/be0c555ec8b907c76b19648fab257ababf1f512a))

## [2.0.0](https://github.com/FrankLedo/pdfnamer/compare/v1.1.0...v2.0.0) (2026-06-30)


### ⚠ BREAKING CHANGES

* pdfjs-dist@6 requires Node >=22.13.0, so pdfnamer no longer runs on Node 18 or 20. The engines field, CI matrix, publish workflow, and README were aligned to this floor in the prior release; this commit records it as the breaking change it is.

### Features

* add --version / -v flag ([117ef92](https://github.com/FrankLedo/pdfnamer/commit/117ef92aa894b7f0a7c798f1e46e516e1afd571f))
* add --version / -v flag ([321e772](https://github.com/FrankLedo/pdfnamer/commit/321e7721eed796c60f083e14ac28dc283e00d69f))
* drop support for Node 18 and 20 ([aa51f1a](https://github.com/FrankLedo/pdfnamer/commit/aa51f1af7dff676a7dd28e89dd4d795d2cf8c37a))

## [1.1.0](https://github.com/FrankLedo/pdfnamer/compare/v1.0.3...v1.1.0) (2026-06-29)


### Features

* parse day-first date format (DD Mon YYYY) ([2a0264c](https://github.com/FrankLedo/pdfnamer/commit/2a0264c9ce8583281b7ef6f4091d982340533917))
* parse day-first date format (DD Mon YYYY) ([2a0264c](https://github.com/FrankLedo/pdfnamer/commit/2a0264c9ce8583281b7ef6f4091d982340533917))
* parse day-first date format (DD Mon YYYY) ([5656f0a](https://github.com/FrankLedo/pdfnamer/commit/5656f0a12a008a6c2744eddb91cdf52e8487d7f2))

## [1.0.3](https://github.com/FrankLedo/pdfnamer/compare/v1.0.2...v1.0.3) (2026-06-28)


### Bug Fixes

* correct repository URL casing to match GitHub username ([60e6afe](https://github.com/FrankLedo/pdfnamer/commit/60e6afebb62886c596f2d814bb53fd9fca573ef5))

## [1.0.2](https://github.com/FrankLedo/pdfnamer/compare/v1.0.1...v1.0.2) (2026-06-28)


### Bug Fixes

* use npm OIDC Trusted Publishers without registry-url token override ([d28285b](https://github.com/FrankLedo/pdfnamer/commit/d28285b32bb372c41d91acaaa4a6fab102a94fe8))
* use NPM_TOKEN secret for publish authentication ([d2df4bd](https://github.com/FrankLedo/pdfnamer/commit/d2df4bd6b99dc8d22b9e6f364ff5993b0511c854))

## [1.0.1](https://github.com/FrankLedo/pdfnamer/compare/v1.0.0...v1.0.1) (2026-06-28)


### Bug Fixes

* cross-reference Quick Action flag to dedicated setup section ([5653bc2](https://github.com/FrankLedo/pdfnamer/commit/5653bc214d73b47a3501b46fbde5c45bebb24af4))

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
