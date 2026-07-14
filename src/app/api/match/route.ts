import { NextRequest, NextResponse } from "next/server";
import {
  CONTACT_EMAIL,
  encodeQuery,
  fetchJson,
  pubmedAbstracts,
  pubmedSearchMeta,
  pubmedSummaries,
  reconstructAbstract,
  semanticScholarSearch,
} from "@/lib/http";
import { buildFormats, fromCrossrefAuthors, fromOpenAlexAuthors } from "@/lib/citeFormats";
import {
  mapLimit,
  normalizeText,
  textTokens,
  titleSimilarityScore,
  tokenF1,
} from "@/lib/textScore";

export type MatchSegment = { text: string; matched: boolean };

export type MatchEvidence = {
  titleScore: number;
  abstractScore: number;
  titleInBodyScore?: number;
  yearStatus: "exact" | "near" | "mismatch" | "none";
  doiHit: boolean;
  pmidHit: boolean;
  /** Query tokens found in the candidate title */
  matchedTitleTokens: string[];
  /** Query tokens missing from the candidate title */
  missedTitleTokens: string[];
  /** Candidate title highlighted against the query */
  titleSegments: MatchSegment[];
  /** Matched sentence highlighted against the candidate title */
  querySegments: MatchSegment[];
  /** Overlapping abstract sentences when abstract helps */
  abstractSnippets: string[];
  /** Short human-readable reasons for the list card */
  reasons: string[];
  /** Which input sentence(s) contributed to this hit */
  matchedSentences: string[];
};

export type MatchHit = {
  id: string;
  title: string;
  authors: string;
  year?: number;
  container?: string;
  doi?: string;
  pmid?: string;
  abstract?: string;
  type?: string;
  citedBy?: number;
  url?: string;
  score: number;
  scoreLabel: string;
  sources: string[];
  formats: { apa: string; gbt: string; bibtex: string };
  evidence: MatchEvidence;
};

const MAX_INPUT_CHARS = 6000;
const MAX_SENTENCES = 10;
/** Cap parallel sentence / id lookups so Vercel can finish under tight timeouts. */
const SEARCH_CONCURRENCY = 3;

function scoreLabel(score: number) {
  if (score >= 0.88) return "高度匹配";
  if (score >= 0.68) return "较可能";
  if (score >= 0.45) return "相关候选";
  return "弱相关";
}

function stripDoi(doi?: string | null) {
  if (!doi) return undefined;
  return doi.replace(/^https?:\/\/doi\.org\//i, "").trim() || undefined;
}

function extractAllDois(text: string): string[] {
  const re = /(?:doi[:\s]*)?(10\.\d{4,9}\/[^\s|;,，；\]>"']+)/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < MAX_SENTENCES) {
    const doi = m[1].replace(/[.)\]}>，；;]+$/g, "");
    const key = doi.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(doi);
  }
  return out;
}

function extractAllPmids(text: string): string[] {
  const re = /\bPMID[:\s]*([0-9]{5,9})\b/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < MAX_SENTENCES) {
    const pmid = m[1];
    if (seen.has(pmid)) continue;
    seen.add(pmid);
    out.push(pmid);
  }
  return out;
}

function extractYearHint(text: string) {
  const m = text.match(/\((\d{4})[a-z]?\)|\b((?:19|20)\d{2})\b/i);
  return m ? Number(m[1] || m[2]) : undefined;
}

/** True when the sentence is only DOI identifier(s) (already handled by top-level DOI lookup). */
function isDoiOnlySentence(sentence: string): boolean {
  const t = sentence.trim();
  if (!t) return false;
  const dois = extractAllDois(t);
  if (!dois.length) return false;
  let rest = t;
  for (const doi of dois) {
    const idx = rest.toLowerCase().indexOf(doi.toLowerCase());
    if (idx < 0) continue;
    rest = rest.slice(0, idx) + rest.slice(idx + doi.length);
  }
  rest = rest
    .replace(/https?:\/\/(?:dx\.)?doi\.org\//gi, "")
    .replace(/doi[:\s]*/gi, "")
    .replace(/[\s.;,|:：，；\[\]>"']+/g, "");
  return rest.length === 0;
}

/** True when the whole trimmed sentence is a PMID (already handled by top-level PMID lookup). */
function isPmidOnlySentence(sentence: string): boolean {
  return /^(?:PMID[:\s]*)?[0-9]{5,9}\.?$/i.test(sentence.trim());
}

/** Split pasted text into up to 10 sentences / lines for sequential matching. */
function splitIntoSentences(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const raw: string[] = [];
  const blocks = cleaned.split(/\n+/).map((b) => b.trim()).filter(Boolean);

  for (const block of blocks) {
    // Single short line → one unit (title / cite line)
    const multiStop = (block.match(/[.。!！?？]/g) || []).length >= 2;
    if (block.length <= 220 && !multiStop) {
      raw.push(block);
      continue;
    }
    const parts = block
      .split(/(?<=[.。!！?？])\s+|(?<=[。！？])/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8);
    if (parts.length) raw.push(...parts);
    else if (block.length >= 8) raw.push(block);
  }

  // If still one huge blob with no punctuation, chunk by ~180 chars on spaces
  if (raw.length === 1 && raw[0].length > 320) {
    const words = raw[0].split(/\s+/);
    const chunks: string[] = [];
    let buf = "";
    for (const w of words) {
      const next = buf ? `${buf} ${w}` : w;
      if (next.length > 180 && buf) {
        chunks.push(buf);
        buf = w;
      } else {
        buf = next;
      }
    }
    if (buf) chunks.push(buf);
    raw.length = 0;
    raw.push(...chunks);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    const clipped = s.replace(/\s+/g, " ").trim().slice(0, 500);
    const key = normalizeText(clipped).slice(0, 96);
    if (!key || key.length < 6) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clipped);
    if (out.length >= MAX_SENTENCES) break;
  }
  return out;
}

function sentenceSearchMode(sentence: string): "title" | "body" {
  // Short / title-like lines → title search; longer prose → bibliographic / full-text
  if (sentence.length <= 200 && (sentence.match(/[.。!！?？]/g) || []).length <= 1) {
    return "title";
  }
  return "body";
}

/** If user pasted a citation-like line, prefer the title-looking segment. */
function extractTitleish(text: string) {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/doi:\s*10\.\S+/gi, "")
    .replace(/10\.\d{4,9}\/\S+/gi, "")
    .replace(/\bPMID[:\s]*\d+/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // APA: Authors (Year). Title. Journal
  const apa = cleaned.match(/^(.+?)\s*\((\d{4})\)\.\s*(.+)$/);
  if (apa) {
    const after = apa[3].trim();
    const title = after.split(/\.\s+/)[0]?.trim();
    if (title && title.length > 12) return title.slice(0, 220);
  }

  // Vancouver: Authors. Title. Journal. year;
  const parts = cleaned.split(/[.。]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const candidate = parts.find(
      (p) =>
        p.length > 20 &&
        !/\bet\s+al\b/i.test(p) &&
        !/^[A-Z][a-z]+\s+[A-Z]{1,3}(\s*,|$)/.test(p) &&
        !/^(19|20)\d{2}/.test(p),
    );
    if (candidate) return candidate.slice(0, 220);
  }
  return cleaned.slice(0, 220);
}

type RawCandidate = {
  id: string;
  title: string;
  authors: string;
  authorList?: ReturnType<typeof fromCrossrefAuthors>;
  year?: number;
  container?: string;
  doi?: string;
  pmid?: string;
  abstract?: string;
  type?: string;
  citedBy?: number;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  sources: string[];
};

async function lookupByDoi(doi: string): Promise<RawCandidate[]> {
  const out: RawCandidate[] = [];
  try {
    const oa = await fetchJson<{
      id?: string;
      display_name?: string;
      doi?: string | null;
      publication_year?: number;
      type?: string;
      cited_by_count?: number;
      authorships?: Array<{ author?: { display_name?: string } }>;
      primary_location?: { source?: { display_name?: string | null } | null; landing_page_url?: string | null };
      abstract_inverted_index?: Record<string, number[]> | null;
      ids?: { pmid?: string | null };
      biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null };
    }>(
      `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?${encodeQuery({ mailto: CONTACT_EMAIL })}`,
      { cache: "no-store", timeoutMs: 7000 },
    );
    if (oa?.display_name) {
      const authorList = fromOpenAlexAuthors(oa.authorships);
      const pages =
        oa.biblio?.first_page && oa.biblio?.last_page
          ? `${oa.biblio.first_page}-${oa.biblio.last_page}`
          : oa.biblio?.first_page || undefined;
      out.push({
        id: oa.id || `oa-doi:${doi}`,
        title: oa.display_name,
        authors:
          authorList
            .map((a) => (a.family ? `${a.given ? `${a.given} ` : ""}${a.family}` : a.name || ""))
            .filter(Boolean)
            .slice(0, 6)
            .join(", ") || "—",
        authorList,
        year: oa.publication_year,
        container: oa.primary_location?.source?.display_name || undefined,
        doi: stripDoi(oa.doi) || doi,
        pmid: oa.ids?.pmid
          ? String(oa.ids.pmid).replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, "").replace(/\D/g, "")
          : undefined,
        abstract: reconstructAbstract(oa.abstract_inverted_index).replace(/\s+/g, " ").trim().slice(0, 900) || undefined,
        type: oa.type,
        citedBy: oa.cited_by_count,
        volume: oa.biblio?.volume || undefined,
        issue: oa.biblio?.issue || undefined,
        pages,
        url: `https://doi.org/${stripDoi(oa.doi) || doi}`,
        sources: ["文献库"],
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const cr = await fetchJson<{
      status?: string;
      message?: {
        DOI?: string;
        title?: string[];
        author?: Array<{ family?: string; given?: string; name?: string }>;
        "container-title"?: string[];
        issued?: { "date-parts"?: number[][] };
        abstract?: string;
        volume?: string;
        issue?: string;
        page?: string;
        "is-referenced-by-count"?: number;
        type?: string;
      };
    }>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { cache: "no-store", timeoutMs: 7000 });
    const m = cr.message;
    if (m?.title?.[0]) {
      const authorList = fromCrossrefAuthors(m.author);
      out.push({
        id: `cr-doi:${doi}`,
        title: m.title[0],
        authors:
          authorList
            .map((a) => (a.family ? `${a.family}${a.given ? ` ${a.given}` : ""}` : a.name || ""))
            .filter(Boolean)
            .slice(0, 6)
            .join(", ") || "—",
        authorList,
        year: m.issued?.["date-parts"]?.[0]?.[0],
        container: m["container-title"]?.[0],
        doi: stripDoi(m.DOI) || doi,
        abstract: m.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 900),
        type: m.type,
        citedBy: m["is-referenced-by-count"],
        volume: m.volume,
        issue: m.issue,
        pages: m.page,
        url: `https://doi.org/${stripDoi(m.DOI) || doi}`,
        sources: ["登记库"],
      });
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function searchOpenAlex(q: string, mode: "title" | "body"): Promise<RawCandidate[]> {
  try {
    const params: Record<string, string | number> = {
      per_page: 10,
      mailto: CONTACT_EMAIL,
    };
    // Title mode: prefer title.search filter for precision; body uses full-text search
    if (mode === "title") {
      const safeTitle = q.replace(/[|:<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      params.filter = `title.search:${safeTitle}`;
    } else {
      params.search = q.slice(0, 220);
    }

    const data = await fetchJson<{
      results?: Array<{
        id?: string;
        display_name?: string;
        doi?: string | null;
        publication_year?: number;
        type?: string;
        cited_by_count?: number;
        authorships?: Array<{ author?: { display_name?: string } }>;
        primary_location?: { source?: { display_name?: string | null } | null; landing_page_url?: string | null };
        abstract_inverted_index?: Record<string, number[]> | null;
        ids?: { pmid?: string | null };
        biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null };
      }>;
    }>(`https://api.openalex.org/works?${encodeQuery(params)}`, {
      cache: "no-store",
      timeoutMs: 9000,
    });

    // Fallback: if title.filter returned nothing, try broad search
    let results = data.results || [];
    if (!results.length && mode === "title") {
      const fallback = await fetchJson<{ results?: typeof results }>(
        `https://api.openalex.org/works?${encodeQuery({
          search: q.slice(0, 180),
          per_page: 10,
          mailto: CONTACT_EMAIL,
        })}`,
        { cache: "no-store", timeoutMs: 9000 },
      );
      results = fallback.results || [];
    }

    return results
      .map((hit) => {
        const title = hit.display_name || "";
        if (!title) return null;
        const authorList = fromOpenAlexAuthors(hit.authorships);
        const authors =
          authorList
            .map((a) => (a.family ? `${a.given ? `${a.given} ` : ""}${a.family}` : a.name || ""))
            .filter(Boolean)
            .slice(0, 6)
            .join(", ") || "—";
        const abstract = reconstructAbstract(hit.abstract_inverted_index).replace(/\s+/g, " ").trim().slice(0, 900);
        const pmidRaw = hit.ids?.pmid;
        const pmid = pmidRaw
          ? String(pmidRaw).replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, "").replace(/\D/g, "")
          : undefined;
        const doi = stripDoi(hit.doi);
        const pages =
          hit.biblio?.first_page && hit.biblio?.last_page
            ? `${hit.biblio.first_page}-${hit.biblio.last_page}`
            : hit.biblio?.first_page || undefined;
        return {
          id: hit.id || `oa:${title.slice(0, 40)}`,
          title,
          authors,
          authorList,
          year: hit.publication_year,
          container: hit.primary_location?.source?.display_name || undefined,
          doi,
          pmid: pmid || undefined,
          abstract: abstract || undefined,
          type: hit.type,
          citedBy: hit.cited_by_count,
          volume: hit.biblio?.volume || undefined,
          issue: hit.biblio?.issue || undefined,
          pages,
          url: doi ? `https://doi.org/${doi}` : hit.primary_location?.landing_page_url || undefined,
          sources: ["文献库"],
        } satisfies RawCandidate;
      })
      .filter(Boolean) as RawCandidate[];
  } catch {
    return [];
  }
}

async function searchCrossref(q: string, mode: "title" | "body"): Promise<RawCandidate[]> {
  try {
    const params: Record<string, string | number> =
      mode === "title"
        ? { "query.title": q.slice(0, 200), rows: 8 }
        : { "query.bibliographic": q.slice(0, 220), rows: 8 };

    const data = await fetchJson<{
      message?: {
        items?: Array<{
          DOI?: string;
          title?: string[];
          author?: Array<{ family?: string; given?: string; name?: string }>;
          "container-title"?: string[];
          issued?: { "date-parts"?: number[][] };
          abstract?: string;
          PMID?: string;
          volume?: string;
          issue?: string;
          page?: string;
          "is-referenced-by-count"?: number;
          type?: string;
          score?: number;
        }>;
      };
    }>(`https://api.crossref.org/works?${encodeQuery(params)}`, {
      cache: "no-store",
      timeoutMs: 9000,
    });

    return (data.message?.items || [])
      .map((item) => {
        const title = item.title?.[0] || "";
        if (!title) return null;
        const authorList = fromCrossrefAuthors(item.author);
        const authors =
          authorList
            .map((a) => (a.family ? `${a.family}${a.given ? ` ${a.given}` : ""}` : a.name || ""))
            .filter(Boolean)
            .slice(0, 6)
            .join(", ") || "—";
        const doi = stripDoi(item.DOI);
        return {
          id: item.DOI ? `cr:${item.DOI}` : `cr:${title.slice(0, 40)}`,
          title,
          authors,
          authorList,
          year: item.issued?.["date-parts"]?.[0]?.[0],
          container: item["container-title"]?.[0],
          doi,
          pmid: item.PMID,
          abstract: (item.abstract || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 900) || undefined,
          type: item.type,
          citedBy: item["is-referenced-by-count"],
          volume: item.volume,
          issue: item.issue,
          pages: item.page,
          url: doi ? `https://doi.org/${doi}` : undefined,
          sources: ["登记库"],
        } satisfies RawCandidate;
      })
      .filter(Boolean) as RawCandidate[];
  } catch {
    return [];
  }
}

async function searchSemanticScholar(q: string): Promise<RawCandidate[]> {
  try {
    const data = await semanticScholarSearch({
      query: q.slice(0, 300),
      limit: 8,
      fieldsOfStudy: "Medicine,Biology",
    });
    return (data.data || [])
      .map((p) => {
        const title = (p.title || "").trim();
        if (!title) return null;
        const authorList = (p.authors || [])
          .map((a) => a.name)
          .filter(Boolean)
          .map((display) => {
            const parts = String(display).split(/\s+/).filter(Boolean);
            if (parts.length === 1) return { family: parts[0] };
            return { given: parts.slice(0, -1).join(" "), family: parts[parts.length - 1] };
          });
        const authors =
          authorList
            .map((a) => (a.family ? `${a.family}${a.given ? ` ${a.given}` : ""}` : ""))
            .filter(Boolean)
            .slice(0, 6)
            .join(", ") || "—";
        const doi = stripDoi(p.externalIds?.DOI);
        const pmid = p.externalIds?.PubMed ? String(p.externalIds.PubMed).replace(/\D/g, "") : undefined;
        return {
          id: `s2:${p.paperId}`,
          title,
          authors,
          authorList,
          year: p.year || undefined,
          container: p.venue || undefined,
          doi,
          pmid: pmid || undefined,
          abstract: (p.abstract || p.tldr?.text || undefined)?.slice(0, 900),
          type: p.publicationTypes?.[0],
          citedBy: p.citationCount || undefined,
          url: doi ? `https://doi.org/${doi}` : p.url || undefined,
          sources: ["语义索引"],
        } satisfies RawCandidate;
      })
      .filter(Boolean) as RawCandidate[];
  } catch {
    return [];
  }
}

async function searchPubMed(q: string, mode: "title" | "body"): Promise<RawCandidate[]> {
  try {
    const term = mode === "title" ? `${q.slice(0, 200)}[Title]` : q.slice(0, 220);
    let ids = (await pubmedSearchMeta(term, 8)).ids;
    if (!ids.length && mode === "title") {
      ids = (await pubmedSearchMeta(q.slice(0, 200), 8)).ids;
    }
    if (!ids.length) return [];
    const [summaries, absMap] = await Promise.all([pubmedSummaries(ids), pubmedAbstracts(ids)]);
    return summaries
      .map((s) => {
        const title = (s.title || "").replace(/\s*\[.*?\]\s*$/, "").trim();
        if (!title) return null;
        const doi = stripDoi(s.doi);
        const yearMatch = s.pubdate?.match(/\b((?:19|20)\d{2})\b/);
        const authorList = (s.authors || "")
          .split(/,\s*/)
          .filter(Boolean)
          .map((name) => {
            const parts = name.trim().split(/\s+/);
            if (parts.length === 1) return { family: parts[0] };
            return { family: parts[0], given: parts.slice(1).join(" ") };
          });
        return {
          id: `pmid:${s.pmid}`,
          title,
          authors: s.authors || "—",
          authorList,
          year: yearMatch ? Number(yearMatch[1]) : undefined,
          container: s.source || undefined,
          doi,
          pmid: s.pmid,
          abstract: absMap[s.pmid]?.slice(0, 900),
          type: "journal-article",
          url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`,
          sources: ["医学库"],
        } satisfies RawCandidate;
      })
      .filter(Boolean) as RawCandidate[];
  } catch {
    return [];
  }
}

async function searchEuropePmc(q: string): Promise<RawCandidate[]> {
  try {
    const data = await fetchJson<{
      resultList?: {
        result?: Array<{
          id?: string;
          pmid?: string;
          doi?: string;
          title?: string;
          authorString?: string;
          journalTitle?: string;
          pubYear?: string;
          abstractText?: string;
          citedByCount?: number;
        }>;
      };
    }>(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${encodeQuery({
        query: q.slice(0, 250),
        format: "json",
        pageSize: 8,
        resultType: "core",
      })}`,
      { cache: "no-store", timeoutMs: 9000 },
    );

    return (data.resultList?.result || [])
      .map((r) => {
        const title = (r.title || "").replace(/<[^>]+>/g, "").trim();
        if (!title) return null;
        const doi = stripDoi(r.doi);
        const pmid = r.pmid ? String(r.pmid).replace(/\D/g, "") : undefined;
        // Europe PMC authorString is PubMed-like: "Family Given" / "Smith J"
        const authorList = (r.authorString || "")
          .split(/,\s*/)
          .filter(Boolean)
          .slice(0, 8)
          .map((name) => {
            const parts = name.trim().split(/\s+/);
            if (parts.length === 1) return { family: parts[0] };
            return { family: parts[0], given: parts.slice(1).join(" ") };
          });
        return {
          id: pmid ? `epmc:${pmid}` : `epmc:${doi || title.slice(0, 40)}`,
          title,
          authors: r.authorString || "—",
          authorList,
          year: r.pubYear ? Number(r.pubYear) : undefined,
          container: r.journalTitle || undefined,
          doi,
          pmid,
          abstract: r.abstractText?.replace(/\s+/g, " ").trim().slice(0, 900),
          citedBy: r.citedByCount,
          url: doi
            ? `https://doi.org/${doi}`
            : pmid
              ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
              : undefined,
          sources: ["欧洲库"],
        } satisfies RawCandidate;
      })
      .filter(Boolean) as RawCandidate[];
  } catch {
    return [];
  }
}

async function searchAllSources(phrase: string, mode: "title" | "body"): Promise<RawCandidate[]> {
  const [oa, cr, s2, pm, epmc] = await Promise.all([
    searchOpenAlex(phrase, mode),
    searchCrossref(phrase, mode),
    searchSemanticScholar(phrase),
    searchPubMed(phrase, mode),
    searchEuropePmc(mode === "title" ? `TITLE:"${phrase.slice(0, 160).replace(/"/g, "")}"` : phrase),
  ]);
  return mergeCandidates([...oa, ...cr, ...s2, ...pm, ...epmc]);
}

function mergeCandidates(list: RawCandidate[]) {
  const byKey = new Map<string, RawCandidate>();
  for (const c of list) {
    const key = (c.doi || normalizeText(c.title)).toLowerCase();
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...c });
      continue;
    }
    const sources = Array.from(new Set([...prev.sources, ...c.sources]));
    byKey.set(key, {
      ...prev,
      authors: prev.authors !== "—" ? prev.authors : c.authors,
      authorList: prev.authorList?.length ? prev.authorList : c.authorList,
      year: prev.year || c.year,
      container: prev.container || c.container,
      doi: prev.doi || c.doi,
      pmid: prev.pmid || c.pmid,
      abstract: prev.abstract || c.abstract,
      type: prev.type || c.type,
      citedBy: Math.max(prev.citedBy || 0, c.citedBy || 0) || prev.citedBy || c.citedBy,
      volume: prev.volume || c.volume,
      issue: prev.issue || c.issue,
      pages: prev.pages || c.pages,
      url: prev.url || c.url,
      sources,
    });
  }
  return Array.from(byKey.values());
}

function titleCoverageInText(title?: string, text?: string) {
  const wa = textTokens(title, 2);
  const setB = new Set(textTokens(text, 2));
  if (!wa.length || !setB.size) return 0;
  return wa.filter((w) => setB.has(w)).length / wa.length;
}

/** Split text into segments; mark pieces whose normalized tokens appear in `matchSet`. */
function highlightSegments(text: string, matchSet: Set<string>): MatchSegment[] {
  if (!text) return [];
  const parts = text.split(/([^A-Za-z0-9\u4e00-\u9fff]+)/);
  const out: MatchSegment[] = [];
  for (const part of parts) {
    if (!part) continue;
    const isSep = /^[^A-Za-z0-9\u4e00-\u9fff]+$/.test(part);
    if (isSep) {
      out.push({ text: part, matched: false });
      continue;
    }
    const key = normalizeText(part);
    // matchSet is built from textTokens (already stopword-filtered)
    const matched = key.length >= 2 && matchSet.has(key);
    out.push({ text: part, matched });
  }
  // Merge adjacent same-matched pieces for cleaner rendering
  const merged: MatchSegment[] = [];
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && last.matched === seg.matched) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}

function abstractOverlapSnippets(query: string, abstract?: string, limit = 3): string[] {
  if (!abstract) return [];
  const qSet = new Set(textTokens(query, 3));
  if (!qSet.size) return [];
  const sentences = abstract
    .split(/(?<=[.。!！?？;；])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  const ranked = sentences
    .map((s) => {
      const st = textTokens(s, 3);
      const hit = st.filter((w) => qSet.has(w)).length;
      return { s, hit, dens: st.length ? hit / st.length : 0 };
    })
    .filter((x) => x.hit >= 2 || x.dens >= 0.25)
    .sort((a, b) => b.hit - a.hit || b.dens - a.dens)
    .slice(0, limit)
    .map((x) => (x.s.length > 180 ? `${x.s.slice(0, 180)}…` : x.s));
  return ranked;
}

function buildEvidence(
  query: string,
  mode: "title" | "body",
  c: RawCandidate,
  scores: { titleScore: number; abstractScore: number; titleInBody: number },
  opts?: {
    yearHint?: number;
    doiHit?: boolean;
    pmidHint?: string | null;
    matchedSentences?: string[];
  },
): MatchEvidence {
  const qToks = textTokens(query);
  const titleToks = textTokens(c.title);
  const titleSet = new Set(titleToks);
  const qSet = new Set(qToks);

  const matchedTitleTokens = Array.from(new Set(qToks.filter((t) => titleSet.has(t)))).slice(0, 24);
  const missedTitleTokens = Array.from(new Set(qToks.filter((t) => !titleSet.has(t)))).slice(0, 16);

  let yearStatus: MatchEvidence["yearStatus"] = "none";
  if (opts?.yearHint && c.year) {
    const gap = Math.abs(opts.yearHint - c.year);
    yearStatus = gap === 0 ? "exact" : gap <= 2 ? "near" : "mismatch";
  }

  const doiHit = Boolean(opts?.doiHit && c.doi);
  const pmidHit = Boolean(opts?.pmidHint && c.pmid && opts.pmidHint === c.pmid);
  const matchedSentences = (opts?.matchedSentences || []).filter(Boolean).slice(0, 3);

  const reasons: string[] = [];
  if (doiHit) reasons.push("DOI 直达");
  if (pmidHit) reasons.push("PMID 一致");
  if (scores.titleScore >= 0.9) reasons.push(`标题 ${Math.round(scores.titleScore * 100)}%`);
  else if (scores.titleScore >= 0.45) reasons.push(`标题 ${Math.round(scores.titleScore * 100)}%`);
  if (mode === "body" && scores.titleInBody >= 0.35) {
    reasons.push(`标题词覆盖 ${Math.round(scores.titleInBody * 100)}%`);
  }
  if (scores.abstractScore >= 0.2) reasons.push(`摘要重叠 ${Math.round(scores.abstractScore * 100)}%`);
  if (yearStatus === "exact") reasons.push("年份一致");
  else if (yearStatus === "near") reasons.push("年份接近");
  else if (yearStatus === "mismatch") reasons.push("年份不符");
  if (matchedSentences.length === 1) reasons.push("命中 1 句");
  else if (matchedSentences.length > 1) reasons.push(`命中 ${matchedSentences.length} 句`);
  if (!reasons.length) reasons.push("弱词重叠");

  const titleSegments = highlightSegments(c.title, qSet);
  const queryForHighlight = query.slice(0, 280);
  const querySegments = highlightSegments(queryForHighlight, titleSet);

  return {
    titleScore: Math.round(scores.titleScore * 100) / 100,
    abstractScore: Math.round(scores.abstractScore * 100) / 100,
    titleInBodyScore: mode === "body" ? Math.round(scores.titleInBody * 100) / 100 : undefined,
    yearStatus,
    doiHit,
    pmidHit,
    matchedTitleTokens,
    missedTitleTokens: mode === "title" ? missedTitleTokens : [],
    titleSegments,
    querySegments,
    abstractSnippets: abstractOverlapSnippets(query, c.abstract),
    reasons,
    matchedSentences,
  };
}

function rankCandidates(
  query: string,
  mode: "title" | "body",
  candidates: RawCandidate[],
  opts?: {
    yearHint?: number;
    doiHit?: boolean;
    pmidHint?: string | null;
    matchedSentences?: string[];
  },
): MatchHit[] {
  const yearHint = opts?.yearHint;
  const scored = candidates.map((c) => {
    const titleScore = titleSimilarityScore(query, c.title);
    const absScore = c.abstract ? tokenF1(query, c.abstract) : 0;
    const titleInBody = mode === "body" ? titleCoverageInText(c.title, query) : 0;

    let score =
      mode === "title"
        ? titleScore * 0.88 + absScore * 0.08
        : titleInBody * 0.5 + absScore * 0.4 + titleScore * 0.15;

    // Exact / near-exact title boost
    if (titleScore >= 0.97) score = Math.max(score, 0.98);
    else if (titleScore >= 0.9) score = Math.max(score, titleScore * 0.96 + absScore * 0.04);

    // Body: solid abstract overlap or title words densely present in pasted text
    if (mode === "body") {
      if (absScore >= 0.3) score = Math.max(score, absScore * 0.85 + titleInBody * 0.2);
      if (titleInBody >= 0.7) score = Math.max(score, titleInBody * 0.82);
    }

    // Year consistency (soft)
    if (yearHint && c.year) {
      const gap = Math.abs(yearHint - c.year);
      if (gap === 0) score = Math.min(1, score + 0.03);
      else if (gap > 2) score *= 0.85;
    }

    // Multi-source agreement slight boost
    if (c.sources.length > 1) score = Math.min(1, score + 0.02);

    // DOI direct hit
    if (opts?.doiHit && c.doi) score = Math.max(score, 0.99);

    // Tie-break: lightly prefer higher cited (does not dominate relevance)
    const citeBoost = Math.min(0.02, Math.log10((c.citedBy || 0) + 1) / 200);
    score = Math.min(1, score + citeBoost);

    const evidence = buildEvidence(
      query,
      mode,
      c,
      { titleScore, abstractScore: absScore, titleInBody },
      opts,
    );

    return { c, score, evidence };
  });

  const minScore = mode === "title" ? 0.42 : 0.22;
  return scored
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score || (b.c.citedBy || 0) - (a.c.citedBy || 0))
    .slice(0, 8)
    .map(({ c, score, evidence }) => ({
      id: c.id,
      title: c.title,
      authors: c.authors,
      year: c.year,
      container: c.container,
      doi: c.doi,
      pmid: c.pmid,
      abstract: c.abstract,
      type: c.type,
      citedBy: c.citedBy,
      url: c.url || (c.doi ? `https://doi.org/${c.doi}` : undefined),
      score: Math.round(score * 100) / 100,
      scoreLabel: scoreLabel(score),
      sources: c.sources,
      formats: buildFormats({
        authors: c.authorList?.length ? c.authorList : c.authors,
        title: c.title,
        container: c.container,
        year: c.year,
        doi: c.doi,
        volume: c.volume,
        issue: c.issue,
        pages: c.pages,
        type: c.type,
      }),
      evidence,
    }));
}

function hitKey(h: MatchHit) {
  return (h.doi || normalizeText(h.title)).toLowerCase();
}

function mergeHits(list: MatchHit[]): MatchHit[] {
  const byKey = new Map<string, MatchHit>();
  for (const h of list) {
    const key = hitKey(h);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, h);
      continue;
    }
    const better = h.score >= prev.score ? h : prev;
    const weaker = h.score >= prev.score ? prev : h;
    const sentences = Array.from(
      new Set([...(better.evidence.matchedSentences || []), ...(weaker.evidence.matchedSentences || [])]),
    ).slice(0, 4);
    const reasons = Array.from(new Set([...(better.evidence.reasons || []), ...(weaker.evidence.reasons || [])])).slice(
      0,
      8,
    );
    byKey.set(key, {
      ...better,
      sources: Array.from(new Set([...better.sources, ...weaker.sources])),
      abstract: better.abstract || weaker.abstract,
      pmid: better.pmid || weaker.pmid,
      evidence: {
        ...better.evidence,
        matchedSentences: sentences,
        reasons,
        abstractSnippets:
          better.evidence.abstractSnippets.length >= weaker.evidence.abstractSnippets.length
            ? better.evidence.abstractSnippets
            : weaker.evidence.abstractSnippets,
      },
    });
  }
  return Array.from(byKey.values()).sort((a, b) => b.score - a.score || (b.citedBy || 0) - (a.citedBy || 0));
}

type SentenceMatchResult = {
  index: number;
  hits: MatchHit[];
  /** True when every upstream returned no candidates for this sentence. */
  sourcesEmpty: boolean;
};

async function matchOneSentence(
  sentence: string,
  index: number,
  opts: { pmidHint?: string | null },
): Promise<SentenceMatchResult> {
  const mode = sentenceSearchMode(sentence);
  const phrase = mode === "title" ? extractTitleish(sentence) : sentence.slice(0, 320);
  const yearHint = extractYearHint(sentence);
  let merged = await searchAllSources(phrase, mode);

  // Body: compact keyword query catches long sentences that dilute ranking
  if (mode === "body") {
    const keyQ = textTokens(sentence, 3).slice(0, 14).join(" ");
    if (keyQ.length > 24) {
      const [oa2, s2, pm] = await Promise.all([
        searchOpenAlex(keyQ, "body"),
        searchSemanticScholar(keyQ),
        searchPubMed(keyQ, "body"),
      ]);
      merged = mergeCandidates([...merged, ...oa2, ...s2, ...pm]);
    }
  }

  const sourcesEmpty = merged.length === 0;
  const label = `句${index + 1}`;
  const ranked = rankCandidates(mode === "title" ? phrase : sentence.slice(0, 500), mode, merged, {
    yearHint,
    pmidHint: opts.pmidHint,
    matchedSentences: [`${label}：${sentence.slice(0, 120)}${sentence.length > 120 ? "…" : ""}`],
  });
  return { index, hits: ranked, sourcesEmpty };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { text?: string };
    let text = (body.text || "").trim();
    if (text.length < 8) {
      return NextResponse.json({ error: "请输入标题或一段正文内容" }, { status: 400 });
    }

    const truncated = text.length > MAX_INPUT_CHARS;
    if (truncated) text = text.slice(0, MAX_INPUT_CHARS);

    const pmids = extractAllPmids(text);
    const pmidHint = pmids[0] || null;
    const dois = extractAllDois(text);
    const sentences = splitIntoSentences(text);
    const allHits: MatchHit[] = [];

    // DOI → direct resolve (capped concurrency)
    if (dois.length) {
      const doiBatches = await mapLimit(dois.slice(0, MAX_SENTENCES), SEARCH_CONCURRENCY, async (doi) => {
        const direct = await lookupByDoi(doi);
        if (!direct.length) return [] as MatchHit[];
        return rankCandidates(direct[0]?.title || doi, "title", mergeCandidates(direct), {
          yearHint: extractYearHint(text),
          doiHit: true,
          pmidHint,
          matchedSentences: [`DOI：${doi}`],
        });
      });
      for (const batch of doiBatches) allHits.push(...batch);
    }

    // PMID → PubMed resolve for every extracted id
    if (pmids.length) {
      const pmidBatches = await mapLimit(pmids.slice(0, MAX_SENTENCES), SEARCH_CONCURRENCY, async (pmid) => {
        const pmHits = await searchPubMed(`${pmid}[pmid]`, "body");
        if (!pmHits.length) return [] as MatchHit[];
        return rankCandidates(pmHits[0].title, "title", mergeCandidates(pmHits), {
          yearHint: extractYearHint(text),
          pmidHint: pmid,
          matchedSentences: [`PMID：${pmid}`],
        });
      });
      for (const batch of pmidBatches) allHits.push(...batch);
    }

    // Sentence search: skip DOI-only / PMID-only lines (already resolved above)
    const searchable = sentences
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => !isDoiOnlySentence(s) && !isPmidOnlySentence(s));

    const sentenceBatches =
      searchable.length > 0
        ? await mapLimit(searchable, SEARCH_CONCURRENCY, ({ s, index }) =>
            matchOneSentence(s, index, { pmidHint }),
          )
        : [];

    for (const batch of sentenceBatches) allHits.push(...batch.hits);

    const results = mergeHits(allHits).slice(0, 12);
    const finalKeys = new Set(results.map(hitKey));
    const byIndex = new Map(sentenceBatches.map((b) => [b.index, b]));

    // hitCount from per-sentence ranked length (before global trim);
    // bestHitId prefers that sentence's top hit that survives merge.
    const sentenceReports = sentences.map((s, index) => {
      const batch = byIndex.get(index);
      const perHits = batch?.hits || [];
      const surviving = perHits.filter((h) => finalKeys.has(hitKey(h)));
      const best = surviving[0] || null;
      return {
        index,
        text: s,
        hitCount: perHits.length,
        bestScore: best?.score ?? 0,
        bestHitId: best?.id || null,
        hitIds: surviving.map((h) => h.id),
      };
    });

    const sourcesFailed =
      searchable.length > 0 && sentenceBatches.length > 0 && sentenceBatches.every((b) => b.sourcesEmpty);
    const warning = sourcesFailed
      ? "所有文献检索源均未返回结果，请稍后重试或调整检索内容"
      : undefined;

    return NextResponse.json({
      results,
      sentences,
      sentenceReports,
      sentenceCount: sentences.length,
      maxSentences: MAX_SENTENCES,
      truncated,
      maxChars: MAX_INPUT_CHARS,
      phrase: sentences[0] || dois[0] || text.slice(0, 120),
      pmid: pmidHint || undefined,
      pmids: pmids.length ? pmids : undefined,
      total: results.length,
      empty: !results.length,
      ...(sourcesFailed ? { sourcesFailed: true, warning } : {}),
    });
  } catch {
    return NextResponse.json({ error: "匹配失败，请稍后重试" }, { status: 500 });
  }
}
