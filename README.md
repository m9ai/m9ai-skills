# m9ai-skills

English | [简体中文](README.zh-CN.md)

A monorepo of Agent Skills. Each subdirectory is one self-contained skill package: pushing to
`main` makes GitHub Actions detect what changed, validate it, package it as a zip, tag it
`{skill}/v{version}` and publish a Release.

## Install

```bash
# Install one skill (you will be asked which client to install into)
npx skills add m9ai/m9ai-skills --skill amount-to-chinese-skill

# Install into a specific client
npx skills add m9ai/m9ai-skills --skill amount-to-chinese-skill -a claude-code

# List what is available without installing anything
npx skills add m9ai/m9ai-skills --list
```

Each Release also ships a `{skill}-v{version}.zip`. If you would rather not use the CLI,
download it from the [Releases](https://github.com/m9ai/m9ai-skills/releases) page and unpack it
into your client's skills directory.

## Available skills

25 skills. Names below are directory names — they are what `--skill` expects.

### Finance & Tax

| Directory | Skill |
|---|---|
| `amount-to-chinese-skill` | Amount to Chinese Capital |
| `bank-reconciliation-skill` | Bank Reconciliation |
| `expense-audit-skill` | Expense Audit |
| `invoice-field-checker-skill` | Invoice Field Checker |

### Legal & Compliance

| Directory | Skill |
|---|---|
| `contract-checklist-skill` | Contract Checklist |
| `deadline-calculator-skill` | Deadline Calculator |
| `file-evidence-seal-skill` | File Evidence Seal |
| `pii-redactor-skill` | PII Redactor |

### Data Statistics

| Directory | Skill |
|---|---|
| `csv-aggregator-skill` | CSV Aggregator |
| `csv-cleaner-skill` | CSV Cleaner |
| `csv-diff-skill` | CSV Diff |
| `data-quality-checker-skill` | Data Quality Checker |

### Content Compliance

| Directory | Skill |
|---|---|
| `ad-law-risk-checker-skill` | Ad Law Risk Checker |
| `banned-word-checker-skill` | Banned Word Checker |
| `pii-leak-scanner-skill` | PII & Secret Leak Scanner |

### File Batch Processing

| Directory | Skill |
|---|---|
| `batch-rename-skill` | Batch Rename |
| `dir-fingerprint-skill` | Directory Fingerprint |
| `duplicate-file-finder-skill` | Duplicate File Finder |

### Document Processing

| Directory | Skill |
|---|---|
| `markdown-linter-skill` | Markdown Linter |
| `markdown-table-builder-skill` | Markdown Table Builder |
| `subtitle-converter-skill` | Subtitle Converter |

### Dev & Ops

| Directory | Skill |
|---|---|
| `cron-explainer-skill` | Cron Explainer |
| `json-toolkit-skill` | JSON Toolkit |
| `secret-scanner-skill` | Secret Scanner |

### Travel & Transit

| Directory | Skill |
|---|---|
| `jinshan-train-skill` | Jinshan Railway Schedule |

`shanghai-school-district-skill` is a placeholder that is not ready yet — it has no `SKILL.md`
and is skipped by CI.

## Repository layout

```
m9ai-skills/
├── .github/workflows/build-skills.yml   # CI: detect → validate → package → release
├── docs/
│   ├── TAXONOMY.md                      # Controlled vocabulary for category / scenarios / roles
│   └── CATALOG.md                       # Candidate backlog, top 10 per category
├── scripts/
│   ├── read-meta.sh                     # Read a field from SKILL.md frontmatter
│   ├── detect-changed.sh                # Detect which skills changed in this push
│   ├── validate-skill.sh                # Package spec validation
│   └── package-skill.sh                 # Package as {dir}-v{version}.zip
├── <name>-skill/                        # One directory per skill
└── LICENSE                              # MIT
```

A skill package may only nest two levels deep (root / subdirectory / file). `scripts/`,
`.github/` and `docs/` are repository infrastructure and are never packaged.

## Releasing a skill

1. Edit the contents of the skill directory.
2. **Bump `version` in `SKILL.md`** (semver, e.g. `1.0.0` → `1.1.0`).
3. Commit and push to `main`.

CI then runs: detect changes → validate → package → upload artifact → tag
`{skill}/v{version}` and publish a Release.

Download the zip from the Release and submit it to the WorkBuddy skill marketplace.

## Versioning

The single source of truth for a version is `SKILL.md` frontmatter:

```yaml
---
name: amount-to-chinese-skill
version: 1.0.0
---
```

- Any content change requires a version bump — **otherwise CI fails**.
- Re-publishing the same version fails (deduplicated by git tag).
- There is no `package.json` to maintain.

## Local checks

Run the same validation CI runs, before you push:

```bash
./scripts/validate-skill.sh amount-to-chinese-skill      # validate
./scripts/package-skill.sh amount-to-chinese-skill dist  # package into dist/
./scripts/read-meta.sh amount-to-chinese-skill version   # print the version
```

## Adding a skill

Create a directory containing `SKILL.md`. Required frontmatter fields:

| Field | Meaning |
|---|---|
| `name` | Skill identifier — keep it identical to the directory name |
| `description` | Purpose plus trigger phrases |
| `description_zh` / `description_en` | Short summary in Chinese / English |
| `version` | Semver version |
| `author` | Partner name |

Recommended fields — the marketplace filters on them, so read
[docs/TAXONOMY.md](docs/TAXONOMY.md) first:

| Field | Meaning |
|---|---|
| `category` | One of the controlled vocabulary in `docs/TAXONOMY.md` |
| `scenarios` | Usage scenarios |
| `roles` | Intended roles |

Optional subdirectories: `references/` (reference material), `scripts/` (executable scripts),
`templates/` (template files).

## Self-tests

Every script ships a `--selftest`. Run it after any change:

```bash
node amount-to-chinese-skill/scripts/amount.js --selftest
node json-toolkit-skill/scripts/json.js --selftest
node csv-cleaner-skill/scripts/csv.js --selftest
node subtitle-converter-skill/scripts/subtitle.js --selftest
```

Add cases alongside any new script. All self-tests currently pass, and they are the only
regression guard this repository has.

## License

[MIT](LICENSE) — use, modify and redistribute freely, provided the copyright and permission
notice stay intact.

This is a public repository. The ID numbers, card numbers and `AKIA` / `ghp_` strings that
appear in `--selftest` fixtures are well-known placeholder values, not real credentials. Keep
that convention: never put real data into a test case.
