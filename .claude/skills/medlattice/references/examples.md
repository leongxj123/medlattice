# MedLattice curl examples

```bash
BASE="${MEDLATTICE_BASE_URL:-https://med.aispeedtest.eu}"
KEY_HDR=()
[[ -n "$MEDLATTICE_API_KEY" ]] && KEY_HDR=(-H "X-API-Key: $MEDLATTICE_API_KEY")

# Catalog
curl -sS "$BASE/api/v1" "${KEY_HDR[@]}"

# Papers
curl -sS "$BASE/api/v1/papers?q=pembrolizumab" "${KEY_HDR[@]}"

# Citations
curl -sS -X POST "$BASE/api/v1/citations" \
  -H "Content-Type: application/json" "${KEY_HDR[@]}" \
  -d '{"reference":"Wolchok JD, et al. Overall Survival with Combined Nivolumab and Ipilimumab in Advanced Melanoma. N Engl J Med. 2017;377(14):1345-1356. PMID: 28889792"}'

# Match
curl -sS -X POST "$BASE/api/v1/match" \
  -H "Content-Type: application/json" "${KEY_HDR[@]}" \
  -d '{"text":"Overall survival with combined nivolumab and ipilimumab in advanced melanoma."}'

# Map / trials / journals / datasets / search
curl -sS "$BASE/api/v1/map?q=10.1056/NEJMoa1709684" "${KEY_HDR[@]}"
curl -sS "$BASE/api/v1/trials?q=NCT04368728&mode=auto" "${KEY_HDR[@]}"
curl -sS "$BASE/api/v1/journals?q=New%20England%20Journal%20of%20Medicine" "${KEY_HDR[@]}"
curl -sS "$BASE/api/v1/datasets?q=COVID-19%20RNA-seq" "${KEY_HDR[@]}"
curl -sS "$BASE/api/v1/search?q=BNT162b2" "${KEY_HDR[@]}"

# PDF gate (JSON links)
curl -sS "$BASE/api/v1/pdf?doi=10.1056/NEJMoa1709684&format=json" "${KEY_HDR[@]}"
```

On Windows PowerShell, prefer the Node CLI in `scripts/ml_api.mjs` instead of bash arrays.
