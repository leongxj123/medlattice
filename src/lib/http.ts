export const CONTACT_EMAIL = process.env.MEDLATTICE_CONTACT_EMAIL?.trim() || "dev@medlattice.local";
const USER_AGENT = `MedLattice/0.1 (clinical-research-toolkit; mailto:${CONTACT_EMAIL})`;

export async function fetchJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const largeUpstream = /clinicaltrials\.gov/i.test(url);
  const forceNoStore =
    init?.cache === "no-store" ||
    largeUpstream ||
    /semanticscholar\.org|crossref\.org|openalex\.org|wikipedia\.org|unpaywall\.org|europepmc|omicsdi\.org|api\.fda\.gov/i.test(
      url,
    );
  const { timeoutMs, ...rest } = init || {};

  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  const run = async (): Promise<T> => {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(rest.headers || {}),
      },
      ...(forceNoStore ? { cache: "no-store" as const } : { next: { revalidate: 1800 } }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json() as Promise<T>;
  };

  try {
    if (!timeoutMs) return await run();
    // Promise.race so we never hang even if AbortSignal is ignored by runtime
    return await Promise.race([
      run(),
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`Upstream timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || /timeout/i.test(err.message))) {
      throw new Error(`Upstream timeout after ${timeoutMs || "?"}ms`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": USER_AGENT,
      ...(init?.headers || {}),
    },
    next: { revalidate: 1800 },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.text();
}

export function encodeQuery(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export type OpenAlexWork = {
  id: string;
  doi?: string | null;
  ids?: {
    openalex?: string;
    doi?: string | null;
    pmid?: string | null;
    pmcid?: string | null;
  };
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  authorships?: Array<{ author?: { display_name?: string; id?: string } }>;
  primary_location?: {
    source?: { display_name?: string | null; id?: string | null } | null;
    landing_page_url?: string | null;
  } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  referenced_works?: string[];
  related_works?: string[];
  type?: string | null;
  type_crossref?: string | null;
  keywords?: Array<{ display_name?: string }>;
  concepts?: Array<{ display_name?: string; level?: number; score?: number }>;
  topics?: Array<{ display_name?: string; score?: number }>;
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
};

export function workTitle(work: OpenAlexWork) {
  return work.display_name || work.title || "Untitled";
}

export function workAuthors(work: OpenAlexWork, limit = 3) {
  const names = (work.authorships || [])
    .map((a) => a.author?.display_name)
    .filter(Boolean) as string[];
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} et al.`;
}

export function reconstructAbstract(index?: Record<string, number[]> | null) {
  if (!index) return "";
  const pairs: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) pairs.push([pos, word]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map(([, w]) => w).join(" ");
}

export function openAlexId(idOrUrl: string) {
  if (idOrUrl.startsWith("http")) return idOrUrl.split("/").pop() || idOrUrl;
  return idOrUrl.replace(/^W/i, "W");
}

export function stripDoi(doi?: string | null) {
  if (!doi) return null;
  return doi.replace(/^https?:\/\/doi\.org\//i, "").trim();
}

export function extractPmid(raw: string) {
  const t = raw.trim();
  if (/^[0-9]{5,9}$/.test(t)) return t;
  const m = t.match(/\bPMID[:\s]*([0-9]{5,9})\b/i);
  return m?.[1] || null;
}

export function detectEvidenceTags(input: {
  title?: string | null;
  type?: string | null;
  type_crossref?: string | null;
  abstract?: string;
}): string[] {
  const blob = `${input.title || ""} ${input.type || ""} ${input.type_crossref || ""} ${input.abstract || ""}`.toLowerCase();
  const tags: string[] = [];
  if (/meta[-\s]?analysis|systematic review/.test(blob)) tags.push("系统综述/Meta");
  if (/\brct\b|randomized|randomised|randomly assigned/.test(blob)) tags.push("RCT");
  if (/clinical trial|phase [i1v]+|phase\s*[123]/.test(blob)) tags.push("临床试验");
  if (/guideline|consensus|practice recommendation/.test(blob)) tags.push("指南/共识");
  if (/case report|case series/.test(blob)) tags.push("病例报告");
  if (/in vitro|mouse|mice|murine|knockout|organoid|cell line/.test(blob)) tags.push("基础/实验");
  if (/cohort|prospective|retrospective|observational/.test(blob)) tags.push("观察性");
  if (/review\b/.test(blob) && !tags.includes("系统综述/Meta")) tags.push("综述");
  return Array.from(new Set(tags)).slice(0, 4);
}

export async function resolveWorkQuery(q: string): Promise<OpenAlexWork | null> {
  const raw = q.trim();
  if (!raw) return null;

  if (/^10\.\d{4,}\/\S+/i.test(raw) || raw.toLowerCase().startsWith("doi:")) {
    const doi = raw.replace(/^doi:/i, "").trim();
    return fetchJson<OpenAlexWork>(
      `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?${encodeQuery({ mailto: CONTACT_EMAIL })}`,
    );
  }

  if (/^PMID[:\s]*/i.test(raw) || /^[0-9]{5,9}$/.test(raw)) {
    const pmid = raw.replace(/^PMID[:\s]*/i, "").trim();
    try {
      return await fetchJson<OpenAlexWork>(
        `https://api.openalex.org/works/pmid:${encodeURIComponent(pmid)}?${encodeQuery({ mailto: CONTACT_EMAIL })}`,
      );
    } catch {
      /* fall through */
    }
  }

  if (/^W\d+/i.test(raw) || raw.includes("openalex.org/W")) {
    const id = openAlexId(raw);
    return fetchJson<OpenAlexWork>(
      `https://api.openalex.org/works/${id.startsWith("W") ? id : `W${id}`}?${encodeQuery({ mailto: CONTACT_EMAIL })}`,
    );
  }

  if (/^NCT\d{8}$/i.test(raw)) {
    const search = await fetchJson<{ results: OpenAlexWork[] }>(
      `https://api.openalex.org/works?${encodeQuery({
        search: raw,
        per_page: 1,
        mailto: CONTACT_EMAIL,
      })}`,
    );
    return search.results?.[0] || null;
  }

  const search = await fetchJson<{ results: OpenAlexWork[] }>(
    `https://api.openalex.org/works?${encodeQuery({
      search: raw,
      per_page: 1,
      mailto: CONTACT_EMAIL,
    })}`,
  );
  return search.results?.[0] || null;
}

/** PubMed E-utilities: convert DOI/title → PMIDs (public NLM API) */
export async function pubmedSearchIds(term: string, retmax = 5): Promise<string[]> {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${encodeQuery({
    db: "pubmed",
    term,
    retmax,
    retmode: "json",
    sort: "relevance",
  })}`;
  const data = await fetchJson<{ esearchresult?: { idlist?: string[]; count?: string } }>(url);
  return data.esearchresult?.idlist || [];
}

export async function pubmedSearchMeta(term: string, retmax = 15, retstart = 0) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${encodeQuery({
    db: "pubmed",
    term,
    retmax,
    retstart,
    retmode: "json",
    sort: "relevance",
  })}`;
  const data = await fetchJson<{ esearchresult?: { idlist?: string[]; count?: string } }>(url);
  return {
    ids: data.esearchresult?.idlist || [],
    count: Number(data.esearchresult?.count || 0),
  };
}

export async function pubmedSummaries(pmids: string[]) {
  if (!pmids.length)
    return [] as Array<{
      pmid: string;
      title: string;
      source?: string;
      pubdate?: string;
      authors?: string;
      doi?: string | null;
    }>;
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${encodeQuery({
    db: "pubmed",
    id: pmids.join(","),
    retmode: "json",
  })}`;
  const data = await fetchJson<{
    result?: Record<
      string,
      {
        uid?: string;
        title?: string;
        fulljournalname?: string;
        source?: string;
        pubdate?: string;
        authors?: Array<{ name?: string }>;
        articleids?: Array<{ idtype?: string; value?: string }>;
      }
    >;
  }>(url);
  return pmids.map((id) => {
    const r = data.result?.[id];
    const doi = r?.articleids?.find((a) => a.idtype === "doi")?.value || null;
    return {
      pmid: id,
      title: r?.title || "Untitled",
      source: r?.fulljournalname || r?.source,
      pubdate: r?.pubdate,
      authors: (r?.authors || [])
        .slice(0, 5)
        .map((a) => a.name)
        .filter(Boolean)
        .join(", "),
      doi,
    };
  });
}

export async function pubmedAbstracts(pmids: string[]) {
  if (!pmids.length) return {} as Record<string, string>;
  try {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${encodeQuery({
      db: "pubmed",
      id: pmids.join(","),
      retmode: "xml",
    })}`;
    const xml = await fetchText(url);
    const map: Record<string, string> = {};
    const articles = xml.split(/<\/PubmedArticle>/i);
    for (const chunk of articles) {
      const pmidMatch = chunk.match(/<MedlineCitation[\s\S]*?<PMID[^>]*>(\d+)<\/PMID>/i);
      if (!pmidMatch) continue;
      const pmid = pmidMatch[1];
      const absParts = [...chunk.matchAll(/<AbstractText\b[^>]*>([\s\S]*?)<\/AbstractText>/gi)].map((m) =>
        decodeXmlEntities(m[1].replace(/<[^>]+>/g, "")).trim(),
      );
      const joined = absParts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (joined) map[pmid] = joined.slice(0, 2500);
    }
    return map;
  } catch {
    return {} as Record<string, string>;
  }
}

function decodeXmlEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** True when PubMed text dump / citation noise was mistaken for an abstract */
export function isGarbageAbstract(s?: string | null) {
  if (!s) return true;
  const t = s.trim();
  if (t.length < 60) return true;
  if (/^PMID:\s*\d+/i.test(t)) return true;
  if (/\[Indexed for MEDLINE\]/i.test(t) && !/\b(Background|Objective|Methods|Results|Conclusions|Abstract)\b/i.test(t)) {
    return true;
  }
  if ((t.match(/\bdoi:\s*10\./gi) || []).length >= 2) return true;
  if ((t.match(/\bPMID:\s*\d+/gi) || []).length >= 2) return true;
  return false;
}

export type S2Paper = {
  paperId: string;
  title?: string;
  abstract?: string | null;
  year?: number | null;
  citationCount?: number | null;
  venue?: string | null;
  publicationTypes?: string[] | null;
  isOpenAccess?: boolean;
  openAccessPdf?: { url?: string } | null;
  tldr?: { text?: string } | null;
  authors?: Array<{ name?: string }>;
  externalIds?: {
    DOI?: string;
    PubMed?: string;
    PubMedCentral?: string;
  } | null;
  url?: string;
};

const S2_FIELDS = [
  "paperId",
  "title",
  "abstract",
  "year",
  "citationCount",
  "authors",
  "venue",
  "externalIds",
  "url",
  "isOpenAccess",
  "openAccessPdf",
  "publicationTypes",
  "tldr",
].join(",");

function s2Headers(): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;
  return headers;
}

function assertS2Ok<T>(data: T, label: string): T {
  if (!data || typeof data !== "object") return data;
  const msg =
    ("message" in data && typeof (data as { message?: unknown }).message === "string"
      ? (data as { message: string }).message
      : null) ||
    ("error" in data && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : null);
  if (msg && /too many requests|rate limit|forbidden|unauthorized/i.test(msg)) {
    throw new Error(`Semantic Scholar ${label}: ${msg}`);
  }
  return data;
}

async function fetchS2Json<T>(url: string, label: string, retries = 2): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await fetchJson<T>(url, {
        cache: "no-store",
        headers: s2Headers(),
      });
      return assertS2Ok(data, label);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const retryable = /429|Too Many Requests|rate limit/i.test(lastErr.message);
      if (!retryable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr || new Error(`Semantic Scholar ${label} failed`);
}

export async function semanticScholarSearch(opts: {
  query: string;
  offset?: number;
  limit?: number;
  year?: string;
  openAccessPdf?: boolean;
  fieldsOfStudy?: string;
}) {
  let url = `https://api.semanticscholar.org/graph/v1/paper/search?${encodeQuery({
    query: opts.query,
    fields: S2_FIELDS,
    offset: opts.offset ?? 0,
    limit: opts.limit ?? 15,
    year: opts.year,
    fieldsOfStudy: opts.fieldsOfStudy || "Medicine,Biology",
  })}`;
  if (opts.openAccessPdf) url += "&openAccessPdf";

  return fetchS2Json<{ total?: number; data?: S2Paper[]; offset?: number; message?: string }>(url, "search");
}

export async function semanticScholarGet(idOrDoiOrPmid: string) {
  let path = idOrDoiOrPmid;
  if (/^10\.\d{4,}\//i.test(idOrDoiOrPmid)) path = `DOI:${idOrDoiOrPmid}`;
  else if (/^PMID[:\s]*/i.test(idOrDoiOrPmid) || /^[0-9]{5,9}$/.test(idOrDoiOrPmid)) {
    path = `PMID:${idOrDoiOrPmid.replace(/^PMID[:\s]*/i, "")}`;
  }

  return fetchS2Json<S2Paper>(
    `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(path)}?${encodeQuery({ fields: S2_FIELDS })}`,
    "get",
  );
}

/** OmicsDI: unified omics dataset search (GEO, PRIDE, ArrayExpress, MetaboLights, …) */
export type OmicsDiDataset = {
  id: string;
  source: string;
  title: string;
  description?: string;
  organisms?: string[];
  omics_type?: string[];
  publicationDate?: string;
};

export async function omicsdiSearch(query: string, size = 10) {
  const data = await fetchJson<{ count?: number; datasets?: OmicsDiDataset[] }>(
    `https://www.omicsdi.org/ws/dataset/search?${encodeQuery({
      query,
      size,
      sortfield: "publication_date",
      order: "descending",
    })}`,
    { cache: "no-store", timeoutMs: 7000 },
  );
  return {
    count: data.count || 0,
    datasets: data.datasets || [],
  };
}

/** NCBI GEO DataSets via E-utilities (db=gds) */
export async function geoDatasetsSearch(term: string, retmax = 10) {
  const search = await fetchJson<{ esearchresult?: { idlist?: string[]; count?: string } }>(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${encodeQuery({
      db: "gds",
      term,
      retmax,
      retmode: "json",
      sort: "relevance",
    })}`,
    { cache: "no-store", timeoutMs: 6000 },
  );
  const ids = search.esearchresult?.idlist || [];
  if (!ids.length) return { count: 0, items: [] as Array<{ id: string; title: string; summary?: string; gse?: string; gpl?: string; taxon?: string; pdat?: string }> };

  const summary = await fetchJson<{
    result?: Record<
      string,
      {
        uid?: string;
        title?: string;
        summary?: string;
        gse?: string;
        gpl?: string;
        taxon?: string;
        pdat?: string;
        entrytype?: string;
        accesstype?: string;
      }
    >;
  }>(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${encodeQuery({
      db: "gds",
      id: ids.join(","),
      retmode: "json",
    })}`,
    { cache: "no-store", timeoutMs: 6000 },
  );

  const items = ids.map((id) => {
    const r = summary.result?.[id];
    const gse = r?.gse || (r?.entrytype === "GSE" ? `GSE${id}` : undefined);
    return {
      id,
      title: r?.title || `GEO ${id}`,
      summary: r?.summary?.slice(0, 280),
      gse,
      gpl: r?.gpl,
      taxon: r?.taxon,
      pdat: r?.pdat,
    };
  });

  return {
    count: Number(search.esearchresult?.count || items.length),
    items,
  };
}

/** openFDA drug adverse event search */
export async function openFdaEventSearch(term: string, limit = 8) {
  const safe = term.replace(/[^a-zA-Z0-9 +\-_.]/g, " ").trim();
  if (!safe) return { total: 0, results: [] as Array<{ safetyreportid?: string; receivedate?: string; patient?: { reaction?: Array<{ reactionmeddrapt?: string }>; drug?: Array<{ medicinalproduct?: string }> } }> };

  const tryUrl = (search: string) =>
    fetchJson<{
      meta?: { results?: { total?: number } };
      results?: Array<{
        safetyreportid?: string;
        receivedate?: string;
        patient?: {
          reaction?: Array<{ reactionmeddrapt?: string }>;
          drug?: Array<{ medicinalproduct?: string }>;
        };
      }>;
    }>(`https://api.fda.gov/drug/event.json?search=${encodeURIComponent(search)}&limit=${limit}`, {
      cache: "no-store",
      timeoutMs: 6000,
    });

  try {
    const data = await tryUrl(`patient.drug.medicinalproduct:${safe.split(/\s+/)[0]}`);
    return { total: data.meta?.results?.total || 0, results: data.results || [] };
  } catch {
    try {
      const data = await tryUrl(`patient.drug.openfda.generic_name:${safe.split(/\s+/)[0]}`);
      return { total: data.meta?.results?.total || 0, results: data.results || [] };
    } catch {
      return { total: 0, results: [] };
    }
  }
}

/** Unpaywall: OA PDF / landing page by DOI (requires mailto) */
export type OaLinks = {
  isOa: boolean;
  pdfUrl?: string;
  landingUrl?: string;
  hostType?: string;
};

export async function unpaywallLookup(doi: string): Promise<OaLinks | null> {
  const clean = stripDoi(doi);
  if (!clean) return null;
  try {
    const data = await fetchJson<{
      is_oa?: boolean;
      best_oa_location?: { url_for_pdf?: string | null; url?: string | null; host_type?: string | null } | null;
      oa_locations?: Array<{ url_for_pdf?: string | null; url?: string | null }>;
    }>(`https://api.unpaywall.org/v2/${encodeURIComponent(clean)}?email=${CONTACT_EMAIL}`, {
      cache: "no-store",
      timeoutMs: 4500,
    });
    const best = data.best_oa_location;
    const pdf =
      best?.url_for_pdf ||
      data.oa_locations?.find((l) => l.url_for_pdf)?.url_for_pdf ||
      undefined;
    const landing = best?.url || data.oa_locations?.[0]?.url || undefined;
    return {
      isOa: Boolean(data.is_oa || pdf || landing),
      pdfUrl: pdf || undefined,
      landingUrl: landing || undefined,
      hostType: best?.host_type || undefined,
    };
  } catch {
    return null;
  }
}

/** Europe PMC: OA fulltext / abstract links by DOI or PMID */
export async function europePmcLookup(opts: { doi?: string | null; pmid?: string | null }) {
  const parts: string[] = [];
  if (opts.doi) parts.push(`DOI:${stripDoi(opts.doi)}`);
  if (opts.pmid) parts.push(`EXT_ID:${opts.pmid} AND SRC:MED`);
  if (!parts.length) return null;
  try {
    const data = await fetchJson<{
      resultList?: {
        result?: Array<{
          id?: string;
          pmid?: string;
          doi?: string;
          title?: string;
          abstractText?: string;
          isOpenAccess?: string;
          fullTextUrlList?: { fullTextUrl?: Array<{ url?: string; availability?: string; documentStyle?: string }> };
        }>;
      };
    }>(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${encodeQuery({
        query: parts.join(" OR "),
        format: "json",
        resultType: "core",
        pageSize: 1,
      })}`,
      { cache: "no-store", timeoutMs: 5000 },
    );
    const r = data.resultList?.result?.[0];
    if (!r) return null;
    const urls = r.fullTextUrlList?.fullTextUrl || [];
    const pdf = urls.find((u) => /pdf/i.test(u.documentStyle || "") || /pdf/i.test(u.url || ""))?.url;
    const html = urls.find((u) => u.url)?.url;
    return {
      isOa: String(r.isOpenAccess || "").toLowerCase() === "y" || Boolean(pdf || html),
      pdfUrl: pdf,
      landingUrl: html || (r.pmid ? `https://europepmc.org/article/MED/${r.pmid}` : undefined),
      europePmcUrl: r.pmid
        ? `https://europepmc.org/article/MED/${r.pmid}`
        : r.id
          ? `https://europepmc.org/article/${r.id}`
          : undefined,
      title: r.title,
      abstractText: r.abstractText?.replace(/\s+/g, " ").trim().slice(0, 2500),
    };
  } catch {
    return null;
  }
}

/** OpenAlex work enrichment: journal metrics (not Clarivate JIF) */
export type JournalMetrics = {
  sourceId?: string;
  sourceName?: string;
  issn?: string | null;
  issnList?: string[];
  publisher?: string | null;
  homepage?: string | null;
  country?: string | null;
  meanCitedness2yr?: number | null;
  hIndex?: number | null;
  i10Index?: number | null;
  worksCount?: number | null;
  citedByCount?: number | null;
  isOa?: boolean;
  isInDoaj?: boolean;
  oaUrl?: string | null;
};

type OpenAlexSourcePartial = {
  id?: string;
  display_name?: string;
  issn_l?: string | null;
  issn?: string[] | null;
  host_organization_name?: string | null;
  homepage_url?: string | null;
  country_code?: string | null;
  summary_stats?: {
    "2yr_mean_citedness"?: number;
    h_index?: number;
    i10_index?: number;
  };
  works_count?: number;
  cited_by_count?: number;
  is_oa?: boolean;
  is_in_doaj?: boolean;
};

function sourceKeyOf(id?: string | null) {
  if (!id) return undefined;
  return id.includes("/") ? id.split("/").pop() : id;
}

function metricsFromSource(src: OpenAlexSourcePartial | null | undefined): JournalMetrics | null {
  if (!src) return null;
  const sourceId = sourceKeyOf(src.id);
  const issnList = (src.issn || []).filter(Boolean);
  return {
    sourceId,
    sourceName: src.display_name,
    issn: src.issn_l || issnList[0] || null,
    issnList,
    publisher: src.host_organization_name || null,
    homepage: src.homepage_url || null,
    country: src.country_code || null,
    meanCitedness2yr: src.summary_stats?.["2yr_mean_citedness"] ?? null,
    hIndex: src.summary_stats?.h_index ?? null,
    i10Index: src.summary_stats?.i10_index ?? null,
    worksCount: src.works_count ?? null,
    citedByCount: src.cited_by_count ?? null,
    isOa: Boolean(src.is_oa),
    isInDoaj: Boolean(src.is_in_doaj),
  };
}

const sourceMetricsCache = new Map<string, Promise<JournalMetrics | null>>();

async function fetchSourceMetrics(sourceKey: string): Promise<JournalMetrics | null> {
  const existing = sourceMetricsCache.get(sourceKey);
  if (existing) return existing;
  const task = (async () => {
    try {
      const full = await fetchJson<OpenAlexSourcePartial>(
        `https://api.openalex.org/sources/${sourceKey}?${encodeQuery({ mailto: CONTACT_EMAIL })}`,
        { cache: "no-store", timeoutMs: 4000 },
      );
      return metricsFromSource({ ...full, id: full.id || sourceKey });
    } catch {
      return null;
    }
  })();
  sourceMetricsCache.set(sourceKey, task);
  return task;
}

async function enrichFromOpenAlexWork(w: {
  cited_by_count?: number;
  display_name?: string | null;
  title?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  primary_location?: { source?: OpenAlexSourcePartial | null } | null;
}): Promise<{
  metrics: JournalMetrics | null;
  cited?: number;
  isOa?: boolean;
  oaUrl?: string | null;
  title?: string;
  abstract?: string;
}> {
  let metrics = metricsFromSource(w.primary_location?.source || null);
  const sourceKey = metrics?.sourceId || sourceKeyOf(w.primary_location?.source?.id);
  const needsFull =
    sourceKey &&
    (metrics?.meanCitedness2yr == null ||
      metrics?.hIndex == null ||
      !metrics?.issn ||
      !metrics?.publisher);

  if (sourceKey && needsFull) {
    const full = await fetchSourceMetrics(sourceKey);
    if (full) metrics = { ...metrics, ...full, sourceId: sourceKey };
  }

  const abstract = reconstructAbstract(w.abstract_inverted_index).replace(/\s+/g, " ").trim().slice(0, 2500);

  return {
    cited: w.cited_by_count,
    isOa: Boolean(w.open_access?.is_oa),
    oaUrl: w.open_access?.oa_url || null,
    metrics,
    title: w.display_name || w.title || undefined,
    abstract: abstract || undefined,
  };
}

export async function openAlexEnrichByDoi(doi: string): Promise<{
  metrics: JournalMetrics | null;
  cited?: number;
  isOa?: boolean;
  oaUrl?: string | null;
  title?: string;
  abstract?: string;
} | null> {
  const clean = stripDoi(doi);
  if (!clean) return null;
  try {
    const w = await fetchJson<{
      cited_by_count?: number;
      display_name?: string | null;
      title?: string | null;
      abstract_inverted_index?: Record<string, number[]> | null;
      open_access?: { is_oa?: boolean; oa_url?: string | null };
      primary_location?: { source?: OpenAlexSourcePartial | null } | null;
    }>(
      `https://api.openalex.org/works/doi:${encodeURIComponent(clean)}?${encodeQuery({
        mailto: CONTACT_EMAIL,
      })}`,
      { cache: "no-store", timeoutMs: 4500 },
    );
    return enrichFromOpenAlexWork(w);
  } catch {
    return null;
  }
}

export async function openAlexEnrichByPmid(pmid: string): Promise<{
  metrics: JournalMetrics | null;
  cited?: number;
  isOa?: boolean;
  oaUrl?: string | null;
  title?: string;
  abstract?: string;
} | null> {
  const clean = pmid.replace(/\D/g, "");
  if (!clean) return null;
  try {
    const w = await fetchJson<{
      cited_by_count?: number;
      display_name?: string | null;
      title?: string | null;
      abstract_inverted_index?: Record<string, number[]> | null;
      open_access?: { is_oa?: boolean; oa_url?: string | null };
      primary_location?: { source?: OpenAlexSourcePartial | null } | null;
    }>(
      `https://api.openalex.org/works/pmid:${encodeURIComponent(clean)}?${encodeQuery({
        mailto: CONTACT_EMAIL,
      })}`,
      { cache: "no-store", timeoutMs: 4500 },
    );
    return enrichFromOpenAlexWork(w);
  } catch {
    return null;
  }
}

export type PaperEnrichment = {
  journal?: JournalMetrics | null;
  oaPdfUrl?: string;
  oaLandingUrl?: string;
  europePmcUrl?: string;
  openAlexCited?: number;
  abstract?: string;
  title?: string;
};

/** Enrich a paper row with OpenAlex journal metrics + Unpaywall/EuropePMC OA links */
export async function enrichPaperLinks(input: {
  doi?: string | null;
  pmid?: string | null;
  needAbstract?: boolean;
}): Promise<PaperEnrichment> {
  const out: PaperEnrichment = {};
  const tasks: Promise<void>[] = [];

  if (input.doi) {
    tasks.push(
      openAlexEnrichByDoi(input.doi).then((r) => {
        if (!r) return;
        out.journal = r.metrics;
        if (typeof r.cited === "number") out.openAlexCited = r.cited;
        if (r.oaUrl) out.oaLandingUrl = r.oaUrl;
        if (r.abstract) out.abstract = r.abstract;
        if (r.title) out.title = r.title;
      }),
    );
    tasks.push(
      unpaywallLookup(input.doi).then((r) => {
        if (!r) return;
        if (r.pdfUrl) out.oaPdfUrl = r.pdfUrl;
        if (r.landingUrl && !out.oaLandingUrl) out.oaLandingUrl = r.landingUrl;
      }),
    );
  } else if (input.pmid) {
    tasks.push(
      openAlexEnrichByPmid(input.pmid).then((r) => {
        if (!r) return;
        out.journal = r.metrics;
        if (typeof r.cited === "number") out.openAlexCited = r.cited;
        if (r.oaUrl) out.oaLandingUrl = r.oaUrl;
        if (r.abstract) out.abstract = r.abstract;
        if (r.title) out.title = r.title;
      }),
    );
  }

  tasks.push(
    europePmcLookup({ doi: input.doi, pmid: input.pmid }).then((r) => {
      if (!r) return;
      if (r.pdfUrl && !out.oaPdfUrl) out.oaPdfUrl = r.pdfUrl;
      if (r.landingUrl && !out.oaLandingUrl) out.oaLandingUrl = r.landingUrl;
      if (r.europePmcUrl) out.europePmcUrl = r.europePmcUrl;
      if (r.abstractText && (!out.abstract || input.needAbstract)) out.abstract = r.abstractText;
      if (r.title && !out.title) out.title = r.title;
    }),
  );

  await Promise.allSettled(tasks);
  return out;
}

export function chictrSearchUrl(term: string) {
  return `https://www.chictr.org.cn/searchproj.html?title=${encodeURIComponent(term.trim())}`;
}

export function whoIctrpSearchUrl(term: string) {
  return `https://trialsearch.who.int/?Term=${encodeURIComponent(term.trim())}`;
}
