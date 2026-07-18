---
name: medlattice
description: >
  Call MedLattice (医研格) public academic research APIs for citation check,
  citation match, paper search, literature map, datasets, journals, trials,
  lightweight search, and PDF gate. Use when the user or agent needs PubMed/DOI
  verification, reference matching, paper lookup, trial bridging, journal
  metrics, OA PDF links, or MedLattice /api/v1 integration.
---

# MedLattice API

Base URL (override with `MEDLATTICE_BASE_URL`):

`https://med.aispeedtest.eu`

**Credential required** for all `/api/v1/*` calls: set env `MEDLATTICE_API_KEY` and send header `X-API-Key` (or `Authorization: Bearer`). Do not invent or hardcode the value in chat; read it from the environment / secret store. Never explain the credential’s purpose on the public website UI.

## Prefer the CLI script

Run from repo root (Node 18+):

```bash
node .claude/skills/medlattice/scripts/ml_api.mjs <command> [flags]
```

The script reads `MEDLATTICE_BASE_URL` and `MEDLATTICE_API_KEY` from the environment.

| Command | Maps to | Flags |
|---------|---------|-------|
| `catalog` | `GET /api/v1` | — |
| `citations` | `POST /api/v1/citations` | `--text` / `--reference` / `--references` (JSON array string) |
| `match` | `POST /api/v1/match` | `--text` |
| `papers` | `GET /api/v1/papers` | `--q` `--sort` `--since` `--oa` `--page` |
| `map` | `GET /api/v1/map` | `--q` |
| `datasets` | `GET /api/v1/datasets` | `--q` |
| `journals` | `GET /api/v1/journals` | `--q` |
| `journal` | `GET /api/v1/journals/:id` | `--id` |
| `trials` | `GET /api/v1/trials` | `--q` `--mode` |
| `search` | `GET /api/v1/search` | `--q` |
| `pdf` | `GET /api/v1/pdf?format=json` | `--url` and/or `--doi` `--mode` |

Examples:

```bash
export MEDLATTICE_API_KEY="…"   # from secrets, not from the website
node .claude/skills/medlattice/scripts/ml_api.mjs papers --q "pembrolizumab melanoma"
node .claude/skills/medlattice/scripts/ml_api.mjs citations --reference "Wolchok JD, et al. ... PMID: 28889792"
```

## Agent workflow

1. Ensure `MEDLATTICE_API_KEY` is available in the environment before calling `/api/v1`.
2. Prefer `ml_api.mjs` over ad-hoc curl.
3. Summarize results in Chinese unless asked otherwise; never fabricate DOI/PMID.
4. Do not paste the raw credential into user-visible pages, README marketing copy, or commit it to git.

## Response envelope

Most: `{ "ok": true, "version": "1", "data": {}, "meta": {} }`  
Citations: `{ "ok": true, "version": "1", "summary": {}, "results": [], "meta": {} }`  
Errors: `{ "ok": false, "error": "...", "code": "unauthorized"|"bad_request"|"not_found"|"upstream" }`

## More detail

- [references/api.md](references/api.md)
- [references/examples.md](references/examples.md)
