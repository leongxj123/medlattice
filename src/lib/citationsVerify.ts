import {
  encodeQuery,
  fetchJson,
  CONTACT_EMAIL,
  reconstructAbstract,
  stripDoi,
  pubmedSearchMeta,
  pubmedSummaries,
} from "@/lib/http";
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

/** Full field-by-field checklist (matched + mismatched) for UI verification. */
export type FieldCheck = FieldDiff & {
  ok: boolean;
  /** cited side could not be parsed from the reference string */
  citedMissing?: boolean;
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
  fieldChecks?: FieldCheck[];
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
  const m =
    text.match(/\bPMID[:\s]*([0-9]{5,9})\b/i) ||
    text.match(/\bPubMed(?:\s*ID)?[:\s]*([0-9]{5,9})\b/i) ||
    text.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(?:\w+\/)?(\d{5,9})\b/i);
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
  if (!hint?.trim()) return 1; // nothing to verify from cited side
  if (!resolved?.trim()) return 0;
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

type CompareOpts = {
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
};

/** Compare cited hints vs resolved record; mutate diffs/drift; return full checklist. */
function compareCitedToResolved(
  fieldDiffs: FieldDiff[],
  driftFields: string[],
  opts: CompareOpts,
): FieldCheck[] {
  const strict = opts.strict !== false;
  // DOI-anchored refs: even small title edits should surface as 需复核
  const titleFloor = strict ? 0.95 : 0.55;
  const authorFloor = 0.99;
  const journalFloor = strict ? 0.78 : 0.5;
  const checks: FieldCheck[] = [];

  const note = (
    field: FieldDiff["field"],
    label: string,
    citedRaw: string | undefined | null,
    resolvedRaw: string | undefined | null,
    score: number,
    floor: number,
    optsExtra?: { citedMissing?: boolean; skipDrift?: boolean },
  ) => {
    const cited = (citedRaw || "").trim();
    const resolved = (resolvedRaw || "").trim();
    if (!cited && !resolved) return;

    if (!cited) {
      checks.push({
        field,
        label,
        cited: "（引用中未提取）",
        resolved: resolved || "—",
        matchScore: undefined,
        ok: true,
        citedMissing: true,
      });
      return;
    }

    if (!resolved) {
      // Library lacks this field — show for transparency, but don't mark as drift
      checks.push({
        field,
        label,
        cited,
        resolved: "（库内无）",
        matchScore: undefined,
        ok: true,
      });
      return;
    }

    const ok = score >= floor;
    checks.push({
      field,
      label,
      cited: cited.slice(0, 120),
      resolved: resolved.slice(0, 120),
      matchScore: score,
      ok,
      citedMissing: optsExtra?.citedMissing,
    });
    if (!ok && !optsExtra?.skipDrift) {
      pushDiff(fieldDiffs, driftFields, field, label, cited.slice(0, 120), resolved.slice(0, 120), score);
    }
  };

  // Year: exact match preferred; ±1 (print vs online) accepted; larger gaps flag
  if (opts.yearHint || opts.year != null) {
    const cited = opts.yearHint ? String(opts.yearHint) : "";
    const resolved = opts.year != null ? String(opts.year) : "";
    let score = 1;
    if (cited && resolved && cited !== resolved) {
      const gap = Math.abs(Number(cited) - Number(resolved));
      score = !Number.isNaN(gap) && gap <= 1 ? 0.92 : 0;
    }
    note("year", "年份", cited || undefined, resolved || undefined, score, 0.9);
  }

  {
    const cited = (opts.titleHint || "").trim();
    const resolved = (opts.title || "").trim();
    const score =
      cited.length >= 8 && resolved
        ? titleSimilarityScore(cited, resolved)
        : cited.length >= 8
          ? 0
          : 1;
    if (cited.length >= 8 || resolved) {
      note("title", "标题", cited.length >= 8 ? cited : undefined, resolved || undefined, score, titleFloor);
    }
  }

  {
    const cited = (opts.authorHint || "").trim();
    const resolved = (opts.firstAuthor || "").trim();
    const score = authorMatchScore(cited || undefined, resolved || undefined);
    note("first_author", "第一作者", cited || undefined, resolved || undefined, score, authorFloor);
  }

  {
    const cited = (opts.containerHint || "").trim();
    const resolved = (opts.container || "").trim();
    const score = cited && resolved ? journalMatchScore(cited, resolved) : cited ? 0 : 1;
    note("container", "期刊", cited || undefined, resolved || undefined, score, journalFloor);
  }

  {
    const cited = opts.volumeHint ? String(opts.volumeHint).trim() : "";
    const resolved = opts.volume != null ? String(opts.volume).trim() : "";
    const score = cited && resolved ? (cited === resolved ? 1 : 0) : cited ? 0 : 1;
    note("volume", "卷号", cited || undefined, resolved || undefined, score, 0.99);
  }

  {
    const cited = opts.issueHint ? String(opts.issueHint).trim() : "";
    const resolved = opts.issue != null ? String(opts.issue).trim() : "";
    const score = cited && resolved ? (cited === resolved ? 1 : 0) : cited ? 0 : 1;
    note("issue", "期号", cited || undefined, resolved || undefined, score, 0.99);
  }

  {
    const cited = (opts.pagesHint || "").trim();
    const resolved = (opts.pages || "").trim();
    const a = normalizePages(cited);
    const b = normalizePages(resolved);
    const score = a && b ? (a === b ? 1 : 0) : a ? 0 : 1;
    note("pages", "页码", cited || undefined, resolved || undefined, score, 0.99);
  }

  {
    const cited = (opts.pmidHint || "").trim();
    const resolved = opts.pmid ? String(opts.pmid).replace(/\D/g, "") : "";
    const score = cited && resolved ? (cited === resolved ? 1 : 0) : cited ? 0 : 1;
    note("pmid", "PMID", cited || undefined, resolved || undefined, score, 0.99);
  }

  return checks;
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

async function lookupOpenAlexByPmid(pmid: string): Promise<SourceRecord | null> {
  const clean = pmid.replace(/\D/g, "");
  if (!clean) return null;
  try {
    const oa = await fetchJson<OaWork>(
      `https://api.openalex.org/works/pmid:${encodeURIComponent(clean)}?${encodeQuery({ mailto: CONTACT_EMAIL })}`,
      { cache: "no-store", timeoutMs: 7000 },
    );
    if (!oa?.display_name) return null;
    const rec = oaToRecord(oa);
    rec.pmid = rec.pmid || clean;
    return rec;
  } catch {
    return null;
  }
}

function recordFromPubmedSummary(s: {
  pmid: string;
  title: string;
  source?: string;
  pubdate?: string;
  authors?: string;
  doi?: string | null;
}): SourceRecord | null {
  if (!s.title || s.title === "Untitled") return null;
  const year = s.pubdate?.match(/\b((?:19|20)\d{2})\b/)?.[1];
  const first = (s.authors || "").split(",")[0]?.trim() || undefined;
  const doi = stripDoi(s.doi) || undefined;
  return {
    title: s.title.replace(/\.$/, "").trim(),
    authors: s.authors || undefined,
    firstAuthor: first,
    year: year || undefined,
    container: s.source || undefined,
    doi,
    pmid: s.pmid,
    url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`,
    sources: ["医学索引"],
  };
}

/** Prefer `rich` bibliographic fields when present; keep durable IDs from base. */
function overlayRecord(base: SourceRecord, rich: SourceRecord | null | undefined): SourceRecord {
  if (!rich) return base;
  return {
    title: rich.title || base.title,
    authors: rich.authors || base.authors,
    authorList: rich.authorList?.length ? rich.authorList : base.authorList,
    firstAuthor: rich.firstAuthor || base.firstAuthor,
    year: rich.year ?? base.year,
    container: rich.container || base.container,
    doi: rich.doi || base.doi,
    pmid: base.pmid || rich.pmid,
    abstract: base.abstract || rich.abstract,
    type: rich.type || base.type,
    citedBy: rich.citedBy ?? base.citedBy,
    volume: rich.volume ?? base.volume,
    issue: rich.issue ?? base.issue,
    pages: rich.pages || base.pages,
    url: rich.url || base.url,
    sources: Array.from(new Set([...(base.sources || []), ...(rich.sources || [])])),
    matchScore:
      base.matchScore != null || rich.matchScore != null
        ? Math.max(base.matchScore || 0, rich.matchScore || 0)
        : undefined,
  };
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

async function lookupCrossrefByDoi(doi: string): Promise<SourceRecord | null> {
  try {
    const crossref = await fetchJson<{
      status: string;
      message?: Parameters<typeof recordFromCrossref>[0];
    }>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      cache: "no-store",
      timeoutMs: 8000,
    });
    if (crossref.status === "ok" && crossref.message) return recordFromCrossref(crossref.message);
    return null;
  } catch {
    return null;
  }
}

/** Resolve PMID → canonical record (医学索引 + 文献库 + optional 登记库). */
async function resolveByPmid(pmid: string): Promise<{ record: SourceRecord | null; secondHit: boolean }> {
  const clean = pmid.replace(/\D/g, "");
  if (!/^\d{5,9}$/.test(clean)) return { record: null, secondHit: false };

  const [pmList, oa] = await Promise.all([
    pubmedSummaries([clean]).catch(() => []),
    lookupOpenAlexByPmid(clean),
  ]);
  const fromPm = pmList[0] ? recordFromPubmedSummary(pmList[0]) : null;
  if (!fromPm && !oa) return { record: null, secondHit: false };

  let record = fromPm && oa ? overlayRecord(fromPm, oa) : fromPm || oa!;
  record.pmid = clean;
  let secondHit = Boolean(fromPm && oa);

  if (record.doi) {
    const cr = await lookupCrossrefByDoi(record.doi);
    if (cr) {
      record = overlayRecord(record, cr);
      record.pmid = clean;
      secondHit = true;
    }
  }

  if (!record.url) {
    record.url = record.doi
      ? `https://doi.org/${record.doi}`
      : `https://pubmed.ncbi.nlm.nih.gov/${clean}/`;
  }
  return { record, secondHit };
}

async function searchPubmedByTitle(titleHint: string, limit = 3): Promise<SourceRecord[]> {
  if (!titleHint || titleHint.length < 12) return [];
  try {
    const quoted = `"${titleHint.slice(0, 120).replace(/"/g, "")}"[Title]`;
    let meta = await pubmedSearchMeta(quoted, limit);
    if (!meta.ids.length) {
      meta = await pubmedSearchMeta(titleHint.slice(0, 160), limit);
    }
    if (!meta.ids.length) return [];
    const summaries = await pubmedSummaries(meta.ids.slice(0, limit));
    return summaries
      .map((s) => {
        const rec = recordFromPubmedSummary(s);
        if (!rec) return null;
        rec.matchScore = titleSimilarityScore(titleHint, rec.title);
        return rec;
      })
      .filter((r): r is SourceRecord => r != null && (r.matchScore || 0) >= 0.35)
      .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  } catch {
    return [];
  }
}

async function searchCrossrefBibliographic(titleHint: string, limit = 3): Promise<SourceRecord[]> {
  if (!titleHint || titleHint.length < 12) return [];
  try {
    const data = await fetchJson<{
      message?: { items?: Parameters<typeof recordFromCrossref>[0][] };
    }>(
      `https://api.crossref.org/works?${encodeQuery({
        "query.bibliographic": titleHint.slice(0, 200),
        rows: String(Math.max(limit, 5)),
      })}`,
      { cache: "no-store", timeoutMs: 8000 },
    );
    return (data.message?.items || [])
      .map((item) => {
        const rec = recordFromCrossref(item);
        rec.matchScore = titleSimilarityScore(titleHint, rec.title);
        return rec;
      })
      .filter((r) => (r.matchScore || 0) >= 0.35)
      .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function dedupeCandidates(list: SourceRecord[]) {
  const out: SourceRecord[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const key =
      (c.doi && `doi:${c.doi.toLowerCase()}`) ||
      (c.pmid && `pmid:${c.pmid}`) ||
      `t:${normalize(c.title).slice(0, 80)}`;
    if (seen.has(key)) {
      const idx = out.findIndex((x) => {
        const k =
          (x.doi && `doi:${x.doi.toLowerCase()}`) ||
          (x.pmid && `pmid:${x.pmid}`) ||
          `t:${normalize(x.title).slice(0, 80)}`;
        return k === key;
      });
      if (idx >= 0) out[idx] = overlayRecord(out[idx], c);
      continue;
    }
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Composite score for no-DOI/no-PMID matching.
 * Hard-penalize author/year conflicts so short/generic titles cannot falsely lock.
 */
function candidateCompositeScore(
  c: SourceRecord,
  hints: { titleHint?: string; authorHint?: string; yearHint?: string | null; containerHint?: string },
) {
  const titleScore = titleSimilarityScore(hints.titleHint, c.title);
  if (titleScore < 0.55) return 0;

  const authorScore = authorMatchScore(hints.authorHint, c.firstAuthor);
  const hasAuthor = Boolean(hints.authorHint?.trim());
  const hasYear = Boolean(hints.yearHint);
  let yearScore = 1;
  if (hasYear && c.year != null) {
    const gap = Math.abs(Number(hints.yearHint) - Number(c.year));
    yearScore = Number.isNaN(gap) ? 0.5 : gap === 0 ? 1 : gap === 1 ? 0.4 : 0;
  }
  const journalScore =
    hints.containerHint && c.container ? journalMatchScore(hints.containerHint, c.container) : 1;

  if (hasAuthor && authorScore < 0.5 && titleScore < 0.93) return Math.min(titleScore * 0.35, 0.4);
  if (hasYear && yearScore === 0 && titleScore < 0.96) return Math.min(titleScore * 0.4, 0.45);

  const authorW = hasAuthor ? 0.22 : 0.08;
  const yearW = hasYear ? 0.15 : 0.08;
  const journalW = hints.containerHint ? 0.08 : 0.04;
  const titleW = 1 - authorW - yearW - journalW;
  return titleScore * titleW + authorScore * authorW + yearScore * yearW + journalScore * journalW;
}

async function searchNoIdCandidates(
  hints: { titleHint?: string; authorHint?: string; yearHint?: string | null; containerHint?: string },
  limit = 5,
) {
  const titleHint = hints.titleHint || "";
  if (titleHint.length < 12) return [] as Array<SourceRecord & { composite: number }>;

  const [oa, pm, cr] = await Promise.all([
    searchTitleCandidates(titleHint, 4),
    searchPubmedByTitle(titleHint, 4),
    searchCrossrefBibliographic(titleHint, 4),
  ]);

  const merged = dedupeCandidates([...oa, ...pm, ...cr]);
  return merged
    .map((c) => ({ ...c, composite: candidateCompositeScore(c, hints) }))
    .filter((c) => c.composite >= 0.5)
    .sort((a, b) => b.composite - a.composite)
    .slice(0, limit);
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
        const resolvedDoi = record.doi || doi;

        let secondHit = false;
        const oa = await lookupOpenAlexByDoi(doi);
        if (oa) {
          sources.push("文献库");
          secondHit = true;
          if (!record.abstract && oa.abstract) record.abstract = oa.abstract;
          if (oa.citedBy != null) record.citedBy = oa.citedBy;
          if (oa.pmid) record.pmid = oa.pmid;
          if (!record.firstAuthor && oa.firstAuthor) record.firstAuthor = oa.firstAuthor;
          if (!record.authorList?.length && oa.authorList?.length) {
            record.authorList = oa.authorList;
            record.authors = oa.authors;
          }
          if (!record.volume && oa.volume) record.volume = oa.volume;
          if (!record.issue && oa.issue) record.issue = oa.issue;
          if (!record.pages && oa.pages) record.pages = oa.pages;
          if (!record.container && oa.container) record.container = oa.container;
          record.sources = Array.from(new Set([...record.sources, ...oa.sources]));
        } else {
          const dc = await lookupDatacite(doi);
          if (dc) {
            sources.push("数据登记");
            secondHit = true;
            if (!record.abstract && dc.abstract) record.abstract = dc.abstract;
            if (!record.firstAuthor && dc.firstAuthor) record.firstAuthor = dc.firstAuthor;
            if (!record.container && dc.container) record.container = dc.container;
            record.sources = Array.from(new Set([...record.sources, "数据登记"]));
          }
        }

        // Compare AFTER enrich so volume/issue/pages/pmid from second source are checked
        if (normalize(resolvedDoi) !== normalize(doi)) {
          pushDiff(fieldDiffs, driftFields, "doi", "DOI", doi, resolvedDoi, 0);
        }
        const fieldChecks = compareCitedToResolved(
          fieldDiffs,
          driftFields,
          compareOpts({
            title: record.title,
            firstAuthor: record.firstAuthor,
            year: record.year,
            container: record.container,
            volume: record.volume,
            issue: record.issue,
            pages: record.pages,
            pmid: record.pmid,
          }),
        );

        const status: CiteStatus = driftFields.length
          ? driftFields.includes("doi")
            ? "risk"
            : "review"
          : secondHit
            ? "ok"
            : "review";
        return {
          index,
          raw,
          status,
          message: driftFields.length
            ? `DOI 可解析，但字段与库内记录不一致（${driftFields.map(driftLabel).join("、")}），请人工复核。`
            : secondHit
              ? "DOI 有效，多源命中；作者/标题/年份/期刊/卷期页已逐项核对一致。"
              : "DOI 有效；第二源未复核到，已按登记库字段核对，建议再对照右侧库内信息。",
          title: record.title,
          firstAuthor: record.firstAuthor,
          doi: resolvedDoi || doi,
          year: record.year || yearHint || undefined,
          container: record.container,
          sources,
          driftFields,
          fieldDiffs,
          fieldChecks,
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
      const fieldChecks = compareCitedToResolved(
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
          : "DOI 在数据登记库命中；可核字段已核对一致。",
        title: dc.title,
        firstAuthor: dc.firstAuthor,
        doi: dc.doi || doi,
        year: dc.year || yearHint || undefined,
        container: dc.container,
        sources,
        driftFields,
        fieldDiffs,
        fieldChecks,
        links,
        record,
        formats: formatsFromRecord(record, authorHint),
      };
    }

    const oaHit = await lookupOpenAlexByDoi(doi);
    if (oaHit) {
      sources.push("文献库");
      const fieldChecks = compareCitedToResolved(
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
          : "DOI 在文献库命中；作者/标题/年份/期刊/卷期页已逐项核对。",
        title: oaHit.title,
        firstAuthor: oaHit.firstAuthor,
        doi: oaHit.doi || doi,
        year: oaHit.year || yearHint || undefined,
        container: oaHit.container,
        sources,
        driftFields,
        fieldDiffs,
        fieldChecks,
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

  // ——— PMID primary (no DOI in citation) ———
  if (pmidHint) {
    links.push({ label: "PubMed", url: `https://pubmed.ncbi.nlm.nih.gov/${pmidHint}/` });
    const { record: resolved, secondHit } = await resolveByPmid(pmidHint);

    if (!resolved) {
      // Dead PMID: still try title so user can compare, but mark risk
      pushDiff(fieldDiffs, driftFields, "pmid", "PMID", pmidHint, "未找到", 0);
      const titleHits = await searchNoIdCandidates(
        { titleHint, authorHint, yearHint, containerHint: biblioHint.container },
        2,
      );
      const best = titleHits[0];
      if (best && best.composite >= 0.72) {
        const fieldChecks = compareCitedToResolved(
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
        if (best.doi) links.push({ label: "原文", url: `https://doi.org/${best.doi}` });
        return {
          index,
          raw,
          status: "risk",
          message: `PMID 多源未找到（疑似错误）。按标题找到接近文献（综合 ${Math.round(best.composite * 100)}%），请核对是否为同一篇。`,
          title: titleHint,
          firstAuthor: authorHint,
          year: yearHint || undefined,
          doi: best.doi,
          sources: best.sources,
          driftFields,
          fieldDiffs,
          fieldChecks,
          links,
          record: best,
          formats: { ...EMPTY_FORMATS },
        };
      }
      return {
        index,
        raw,
        status: "risk",
        message: "提供了 PMID，但多源均未找到对应记录，且标题也无足够接近匹配，疑似错误或虚构 PMID。",
        title: titleHint,
        firstAuthor: authorHint,
        year: yearHint || undefined,
        sources: [],
        driftFields: ["pmid"],
        fieldDiffs,
        links,
        record: null,
        formats: { ...EMPTY_FORMATS },
      };
    }

    sources.push(...resolved.sources);
    if (resolved.doi) links.push({ label: "原文", url: `https://doi.org/${resolved.doi}` });

    // Cited PMID must match resolved (always should for direct lookup)
    if (resolved.pmid && resolved.pmid !== pmidHint) {
      pushDiff(fieldDiffs, driftFields, "pmid", "PMID", pmidHint, resolved.pmid, 0);
    }

    const fieldChecks = compareCitedToResolved(
      fieldDiffs,
      driftFields,
      compareOpts({
        title: resolved.title,
        firstAuthor: resolved.firstAuthor,
        year: resolved.year,
        container: resolved.container,
        volume: resolved.volume,
        issue: resolved.issue,
        pages: resolved.pages,
        pmid: resolved.pmid || pmidHint,
      }),
    );

    const status: CiteStatus = driftFields.length
      ? driftFields.includes("pmid")
        ? "risk"
        : "review"
      : secondHit
        ? "ok"
        : "review";

    return {
      index,
      raw,
      status,
      message: driftFields.length
        ? `PMID 可解析，但字段与库内记录不一致（${driftFields.map(driftLabel).join("、")}），请人工复核。`
        : secondHit
          ? "PMID 有效，多源命中；作者/标题/年份/期刊/卷期页已逐项核对一致。"
          : "PMID 有效；已按医学索引核对字段，建议再对照右侧库内信息。",
      title: resolved.title,
      firstAuthor: resolved.firstAuthor,
      doi: resolved.doi,
      year: resolved.year || yearHint || undefined,
      container: resolved.container,
      sources,
      driftFields,
      fieldDiffs,
      fieldChecks,
      links,
      record: resolved,
      formats: formatsFromRecord(resolved, authorHint),
    };
  }

  // ——— No DOI and no PMID: multi-source bibliographic match ———
  try {
    if (!titleHint || titleHint.length < 12) {
      return {
        index,
        raw,
        status: "insufficient",
        message: "无 DOI/PMID，且无法从引用中提取足够标题，缺少核对锚点。请补 DOI、PMID 或完整题名。",
        year: yearHint || undefined,
        firstAuthor: authorHint,
        sources: [],
        driftFields: [],
        fieldDiffs: [],
        links: [],
        record: null,
        formats: { ...EMPTY_FORMATS },
      };
    }

    const ranked = await searchNoIdCandidates(
      { titleHint, authorHint, yearHint, containerHint: biblioHint.container },
      5,
    );
    const best = ranked[0];

    if (!best || best.composite < 0.55) {
      pushDiff(fieldDiffs, driftFields, "doi", "DOI", "缺失", "未匹配", 0);
      pushDiff(fieldDiffs, driftFields, "title", "标题", titleHint.slice(0, 80), "无接近匹配", 0);
      return {
        index,
        raw,
        status: "risk",
        message: "无 DOI/PMID，且多源（文献库/医学索引/登记库）均未找到足够接近的文献，请核对题名或补上标识符。",
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

    // If match yielded a durable ID, re-resolve for authoritative metadata
    let record: SourceRecord = best;
    let secondHit = best.sources.length > 1;
    if (best.doi) {
      const cr = await lookupCrossrefByDoi(best.doi);
      const oa = await lookupOpenAlexByDoi(best.doi);
      if (cr) {
        record = overlayRecord(record, cr);
        secondHit = true;
      }
      if (oa) {
        record = overlayRecord(record, oa);
        secondHit = true;
      }
    } else if (best.pmid) {
      const byPmid = await resolveByPmid(best.pmid);
      if (byPmid.record) {
        record = overlayRecord(record, byPmid.record);
        secondHit = secondHit || byPmid.secondHit;
      }
    }

    sources.push(...record.sources);
    const resolvedDoi = record.doi;
    const resolvedPmid = record.pmid;

    // Only flag DOI when we still cannot recover one
    if (!resolvedDoi) {
      pushDiff(fieldDiffs, driftFields, "doi", "DOI", "缺失", "仍缺失", 0);
    }

    const fieldChecks = compareCitedToResolved(
      fieldDiffs,
      driftFields,
      compareOpts(
        {
          title: record.title,
          firstAuthor: record.firstAuthor,
          year: record.year,
          container: record.container,
          volume: record.volume,
          issue: record.issue,
          pages: record.pages,
          pmid: record.pmid,
        },
        Boolean(resolvedDoi || resolvedPmid),
      ),
    );

    if (resolvedDoi && !fieldChecks.some((c) => c.field === "doi")) {
      fieldChecks.unshift({
        field: "doi",
        label: "DOI",
        cited: "（引用中无）",
        resolved: resolvedDoi,
        matchScore: 1,
        ok: true,
        citedMissing: true,
      });
    }
    if (resolvedPmid && !fieldChecks.some((c) => c.field === "pmid")) {
      fieldChecks.push({
        field: "pmid",
        label: "PMID",
        cited: "（引用中无）",
        resolved: resolvedPmid,
        matchScore: 1,
        ok: true,
        citedMissing: true,
      });
    }

    if (resolvedDoi) links.push({ label: "原文", url: `https://doi.org/${resolvedDoi}` });
    if (resolvedPmid) links.push({ label: "PubMed", url: `https://pubmed.ncbi.nlm.nih.gov/${resolvedPmid}/` });

    const hasDurableId = Boolean(resolvedDoi || resolvedPmid);
    const titleScore = titleSimilarityScore(titleHint, record.title);
    const strong = best.composite >= 0.82 && titleScore >= 0.85;
    const medium = best.composite >= 0.65;

    let status: CiteStatus;
    if (!driftFields.length && hasDurableId && strong && secondHit) {
      status = "ok";
    } else if (strong || (medium && hasDurableId)) {
      status = "review";
    } else {
      status = "insufficient";
    }
    if (driftFields.length && status === "ok") status = "review";

    return {
      index,
      raw,
      status,
      message:
        status === "ok"
          ? `引用未含 DOI/PMID，已多源匹配到文献并补全标识符；作者/标题/年份/卷期页核对一致（综合 ${Math.round(best.composite * 100)}%）。`
          : status === "review"
            ? `引用未含 DOI/PMID，已按题名等多源匹配（综合 ${Math.round(best.composite * 100)}%）。${
                driftFields.length
                  ? `字段不一致：${driftFields.map(driftLabel).join("、")}。`
                  : hasDurableId
                    ? "已补全库内标识符，请人工确认是否同一篇。"
                    : "未补全可靠标识符，请人工确认。"
              }`
            : `无 DOI/PMID，仅弱匹配到可能相关文献（综合 ${Math.round(best.composite * 100)}%），证据不足。`,
      title: record.title,
      firstAuthor: record.firstAuthor,
      doi: resolvedDoi,
      year: record.year || yearHint || undefined,
      container: record.container,
      sources,
      driftFields,
      fieldDiffs,
      fieldChecks,
      links,
      record,
      formats: status === "insufficient" ? { ...EMPTY_FORMATS } : formatsFromRecord(record, authorHint),
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

export type CitationsSummary = {
  total: number;
  ok: number;
  review: number;
  risk: number;
  insufficient: number;
  driftFields: string[];
  driftCounts: Record<string, number>;
  sources: string[];
  sourceCounts: Record<string, number>;
  reviewIndexes: number[];
};

export type CitationsVerifyResult = {
  results: CiteResult[];
  summary: CitationsSummary;
  truncated: boolean;
};

const MAX_TEXT_CHARS = 30000;
const MAX_REFS = 15;

/** Normalize product/UI input into a reference list (max 15). */
export function normalizeCitationInput(input: {
  text?: string;
  references?: string[];
  reference?: string;
}): { refs: string[]; inputTruncated: boolean } {
  let inputTruncated = false;

  if (Array.isArray(input.references) && input.references.length) {
    const cleaned = input.references.map((r) => String(r || "").trim()).filter((r) => r.length >= 8);
    if (cleaned.length > MAX_REFS) {
      inputTruncated = true;
      return { refs: cleaned.slice(0, MAX_REFS), inputTruncated };
    }
    return { refs: cleaned, inputTruncated };
  }

  if (typeof input.reference === "string" && input.reference.trim()) {
    let t = input.reference.trim();
    if (t.length > MAX_TEXT_CHARS) {
      t = t.slice(0, MAX_TEXT_CHARS);
      inputTruncated = true;
    }
    return { refs: [t], inputTruncated };
  }

  let text = input.text || "";
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    inputTruncated = true;
  }
  const refs = splitReferences(text);
  if (refs.length > MAX_REFS) {
    inputTruncated = true;
    return { refs: refs.slice(0, MAX_REFS), inputTruncated };
  }
  return { refs, inputTruncated };
}

/** Run citation verification for a list of reference strings. */
export async function runCitationsVerify(input: {
  text?: string;
  references?: string[];
  reference?: string;
}): Promise<CitationsVerifyResult> {
  const { refs, inputTruncated } = normalizeCitationInput(input);
  if (!refs.length) {
    throw new Error("请提供至少一条参考文献");
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

  const summary: CitationsSummary = {
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

  return {
    results,
    summary,
    truncated: inputTruncated || refs.length >= MAX_REFS,
  };
}
