# MedLattice `/api/v1` reference

Base: `MEDLATTICE_BASE_URL` or `https://med.aispeedtest.eu`

All `/api/v1/*` require header `X-API-Key` (value from env `MEDLATTICE_API_KEY`).

Discover catalog: `GET /api/v1` (still requires credential)


## POST `/api/v1/citations`

Body (one of):

- `{ "text": "numbered or multiline refs" }` — auto-split, max 15
- `{ "references": ["ref1", "ref2"] }`
- `{ "reference": "single ref" }`

Limits: ≤30000 chars total; ≤15 refs.

Returns `summary` + `results[]` with `status`, `fieldDiffs`, `fieldChecks`, `record`, `formats`.

## POST `/api/v1/match`

Body: `{ "text": "title or passage (auto-split ≤10 sentences)" }`

Returns candidates with evidence / sentence reports.

## GET `/api/v1/papers`

Query: `q` (required), `sort` (`relevance`|`citations`|`date`), `since` (year), `oa=1`, `page`, `perPage`.

`data.results[]` may include `oaPdfUrl`, `pdfJumpUrl`, `pdfProxyUrl`, `journal`.

## GET `/api/v1/map`

Query: `q` = DOI | PMID | title → graph nodes/edges.

## GET `/api/v1/datasets`

Query: `q` — OmicsDI / GEO / openFDA / DataCite / CT.gov / OpenAlex mix.

## GET `/api/v1/journals`

Query: `q` — journal search.

## GET `/api/v1/journals/{id}`

OpenAlex source id (e.g. `S137773608` or numeric).

## GET `/api/v1/trials`

Query: `q`, `mode` = `auto` | `paper` | `trial`.

## GET `/api/v1/search`

Query: `q` — lightweight OpenAlex/PubMed style search.

## GET `/api/v1/pdf`

Query: `url` and/or `doi`, `mode`=`redirect`|`proxy`, `format=json` for `{ jumpUrl, proxyUrl, target }`.

WeChat: whitelist host only; use `pdfJumpUrl` / this gate instead of raw publisher PDF hosts.
