import { NextRequest, NextResponse } from "next/server";
import { encodeQuery, fetchJson, CONTACT_EMAIL, reconstructAbstract, stripDoi } from "@/lib/http";
import {
  buildFormats,
  fromCrossrefAuthors,
  fromOpenAlexAuthors,
  type CiteAuthor,
} from "@/lib/citeFormats";
import { normalizeText, titleSimilarityScore as titleSimilarityScoreBase } from "@/lib/textScore";

export type CiteStatus = "ok" | "review" | "risk" | "insufficient";

export type FieldDiff = {
  field: "doi" | "first_author" | "year" | "title" | "container" | "volume" | "issue" | "pages" | "pmid";
  label: string;
  cited: string;
  resolved: string;
  matchScore?: number;
};

const EMPTY_FORMATS = { apa: "", gbt: "", bibtex: "" } as const;

function titleSimilarityScore(a?: string, b?: string) {
  return titleSimilarityScoreBase(a, b, { strict: true });
}

function normalize(s?: string) {
  return normalizeText(s);
}

/** Library hit shown inline for verification (no external jump required). */
export type SourceRecord = {
  title?: string;
  authors?: string;
  authorList?: CiteAuthor[];
  firstAuthor?: string;
  year?: string | number;
  container?: string;
  doi?: string;
  pmid?: string;
  abstract?: string;
  type?: string;
  citedBy?: number;
  volume?: string | number;
  issue?: string | number;
  pages?: string;
  url?: string;
  sources: string[];
  matchScore?: number;
};

export type CiteResult = {
  index: number;
  raw: string;
  status: CiteStatus;
  message: string;
  title?: string;
  firstAuthor?: string;
  doi?: string;
  year?: string | number;
  container?: string;
  sources: string[];
  driftFields: string[];
  fieldDiffs: FieldDiff[];
  links: { label: string; url: string }[];
  record?: SourceRecord | null;
  formats: {
    apa: string;
    gbt: string;
    bibtex: string;
  };
};

function splitReferences(text: string) {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const isNoise = (line: string) =>
    /^(参考文献|总结报告|结果列表|标准格式|共核查|高频偏差|命中数据|建议优先|本模式|粘贴参考|填入示例)/.test(line) ||
    line.length < 8;

  const stripMarker = (line: string) =>
    line
      .replace(/^\[\s*\d+\s*\]\s*/, "")
      .replace(/^[（(]\s*\d+\s*[）)]\s*/, "")
      .replace(/^\d+[\.、．\)]\s+/, "")
      .trim();

  const isLikelyRef = (s: string) => {
    // Reject pure noise (digits/symbols only)
    if (!/[A-Za-z\u4e00-\u9fff]/.test(s)) return false;
    if (/10\.\d{4,9}\//.test(s)) return true;
    if (/\bPMID[:\s]*[0-9]{5,9}\b/i.test(s)) return true;
    // Cross-tool title seeds / short title-only pastes
    if (s.length >= 12) return true;
    if (/\b(19|20)\d{2}\b/.test(s) && s.length > 28) return true;
    return /[.。]/.test(s) && s.length > 45;
  };

  const startsNewRef = (line: string) =>
    /^\[\s*\d+\s*\]/.test(line) ||
    /^[（(]\s*\d+\s*[）)]/.test(line) ||
    /^\d{1,3}[\.、．\)]\s+\S/.test(line);

  // 1) Explicit [1] [2] markers → split by marker
  // NOTE: do NOT treat volume(issue) like 42(2) as a reference marker.
  if (/\[\s*\d+\s*\]/.test(cleaned)) {
    return cleaned
      .split(/(?=\[\s*\d+\s*\])/)
      .map((p) => stripMarker(p.replace(/\s+/g, " ").trim()))
      .filter((p) => !isNoise(p) && isLikelyRef(p))
      .slice(0, 15);
  }

  // Parenthesis markers only when they start a line / the blob (avoid 42(2) page locators)
  if (/(^|\n)\s*[（(]\s*\d{1,3}\s*[）)]\s+\S/.test(cleaned)) {
    return cleaned
      .split(/(?=(?:^|\n)\s*[（(]\s*\d{1,3}\s*[）)])/)
      .map((p) => stripMarker(p.replace(/\s+/g, " ").trim()))
      .filter((p) => !isNoise(p) && isLikelyRef(p))
      .slice(0, 15);
  }

  // 2) Line-wise: only start a new item when line begins with 1. / 2. etc; otherwise merge wraps
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !isNoise(l));

  if (!lines.length) return [];

  const numbered = lines.filter((l) => startsNewRef(l)).length >= 2;
  if (numbered || lines.length === 1) {
    const refs: string[] = [];
    for (const line of lines) {
      if (startsNewRef(line) || !refs.length) {
        refs.push(stripMarker(line));
      } else {
        refs[refs.length - 1] = `${refs[refs.length - 1]} ${line}`.trim();
      }
    }
    return refs.filter(isLikelyRef).slice(0, 15);
  }

  // 3) Paragraphs separated by blank lines
  if (/\n\s*\n/.test(cleaned)) {
    return cleaned
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => !isNoise(p) && isLikelyRef(p))
      .slice(0, 15);
  }

  // 4) Fallback: treat whole blob as one reference (avoid chopping soft-wrapped lines)
  const one = cleaned.replace(/\s+/g, " ").trim();
  return isLikelyRef(one) ? [one] : [];
}

function stripRefPrefix(text: string) {
  return text
    .replace(/^\[\s*\d+\s*\]\s*/, "")
    .replace(/^[（(]\s*\d+\s*[）)]\s*/, "")
    .replace(/^\d+[\.、．\)]\s*/, "")
    .trim();
}

function extractDoi(text: string) {
  const m = text.match(/(?:doi[:\s]*)?(10\.\d{4,9}\/[^\s|;,，；\]>]+)/i);
  if (!m) return null;
  return m[1].replace(/[.)\]}>，；;]+$/g, "");
}

function extractPmid(text: string) {
  const m = text.match(/\bPMID[:\s]*([0-9]{5,9})\b/i);
  return m ? m[1] : null;
}

function extractYear(text: string) {
  const m = text.match(/\((\d{4}[a-z]?)\)|\b((?:19|20)\d{2})\b/i);
  return m ? m[1] || m[2] : null;
}

/** Pull journal / volume / issue / pages from the cited raw string. */
function extractBiblioHints(text: string) {
  const cleaned = stripRefPrefix(text)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/doi:\s*10\.\S+/gi, "")
    .replace(/10\.\d{4,9}\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  let volume: string | undefined;
  let issue: string | undefined;
  let pages: string | undefined;

  // 42(2):377-381  |  42(2), 377-381  |  ;42(2):377–381
  const loc =
    cleaned.match(/[;,]?\s*(\d{1,4})\s*\((\d{1,4})\)\s*[,:：]\s*(\d{1,6}\s*[-–—−]\s*\d{1,6})\b/) ||
    cleaned.match(/\b(\d{1,4})\s*\((\d{1,4})\)\s*[,:：]?\s*(\d{1,6}\s*[-–—−]\s*\d{1,6})\b/);
  if (loc) {
    volume = loc[1];
    issue = loc[2];
    pages = loc[3].replace(/[–—−]/g, "-").replace(/\s+/g, "");
  } else {
    // NEJM Vancouver: 2020;383:2603-2615  (volume:pages, no issue)
    const volPages =
      cleaned.match(/[;,]\s*(\d{1,4})\s*:\s*(\d{1,6}\s*[-–—−]\s*\d{1,6})\b/) ||
      cleaned.match(/\b(?:19|20)\d{2}\s*;\s*(\d{1,4})\s*:\s*(\d{1,6}\s*[-–—−]\s*\d{1,6})\b/);
    if (volPages) {
      volume = volPages[1];
      pages = volPages[2].replace(/[–—−]/g, "-").replace(/\s+/g, "");
    } else {
      const volIssue = cleaned.match(/\b(\d{1,4})\s*\((\d{1,4})\)/);
      if (volIssue) {
        volume = volIssue[1];
        issue = volIssue[2];
      }
      const pagesOnly =
        cleaned.match(/(?:[:：]|pp?\.\s*)(\d{1,6}\s*[-–—−]\s*\d{1,6})\b/i) ||
        cleaned.match(/,\s*(\d{1,6}\s*[-–—−]\s*\d{1,6})\s*\.?$/);
      if (pagesOnly) pages = pagesOnly[1].replace(/[–—−]/g, "-").replace(/\s+/g, "");
    }
  }

  // Journal: text right before year / ;volume (Vancouver & GB)
  let container: string | undefined;
  const beforeYear =
    cleaned.match(
      /[.。]\s*([A-Za-z\u4e00-\u9fff][^.;；]{1,80}?)\s*(?:[.。]\s*)?(?:19|20)\d{2}\s*[;,]?\s*\d/i,
    ) ||
    cleaned.match(/[.。]\s*([A-Za-z\u4e00-\u9fff][^.;；]{1,80}?)\s*,\s*(?:19|20)\d{2}\b/i);
  if (beforeYear?.[1]) {
    const cand = beforeYear[1]
      .trim()
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\s+/g, " ")
      .replace(/[.\s]+$/g, "")
      .trim();
    if (cand.length >= 2 && cand.length <= 80 && !/^(doi|http|vol|pp)/i.test(cand)) {
      container = cand;
    }
  }
  if (!container) {
    // APA: (Year). Title. Journal, volume…
    const apa = cleaned.match(/\(\d{4}[a-z]?\)\.\s+.+?\.\s+([^,，]{2,80})(?:,\s*\d|\.\s*\d|$)/i);
    if (apa?.[1] && apa[1].trim().length >= 2) {
      container = apa[1].trim().replace(/\.$/, "");
    }
  }

  return { container, volume, issue, pages };
}

function normalizePages(p?: string | null) {
  return (p || "")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, "")
    .replace(/^pp?\./i, "")
    .toLowerCase();
}

function journalMatchScore(cited?: string, resolved?: string) {
  const a = normalize(cited);
  const b = normalize(resolved);
  if (!a || !b) return 1; // can't compare → don't flag
  if (a === b) return 1;
  // Only accept substring if cited abbr/name is reasonably complete
  if (b.includes(a) && a.length >= Math.min(14, Math.floor(b.length * 0.45))) return 0.95;
  if (a.includes(b) && b.length >= 8) return 0.95;

  const stop = /^(of|the|and|for|in|on|a|an|und|der|die|das|et|al)$/i;
  const wa = a.split(" ").filter((w) => w.length >= 1 && !stop.test(w));
  const wb = b.split(" ").filter((w) => w.length > 1 && !stop.test(w));
  if (!wa.length || !wb.length) return 0;

  // Ordered coverage of cited tokens against resolved significant words
  let ri = 0;
  let hits = 0;
  for (const token of wa) {
    let matched = false;
    for (let j = ri; j < wb.length; j++) {
      const w = wb[j];
      const ok =
        w === token ||
        w.startsWith(token) ||
        (token.length > 1 && token.startsWith(w)) ||
        (token.length === 1 && w[0] === token) ||
        (token.length >= 2 && w.startsWith(token.slice(0, 2)));
      if (ok) {
        hits += 1;
        ri = j + 1;
        matched = true;
        break;
      }
    }
    if (!matched) {
      /* leave gap — truncated / wrong journal */
    }
  }

  const citedCov = hits / wa.length;
  const resolvedCov = hits / wb.length;

  // N Engl J Med → covers most of New England Journal of Medicine
  if (citedCov >= 0.8 && resolvedCov >= 0.8) return 0.93;
  // N Engl J (missing Med) / wrong journal short form → review
  if (citedCov >= 0.65 && resolvedCov < 0.8) return 0.45;
  return titleSimilarityScore(cited, resolved);
}

function isJunkTitlePart(p: string) {
  const t = p.trim();
  if (t.length < 12) return true;
  if (/^[,&]/.test(t)) return true;
  if (/^\(?\d{4}/.test(t)) return true;
  if (/^(et\s+al|eds?|vol|pp|doi|http)/i.test(t)) return true;
  // Author lists: "Polack DP, Thomas SJ, … et al"
  if (/\bet\s+al\b/i.test(t)) return true;
  if (/^[A-Z][a-z]+\s+[A-Z]{1,3}(\s*,\s*[A-Z][a-z]+\s+[A-Z]{1,3})+/.test(t)) return true;
  // APA author fragments like ", & Li, X" / "S., & Li, X"
  if (/^&?\s*[A-Z]\.?\s*,/.test(t) && t.length < 40) return true;
  if (/^[A-Z]\.\s*,?\s*&/.test(t)) return true;
  if ((t.match(/\b[A-Z]\./g) || []).length >= 2 && t.length < 35) return true;
  return false;
}

function extractLikelyTitle(text: string) {
  const cleaned = stripRefPrefix(text)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/doi:\s*10\.\S+/gi, "")
    .replace(/10\.\d{4,9}\/\S+/gi, "")
    .replace(/\[[JjDbMOL]+\]/g, "")
    .trim();

  // APA / Harvard: Authors (Year). Title. Journal…
  const apa = cleaned.match(/^(.+?)\s*\((\d{4}[a-z]?)\)\.\s*(.+)$/i);
  if (apa) {
    const afterYear = apa[3].trim();
    const title = afterYear.split(/\.\s+/)[0]?.trim() || afterYear;
    if (title && !isJunkTitlePart(title)) return title.slice(0, 200);
  }

  // GB/T: Authors. Title[J]. Journal, year.
  const gbt = cleaned.match(/^[^.。]{2,100}[.。]\s*([^.。\[\]]{12,220}?)(?:\[[^\]]*\])?[.。]/);
  if (gbt?.[1] && !isJunkTitlePart(gbt[1])) return gbt[1].trim().slice(0, 200);

  const parts = cleaned.split(/[.。]/).map((p) => p.trim()).filter(Boolean);
  const candidate = parts.find((p) => !isJunkTitlePart(p));
  if (candidate) return candidate.slice(0, 200);
  return cleaned.slice(0, 160);
}

function extractFirstAuthor(text: string) {
  const cleaned = stripRefPrefix(text);
  // APA: Fan, S., & Li, X. (2024). …
  const beforeYear = cleaned.match(/^(.+?)\s*\(\d{4}/);
  if (beforeYear) {
    const chunk = beforeYear[1].trim();
    // "Fan, S." or "Harris, Paul A."
    const apaFirst = chunk.match(/^([A-Za-z\u4e00-\u9fff][\w'’-]*)\s*,\s*([^,&]+)/);
    if (apaFirst) return `${apaFirst[1]} ${apaFirst[2].replace(/\./g, "").trim()}`.trim();
    const family = chunk.match(/^([A-Za-z\u4e00-\u9fff][\w'’-]*)/);
    return family?.[1];
  }
  // Vancouver / Medline: Harris DD, Taylor B, …
  const vancouver = cleaned.match(/^([A-Za-z\u4e00-\u9fff][\w'’-]*)\s+([A-Z]{1,4})\b/);
  if (vancouver) return `${vancouver[1]} ${vancouver[2]}`;

  const head = cleaned.split(/[.,，;；]/)[0]?.trim();
  if (!head) return undefined;
  const tokens = head.split(/\s+/).filter((t) => /[A-Za-z\u4e00-\u9fff]/.test(t));
  return tokens.slice(0, 2).join(" ") || undefined;
}

function authorFamilyToken(name?: string) {
  if (!name) return "";
  const n = normalize(name);
  const parts = n.split(" ").filter(Boolean);
  const alpha = parts.filter((p) => /[a-z\u4e00-\u9fff]/.test(p) && !/^\d+$/.test(p));
  const long = alpha.filter((p) => p.length > 2);
  // Prefer last long token when name looks like "Given Family" (OpenAlex)
  if (long.length >= 2 && alpha[0] === long[0] && alpha[alpha.length - 1] === long[long.length - 1]) {
    return long[long.length - 1];
  }
  return long[0] || alpha[0] || "";
}

/** Compact initials from a name fragment, e.g. "DD" / "Paul A" / "P.A." → "dd" / "pa" / "pa" */
function authorInitialsKey(name?: string, family?: string) {
  if (!name) return "";
  const n = normalize(name);
  const fam = family || authorFamilyToken(name);
  const rest = n
    .split(" ")
    .filter(Boolean)
    .filter((p) => p !== fam);
  if (!rest.length) return "";
  const compact = rest.join("").replace(/[^a-z\u4e00-\u9fff]/g, "");
  if (compact.length <= 4 && rest.every((p) => p.length <= 2)) return compact;
  return rest.map((p) => p[0]).join("");
}

function authorMatchScore(hint?: string, resolved?: string) {
  if (!hint?.trim() || !resolved?.trim()) return 1;
  const h = normalize(hint);
  const r = normalize(resolved);
  const hParts = h.split(" ").filter(Boolean);
  // Vancouver "Harris DD" → family is the longer token
  const hFam = hParts.find((p) => p.length > 2) || hParts[0] || "";
  if (!hFam || !r.includes(hFam)) return 0;

  const aInit = authorInitialsKey(hint, hFam);
  if (!aInit) return 1;

  const rRest = r.split(" ").filter(Boolean).filter((p) => p !== hFam);
  const givenStarts = rRest.map((p) => p[0]).join("");
  if (!rRest.length) return 0.85;
  if (aInit === givenStarts) return 1;
  // "pa" vs ["paul","a"] already covered; also "p" alone
  if (aInit.length === 1 && rRest[0]?.[0] === aInit) return 1;
  return 0.2;
}

/** Compare cited hints vs resolved record; mutate diffs/drift. */
function compareCitedToResolved(
  fieldDiffs: FieldDiff[],
  driftFields: string[],
  opts: {
    titleHint?: string;
    authorHint?: string;
    yearHint?: string | null;
    containerHint?: string;
    volumeHint?: string;
    issueHint?: string;
    pagesHint?: string;
    pmidHint?: string | null;
    title?: string;
    firstAuthor?: string;
    year?: string | number;
    container?: string;
    volume?: string | number;
    issue?: string | number;
    pages?: string;
    pmid?: string;
    /** Stricter when DOI already anchors the work */
    strict?: boolean;
  },
) {
  const strict = opts.strict !== false;
  const titleFloor = strict ? 0.9 : 0.45;
  const authorFloor = 0.99;
  const journalFloor = strict ? 0.72 : 0.45;

  // Any year mismatch counts (user may change 2009 → 2010)
  if (opts.yearHint && opts.year != null && String(opts.yearHint) !== String(opts.year)) {
    const gap = Math.abs(Number(opts.yearHint) - Number(opts.year));
    if (!Number.isNaN(gap)) {
      pushDiff(fieldDiffs, driftFields, "year", "年份", opts.yearHint, String(opts.year), gap <= 1 ? 0.35 : 0);
    }
  }

  if ((opts.titleHint || "").length >= 12) {
    const score = titleSimilarityScore(opts.titleHint, opts.title);
    if (score < titleFloor) {
      pushDiff(
        fieldDiffs,
        driftFields,
        "title",
        "标题",
        (opts.titleHint || "").slice(0, 100),
        (opts.title || "").slice(0, 100),
        score,
      );
    }
  }

  const authorScore = authorMatchScore(opts.authorHint, opts.firstAuthor);
  if (authorScore < authorFloor) {
    pushDiff(
      fieldDiffs,
      driftFields,
      "first_author",
      "第一作者",
      opts.authorHint || "—",
      opts.firstAuthor || "—",
      authorScore,
    );
  }

  if (opts.containerHint && opts.container) {
    const score = journalMatchScore(opts.containerHint, opts.container);
    if (score < journalFloor) {
      pushDiff(
        fieldDiffs,
        driftFields,
        "container",
        "期刊",
        opts.containerHint.slice(0, 80),
        opts.container.slice(0, 80),
        score,
      );
    }
  }

  if (opts.volumeHint && opts.volume != null && String(opts.volumeHint) !== String(opts.volume).trim()) {
    pushDiff(fieldDiffs, driftFields, "volume", "卷号", opts.volumeHint, String(opts.volume), 0);
  }

  if (opts.issueHint && opts.issue != null && String(opts.issueHint) !== String(opts.issue).trim()) {
    pushDiff(fieldDiffs, driftFields, "issue", "期号", opts.issueHint, String(opts.issue), 0);
  }

  if (opts.pagesHint && opts.pages) {
    const a = normalizePages(opts.pagesHint);
    const b = normalizePages(opts.pages);
    if (a && b && a !== b) {
      pushDiff(fieldDiffs, driftFields, "pages", "页码", opts.pagesHint, opts.pages, 0);
    }
  }

  if (opts.pmidHint && opts.pmid && String(opts.pmidHint) !== String(opts.pmid).replace(/\D/g, "")) {
    pushDiff(fieldDiffs, driftFields, "pmid", "PMID", opts.pmidHint, String(opts.pmid).replace(/\D/g, ""), 0);
  }
}

function pushDiff(
  diffs: FieldDiff[],
  drift: string[],
  field: FieldDiff["field"],
  label: string,
  cited: string | undefined,
  resolved: string | undefined,
  matchScore?: number,
) {
  const c = (cited || "").trim() || "—";
  const r = (resolved || "").trim() || "—";
  if (c === "—" && r === "—") return;
  const score = matchScore ?? (normalize(c) === normalize(r) ? 1 : 0);
  if (score >= 0.99) return;
  diffs.push({ field, label, cited: c, resolved: r, matchScore: score });
  if (!drift.includes(field)) drift.push(field);
}

async function lookupDatacite(doi: string) {
  try {
    const data = await fetchJson<{
      data?: {
        attributes?: {
          doi?: string;
          titles?: Array<{ title?: string }>;
          publicationYear?: number;
          creators?: Array<{ name?: string; familyName?: string }>;
          publisher?: string;
          descriptions?: Array<{ description?: string }>;
        };
      };
    }>(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, {
      cache: "no-store",
      timeoutMs: 6000,
    });
    const a = data.data?.attributes;
    if (!a) return null;
    const firstAuthor = a.creators?.[0]?.familyName || a.creators?.[0]?.name;
    const authors = (a.creators || [])
      .slice(0, 5)
      .map((c) => c.familyName || c.name)
      .filter(Boolean)
      .join(", ");
    return {
      doi: a.doi || doi,
      title: a.titles?.[0]?.title,
      year: a.publicationYear,
      firstAuthor,
      authors: authors || firstAuthor,
      container: a.publisher,
      abstract: a.descriptions?.[0]?.description?.replace(/\s+/g, " ").trim().slice(0, 800),
    };
  } catch {
    return null;
  }
}

type OaWork = {
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
};

function oaToRecord(oa: OaWork, sourceLabel = "文献库", matchScore?: number): SourceRecord {
  const authorList = fromOpenAlexAuthors(oa.authorships);
  const authors =
    authorList
      .map((a) => (a.family ? `${a.family}${a.given ? ` ${a.given}` : ""}` : a.name || ""))
      .filter(Boolean)
      .join(", ") || undefined;
  const doi = stripDoi(oa.doi) || undefined;
  const pmidRaw = oa.ids?.pmid;
  const pmid = pmidRaw
    ? String(pmidRaw).replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, "").replace(/\D/g, "")
    : undefined;
  const pages =
    oa.biblio?.first_page && oa.biblio?.last_page
      ? `${oa.biblio.first_page}-${oa.biblio.last_page}`
      : oa.biblio?.first_page || undefined;
  return {
    title: oa.display_name,
    authors,
    authorList,
    firstAuthor: authorList[0]
      ? authorList[0].family
        ? `${authorList[0].family}${authorList[0].given ? ` ${authorList[0].given}` : ""}`
        : authorList[0].name
      : oa.authorships?.[0]?.author?.display_name,
    year: oa.publication_year,
    container: oa.primary_location?.source?.display_name || undefined,
    doi,
    pmid: pmid || undefined,
    abstract: reconstructAbstract(oa.abstract_inverted_index).replace(/\s+/g, " ").trim().slice(0, 900) || undefined,
    type: oa.type,
    citedBy: oa.cited_by_count,
    volume: oa.biblio?.volume || undefined,
    issue: oa.biblio?.issue || undefined,
    pages,
    url: doi ? `https://doi.org/${doi}` : oa.primary_location?.landing_page_url || undefined,
    sources: [sourceLabel],
    matchScore,
  };
}

async function lookupOpenAlexByDoi(doi: string): Promise<SourceRecord | null> {
  try {
    const oa = await fetchJson<OaWork>(
      `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?${encodeQuery({ mailto: CONTACT_EMAIL })}`,
      { cache: "no-store", timeoutMs: 7000 },
    );
    if (!oa?.display_name) return null;
    return oaToRecord(oa);
  } catch {
    return null;
  }
}

async function searchTitleCandidates(titleHint: string, limit = 3) {
  if (!titleHint || titleHint.length < 12) return [] as SourceRecord[];
  try {
    const search = await fetchJson<{ results?: OaWork[] }>(
      `https://api.openalex.org/works?${encodeQuery({
        search: titleHint.slice(0, 180),
        per_page: Math.max(limit, 5),
        mailto: CONTACT_EMAIL,
      })}`,
      { cache: "no-store", timeoutMs: 8000 },
    );
    return (search.results || [])
      .map((hit) => {
        const score = titleSimilarityScore(titleHint, hit.display_name);
        return oaToRecord(hit, "文献库", score);
      })
      .filter((r) => (r.matchScore || 0) >= 0.35)
      .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function recordFromCrossref(message: {
  title?: string[];
  DOI?: string;
  author?: Array<{ family?: string; given?: string; name?: string }>;
  "container-title"?: string[];
  issued?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  abstract?: string;
  type?: string;
  "is-referenced-by-count"?: number;
  volume?: string;
  issue?: string;
  page?: string;
}): SourceRecord {
  const authorList = fromCrossrefAuthors(message.author);
  const authors = authorList
    .map((a) => (a.family ? `${a.family}${a.given ? ` ${a.given}` : ""}` : a.name || ""))
    .filter(Boolean)
    .join(", ");
  const doi = stripDoi(message.DOI) || undefined;
  const year =
    message["published-print"]?.["date-parts"]?.[0]?.[0] ||
    message.issued?.["date-parts"]?.[0]?.[0] ||
    message["published-online"]?.["date-parts"]?.[0]?.[0];
  return {
    title: message.title?.[0],
    authors: authors || undefined,
    authorList,
    firstAuthor: authorList[0]
      ? `${authorList[0].family || ""}${authorList[0].given ? ` ${authorList[0].given}` : ""}`.trim() || authorList[0].name
      : undefined,
    year,
    container: message["container-title"]?.[0],
    doi,
    abstract: message.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 900) || undefined,
    type: message.type,
    citedBy: message["is-referenced-by-count"],
    volume: message.volume,
    issue: message.issue,
    pages: message.page,
    url: doi ? `https://doi.org/${doi}` : undefined,
    sources: ["登记库"],
  };
}

function formatsFromRecord(record: SourceRecord, fallbackAuthors?: string) {
  return buildFormats({
    authors: record.authorList?.length ? record.authorList : record.authors || fallbackAuthors,
    title: record.title,
    container: record.container,
    year: record.year,
    doi: record.doi,
    volume: record.volume,
    issue: record.issue,
    pages: record.pages,
    type: record.type,
  });
}

async function verifyOne(raw: string, index: number): Promise<CiteResult> {
  const doi = extractDoi(raw);
  const pmidHint = extractPmid(raw);
  const yearHint = extractYear(raw);
  const titleHint = extractLikelyTitle(raw);
  const authorHint = extractFirstAuthor(raw);
  const biblioHint = extractBiblioHints(raw);
  const driftFields: string[] = [];
  const fieldDiffs: FieldDiff[] = [];
  const sources: string[] = [];
  const links: { label: string; url: string }[] = [];

  const compareOpts = (resolved: {
    title?: string;
    firstAuthor?: string;
    year?: string | number;
    container?: string;
    volume?: string | number;
    issue?: string | number;
    pages?: string;
    pmid?: string;
  }, strict = true) => ({
    titleHint,
    authorHint,
    yearHint,
    containerHint: biblioHint.container,
    volumeHint: biblioHint.volume,
    issueHint: biblioHint.issue,
    pagesHint: biblioHint.pages,
    pmidHint,
    title: resolved.title,
    firstAuthor: resolved.firstAuthor,
    year: resolved.year,
    container: resolved.container,
    volume: resolved.volume,
    issue: resolved.issue,
    pages: resolved.pages,
    pmid: resolved.pmid,
    strict,
  });

  const driftLabel = (f: string) =>
    (
      {
        doi: "DOI",
        year: "年份",
        title: "标题",
        first_author: "第一作者",
        container: "期刊",
        volume: "卷号",
        issue: "期号",
        pages: "页码",
        pmid: "PMID",
      } as Record<string, string>
    )[f] || f;

  if (doi) {
    links.push({ label: "原文", url: `https://doi.org/${doi}` });

    try {
      const crossref = await fetchJson<{
        status: string;
        message?: {
          title?: string[];
          DOI?: string;
          author?: Array<{ family?: string; given?: string; name?: string }>;
          "container-title"?: string[];
          issued?: { "date-parts"?: number[][] };
          abstract?: string;
          type?: string;
          "is-referenced-by-count"?: number;
          volume?: string;
          issue?: string;
          page?: string;
          "published-print"?: { "date-parts"?: number[][] };
          "published-online"?: { "date-parts"?: number[][] };
        };
      }>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
        cache: "no-store",
        timeoutMs: 8000,
      });

      if (crossref.status === "ok" && crossref.message) {
        sources.push("登记库");
        const record = recordFromCrossref(crossref.message);
        const title = record.title;
        const container = record.container;
        const crYear = record.year;
        const resolvedDoi = record.doi || doi;
        const firstAuthor = record.firstAuthor;

        if (normalize(resolvedDoi) !== normalize(doi)) {
          pushDiff(fieldDiffs, driftFields, "doi", "DOI", doi, resolvedDoi, 0);
        }
        compareCitedToResolved(
          fieldDiffs,
          driftFields,
          compareOpts({
            title,
            firstAuthor,
            year: crYear,
            container,
            volume: record.volume,
            issue: record.issue,
            pages: record.pages,
            pmid: record.pmid,
          }),
        );

        let secondHit = false;
        const oa = await lookupOpenAlexByDoi(doi);
        if (oa) {
          sources.push("文献库");
          secondHit = true;
          if (!record.abstract && oa.abstract) record.abstract = oa.abstract;
          if (oa.citedBy != null) record.citedBy = oa.citedBy;
          if (oa.pmid) record.pmid = oa.pmid;
          if (!record.authorList?.length && oa.authorList?.length) {
            record.authorList = oa.authorList;
            record.authors = oa.authors;
          }
          if (!record.volume && oa.volume) record.volume = oa.volume;
          if (!record.issue && oa.issue) record.issue = oa.issue;
          if (!record.pages && oa.pages) record.pages = oa.pages;
          record.sources = Array.from(new Set([...record.sources, ...oa.sources]));
          // PMID may arrive only from OpenAlex — re-check after enrich
          if (pmidHint && oa.pmid && String(pmidHint) !== String(oa.pmid).replace(/\D/g, "")) {
            pushDiff(fieldDiffs, driftFields, "pmid", "PMID", pmidHint, String(oa.pmid).replace(/\D/g, ""), 0);
          }
        } else {
          const dc = await lookupDatacite(doi);
          if (dc) {
            sources.push("数据登记");
            secondHit = true;
            if (!record.abstract && dc.abstract) record.abstract = dc.abstract;
            record.sources = Array.from(new Set([...record.sources, "数据登记"]));
          }
        }

        const status: CiteStatus = driftFields.length ? (driftFields.includes("doi") ? "risk" : "review") : secondHit ? "ok" : "review";
        return {
          index,
          raw,
          status,
          message: driftFields.length
            ? `DOI 可解析，但字段与库内记录不一致（${driftFields.map(driftLabel).join("、")}），请人工复核。`
            : secondHit
              ? "DOI 有效，多源命中，标题/年份总体一致。右侧可直接核对库内信息页。"
              : "DOI 有效；第二源未复核到，建议对照右侧库内信息确认。",
          title,
          firstAuthor,
          doi: resolvedDoi || doi,
          year: crYear || yearHint || undefined,
          container,
          sources,
          driftFields,
          fieldDiffs,
          links,
          record,
          formats: formatsFromRecord(record, authorHint),
        };
      }
    } catch {
      /* try datacite / openalex fallback below */
    }

    const dc = await lookupDatacite(doi);
    if (dc) {
      sources.push("数据登记");
      compareCitedToResolved(
        fieldDiffs,
        driftFields,
        compareOpts({
          title: dc.title,
          firstAuthor: dc.firstAuthor,
          year: dc.year,
          container: dc.container,
        }),
      );
      const record: SourceRecord = {
        title: dc.title,
        authors: dc.authors,
        firstAuthor: dc.firstAuthor,
        year: dc.year,
        container: dc.container,
        doi: dc.doi || doi,
        abstract: dc.abstract,
        url: `https://doi.org/${dc.doi || doi}`,
        sources: ["数据登记"],
      };
      return {
        index,
        raw,
        status: driftFields.length ? "review" : "ok",
        message: driftFields.length
          ? "DOI 在数据登记库命中，但字段存在偏差，请复核。"
          : "DOI 在数据登记库命中。右侧可直接核对库内信息。",
        title: dc.title,
        firstAuthor: dc.firstAuthor,
        doi: dc.doi || doi,
        year: dc.year || yearHint || undefined,
        container: dc.container,
        sources,
        driftFields,
        fieldDiffs,
        links,
        record,
        formats: formatsFromRecord(record, authorHint),
      };
    }

    const oaHit = await lookupOpenAlexByDoi(doi);
    if (oaHit) {
      sources.push("文献库");
      compareCitedToResolved(
        fieldDiffs,
        driftFields,
        compareOpts({
          title: oaHit.title,
          firstAuthor: oaHit.firstAuthor,
          year: oaHit.year,
          container: oaHit.container,
          volume: oaHit.volume,
          issue: oaHit.issue,
          pages: oaHit.pages,
          pmid: oaHit.pmid,
        }),
      );
      return {
        index,
        raw,
        status: driftFields.length ? "review" : "ok",
        message: driftFields.length
          ? "DOI 在文献库命中，但字段存在偏差，请复核。"
          : "DOI 在文献库命中。右侧可直接核对库内信息页。",
        title: oaHit.title,
        firstAuthor: oaHit.firstAuthor,
        doi: oaHit.doi || doi,
        year: oaHit.year || yearHint || undefined,
        container: oaHit.container,
        sources,
        driftFields,
        fieldDiffs,
        links,
        record: oaHit,
        formats: formatsFromRecord(oaHit, authorHint),
      };
    }

    // DOI dead: still try title match so user can compare inline
    pushDiff(fieldDiffs, driftFields, "doi", "DOI", doi, "未找到", 0);
    const titleHits = await searchTitleCandidates(titleHint, 2);
    const best = titleHits[0];
    if (best && (best.matchScore || 0) >= 0.45) {
      pushDiff(
        fieldDiffs,
        driftFields,
        "title",
        "标题",
        titleHint.slice(0, 80),
        (best.title || "").slice(0, 80),
        best.matchScore,
      );
      return {
        index,
        raw,
        status: "risk",
        message: `DOI 多源均未找到（疑似错误/虚构）。按标题找到接近文献（${Math.round((best.matchScore || 0) * 100)}%），请在右侧核对是否为同一篇。`,
        doi,
        year: yearHint || undefined,
        title: titleHint,
        firstAuthor: authorHint,
        sources,
        driftFields,
        fieldDiffs,
        links,
        record: best,
        // Dead/fake DOI: do not export formats built from cited hints alone
        formats: { ...EMPTY_FORMATS },
      };
    }

    return {
      index,
      raw,
      status: "risk",
      message: "提供了 DOI，但多源均未找到对应记录，且标题也无足够接近匹配，疑似错误或虚构 DOI。",
      doi,
      year: yearHint || undefined,
      title: titleHint,
      firstAuthor: authorHint,
      sources,
      driftFields: ["doi"],
      fieldDiffs,
      links,
      record: null,
      formats: { ...EMPTY_FORMATS },
    };
  }

  // No DOI: fuzzy title search
  try {
    const ranked = await searchTitleCandidates(titleHint, 3);
    const best = ranked[0];

    if (!best || (best.matchScore || 0) < 0.35) {
      pushDiff(fieldDiffs, driftFields, "doi", "DOI", "缺失", "未匹配", 0);
      pushDiff(fieldDiffs, driftFields, "title", "标题", titleHint.slice(0, 80), "无接近匹配", 0);
      return {
        index,
        raw,
        status: "risk",
        message: "无 DOI，且未能找到足够接近的文献匹配，请核对或补上 DOI。",
        year: yearHint || undefined,
        title: titleHint,
        firstAuthor: authorHint,
        sources: [],
        driftFields: ["title", "doi"],
        fieldDiffs,
        links: [],
        record: null,
        formats: { ...EMPTY_FORMATS },
      };
    }

    sources.push(...best.sources);
    const resolvedDoi = best.doi;
    pushDiff(fieldDiffs, driftFields, "doi", "DOI", "缺失", resolvedDoi || "仍缺失", resolvedDoi ? 0.5 : 0);
    compareCitedToResolved(
      fieldDiffs,
      driftFields,
      compareOpts(
        {
          title: best.title,
          firstAuthor: best.firstAuthor,
          year: best.year,
          container: best.container,
          volume: best.volume,
          issue: best.issue,
          pages: best.pages,
          pmid: best.pmid,
        },
        false,
      ),
    );
    if (resolvedDoi) links.push({ label: "原文", url: `https://doi.org/${resolvedDoi}` });

    const score = best.matchScore || 0;
    const status: CiteStatus =
      score >= 0.85 || (score >= 0.7 && Boolean(resolvedDoi)) ? "review" : "insufficient";

    return {
      index,
      raw,
      status,
      message:
        score >= 0.85 || score >= 0.7
          ? "缺少可靠 DOI，仅按标题模糊匹配。右侧库内信息页供核对。"
          : "缺少 DOI，仅弱匹配到可能相关文献，证据不足。",
      title: best.title,
      firstAuthor: best.firstAuthor,
      doi: resolvedDoi,
      year: best.year || yearHint || undefined,
      container: best.container,
      sources,
      driftFields,
      fieldDiffs,
      links,
      record: best,
      formats: formatsFromRecord(best, authorHint),
    };
  } catch {
    return {
      index,
      raw,
      status: "insufficient",
      message: "暂时无法完成核验，请稍后重试。",
      year: yearHint || undefined,
      sources: [],
      driftFields: [],
      fieldDiffs: [],
      links: [],
      record: null,
      formats: { ...EMPTY_FORMATS },
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { text?: string };
    let text = body.text || "";
    let inputTruncated = false;
    if (text.length > 30000) {
      text = text.slice(0, 30000);
      inputTruncated = true;
    }
    const refs = splitReferences(text);
    if (!refs.length) {
      return NextResponse.json({ error: "请粘贴至少一条参考文献" }, { status: 400 });
    }

    const results: CiteResult[] = new Array(refs.length);
    const concurrency = 3;
    let cursor = 0;

    async function worker() {
      while (cursor < refs.length) {
        const i = cursor;
        cursor += 1;
        results[i] = await verifyOne(refs[i], i + 1);
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, () => worker()));

    const driftCount: Record<string, number> = {};
    const sourceCount: Record<string, number> = {};
    for (const r of results) {
      for (const f of r.driftFields) driftCount[f] = (driftCount[f] || 0) + 1;
      for (const s of r.sources) sourceCount[s] = (sourceCount[s] || 0) + 1;
    }

    const summary = {
      total: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      review: results.filter((r) => r.status === "review").length,
      risk: results.filter((r) => r.status === "risk").length,
      insufficient: results.filter((r) => r.status === "insufficient").length,
      driftFields: Object.keys(driftCount),
      driftCounts: driftCount,
      sources: Object.keys(sourceCount),
      sourceCounts: sourceCount,
      reviewIndexes: results.filter((r) => r.status !== "ok").map((r) => r.index),
    };

    return NextResponse.json({
      results,
      summary,
      truncated: inputTruncated || refs.length >= 15,
    });
  } catch {
    return NextResponse.json({ error: "核查失败，请稍后重试" }, { status: 500 });
  }
}
