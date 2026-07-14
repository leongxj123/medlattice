import { NextRequest, NextResponse } from "next/server";
import {
  detectEvidenceTags,
  enrichPaperLinks,
  isGarbageAbstract,
  pubmedAbstracts,
  pubmedSearchMeta,
  pubmedSummaries,
  semanticScholarGet,
  semanticScholarSearch,
  type JournalMetrics,
  type S2Paper,
} from "@/lib/http";

type PaperResult = {
  id: string;
  title: string;
  year: number | null;
  cited: number;
  authors: string;
  venue?: string;
  doi: string | null;
  pmid: string | null;
  abstract?: string;
  evidence?: string[];
  isOa?: boolean;
  source: "semantic-scholar" | "pubmed";
  url?: string;
  journal?: JournalMetrics | null;
  oaPdfUrl?: string;
  oaLandingUrl?: string;
  europePmcUrl?: string;
};

function fromS2(p: S2Paper): PaperResult {
  const title = p.title || "Untitled";
  const abstract = (p.abstract || p.tldr?.text || "").slice(0, 2500);
  const doi = p.externalIds?.DOI || null;
  const pmid = p.externalIds?.PubMed || null;
  return {
    id: `s2:${p.paperId}`,
    title,
    year: p.year ?? null,
    cited: p.citationCount || 0,
    authors: (p.authors || [])
      .slice(0, 5)
      .map((a) => a.name)
      .filter(Boolean)
      .join(", ") || "—",
    venue: p.venue || undefined,
    doi,
    pmid,
    abstract,
    evidence: detectEvidenceTags({
      title,
      type: (p.publicationTypes || []).join(" "),
      abstract,
    }),
    isOa: Boolean(p.isOpenAccess || p.openAccessPdf?.url),
    source: "semantic-scholar",
    url: p.url || (doi ? `https://doi.org/${doi}` : undefined),
    oaPdfUrl: p.openAccessPdf?.url || undefined,
  };
}

async function enrichResults(results: PaperResult[], limit = 15) {
  const targets = results.slice(0, limit);
  const extras = await Promise.all(
    targets.map(async (r) => {
      if (!r.doi && !r.pmid) return r;
      const needAbstract = isGarbageAbstract(r.abstract);
      const e = await enrichPaperLinks({ doi: r.doi, pmid: r.pmid, needAbstract });
      const cited =
        r.source === "pubmed" && typeof e.openAlexCited === "number" ? e.openAlexCited : r.cited;
      const abstract = needAbstract && e.abstract ? e.abstract : r.abstract || e.abstract || "";
      return {
        ...r,
        cited,
        title: r.title && r.title !== "Untitled" ? r.title : e.title || r.title,
        abstract,
        journal: e.journal || r.journal || null,
        oaPdfUrl: e.oaPdfUrl || r.oaPdfUrl,
        oaLandingUrl: e.oaLandingUrl || r.oaLandingUrl,
        europePmcUrl: e.europePmcUrl || r.europePmcUrl,
        isOa: Boolean(r.isOa || e.oaPdfUrl || e.oaLandingUrl || e.journal?.isOa),
        venue: r.venue || e.journal?.sourceName || undefined,
        evidence: detectEvidenceTags({ title: r.title, abstract }),
      };
    }),
  );
  return [...extras, ...results.slice(limit)];
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim();
    if (!q) {
      return NextResponse.json({ error: "请输入关键词、DOI 或 PMID", results: [], total: 0 }, { status: 400 });
    }

    const sort = sp.get("sort") || "relevance";
    const since = sp.get("since") || "";
    const oaOnly = sp.get("oa") === "1";
    const page = Math.max(1, Number(sp.get("page") || 1));
    const perPage = Math.min(20, Math.max(5, Number(sp.get("perPage") || 12)));
    const offset = (page - 1) * perPage;

    const enrichmentSources = new Set<string>();

    // Direct DOI / PMID via Semantic Scholar first, then PubMed
    if (/^10\.\d{4,}\/\S+/i.test(q) || /^PMID[:\s]*/i.test(q) || (/^[0-9]{5,9}$/.test(q) && q.length >= 7)) {
      let results: PaperResult[] = [];
      try {
        const paper = await semanticScholarGet(q);
        results.push(fromS2(paper));
      } catch {
        /* try pubmed */
      }

      if (!results.length) {
        const pmid = q.replace(/^PMID[:\s]*/i, "");
        if (/^\d{5,9}$/.test(pmid) || /pmid/i.test(q)) {
          const summaries = await pubmedSummaries([pmid.replace(/\D/g, "")]);
          const abs = await pubmedAbstracts(summaries.map((s) => s.pmid));
          for (const s of summaries) {
            results.push({
              id: `pmid:${s.pmid}`,
              title: s.title,
              year: s.pubdate ? Number(String(s.pubdate).slice(0, 4)) || null : null,
              cited: 0,
              authors: s.authors || "—",
              venue: s.source,
              doi: s.doi || null,
              pmid: s.pmid,
              abstract: abs[s.pmid] || "",
              evidence: detectEvidenceTags({ title: s.title, abstract: abs[s.pmid] }),
              isOa: false,
              source: "pubmed",
              url: `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`,
            });
          }
        } else if (/^10\./.test(q)) {
          const meta = await pubmedSearchMeta(`${q}[doi]`, 5, 0);
          const summaries = await pubmedSummaries(meta.ids);
          const abs = await pubmedAbstracts(meta.ids);
          for (const s of summaries) {
            results.push({
              id: `pmid:${s.pmid}`,
              title: s.title,
              year: s.pubdate ? Number(String(s.pubdate).slice(0, 4)) || null : null,
              cited: 0,
              authors: s.authors || "—",
              venue: s.source,
              doi: s.doi || q,
              pmid: s.pmid,
              abstract: abs[s.pmid] || "",
              evidence: detectEvidenceTags({ title: s.title }),
              isOa: false,
              source: "pubmed",
              url: `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`,
            });
          }
        }
      }

      results = await enrichResults(results, 10);
      if (results.some((r) => r.journal)) enrichmentSources.add("api.openalex.org");
      if (results.some((r) => r.oaPdfUrl || r.oaLandingUrl)) {
        enrichmentSources.add("api.unpaywall.org");
        enrichmentSources.add("www.ebi.ac.uk/europepmc");
      }

      return NextResponse.json({
        live: true,
        q,
        total: results.length,
        page: 1,
        sourcesUsed: ["api.semanticscholar.org", "eutils.ncbi.nlm.nih.gov", ...enrichmentSources],
        metricsNote: "期刊指标为公开学术统计（2yr mean citedness / h-index），不是 Clarivate JIF / 中科院分区。",
        results,
      });
    }

    const yearFilter = since ? `${since}-` : undefined;

    const [s2Settled, pmSettled] = await Promise.allSettled([
      semanticScholarSearch({
        query: q,
        offset,
        limit: perPage,
        year: yearFilter,
        openAccessPdf: oaOnly,
        fieldsOfStudy: "Medicine,Biology",
      }),
      pubmedSearchMeta(since ? `(${q}) AND (${since}:3000[dp])` : q, perPage, offset),
    ]);

    let s2Results: PaperResult[] = [];
    let s2Total = 0;
    let s2Warning: string | null = null;
    if (s2Settled.status === "fulfilled") {
      s2Total = s2Settled.value.total || 0;
      s2Results = (s2Settled.value.data || []).map(fromS2);
    } else {
      s2Warning = String(s2Settled.reason?.message || s2Settled.reason || "Semantic Scholar 暂不可用");
    }

    let pmResults: PaperResult[] = [];
    let pmTotal = 0;
    let pmWarning: string | null = null;
    if (pmSettled.status === "fulfilled") {
      pmTotal = pmSettled.value.count;
      const summaries = await pubmedSummaries(pmSettled.value.ids);
      const abs = await pubmedAbstracts(pmSettled.value.ids);
      pmResults = summaries.map((s) => {
        const abstract = abs[s.pmid] || "";
        return {
          id: `pmid:${s.pmid}`,
          title: s.title,
          year: s.pubdate ? Number(String(s.pubdate).slice(0, 4)) || null : null,
          cited: 0,
          authors: s.authors || "—",
          venue: s.source,
          doi: s.doi || null,
          pmid: s.pmid,
          abstract,
          evidence: detectEvidenceTags({ title: s.title, abstract }),
          isOa: false,
          source: "pubmed" as const,
          url: `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`,
        };
      });
    } else {
      pmWarning = String(pmSettled.reason?.message || pmSettled.reason || "PubMed 暂不可用");
    }

    const seen = new Set<string>();
    let merged: PaperResult[] = [];
    const keyOf = (r: PaperResult) =>
      (r.doi && `doi:${r.doi.toLowerCase()}`) || (r.pmid && `pmid:${r.pmid}`) || r.id;

    const maxLen = Math.max(s2Results.length, pmResults.length);
    for (let i = 0; i < maxLen; i++) {
      for (const r of [s2Results[i], pmResults[i]]) {
        if (!r) continue;
        const k = keyOf(r);
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(r);
      }
    }

    if (sort === "citations") {
      merged.sort((a, b) => b.cited - a.cited);
    } else if (sort === "date") {
      merged.sort((a, b) => (b.year || 0) - (a.year || 0));
    }

    merged = await enrichResults(merged, Math.min(merged.length, perPage));
    if (merged.some((r) => r.journal)) enrichmentSources.add("api.openalex.org");
    if (merged.some((r) => r.oaPdfUrl || r.oaLandingUrl || r.europePmcUrl)) {
      enrichmentSources.add("api.unpaywall.org");
      enrichmentSources.add("www.ebi.ac.uk/europepmc");
    }

    if (oaOnly) {
      const oaFiltered = merged.filter((r) => r.isOa || r.oaPdfUrl || r.oaLandingUrl);
      merged = oaFiltered;
    }

    const sourcesUsed = [
      s2Settled.status === "fulfilled" ? "api.semanticscholar.org" : null,
      pmSettled.status === "fulfilled" ? "eutils.ncbi.nlm.nih.gov" : null,
      ...enrichmentSources,
    ].filter(Boolean) as string[];

    if (!merged.length) {
      const errBits = [
        s2Settled.status === "rejected" ? `Semantic Scholar: ${String(s2Settled.reason?.message || s2Settled.reason)}` : null,
        pmSettled.status === "rejected" ? `PubMed: ${String(pmSettled.reason?.message || pmSettled.reason)}` : null,
      ].filter(Boolean);
      return NextResponse.json(
        {
          error: errBits.length
            ? errBits.join("；")
            : oaOnly
              ? "未找到可确认 OA 的论文"
              : "未找到相关论文",
          results: [],
          total: 0,
          sourcesUsed,
          warning: s2Warning,
        },
        { status: errBits.length ? 502 : 200 },
      );
    }

    const warnings = [s2Warning, pmWarning].filter(Boolean) as string[];
    return NextResponse.json({
      live: true,
      q,
      total: oaOnly ? merged.length : Math.max(s2Total, pmTotal, merged.length),
      page,
      s2Total,
      pubmedTotal: pmTotal,
      sourcesUsed: [...new Set(sourcesUsed)],
      warning: warnings.length ? warnings.join("；") : null,
      metricsNote: "期刊指标为公开学术统计（2yr mean citedness / h-index），不是 Clarivate JIF / 中科院分区。",
      results: merged,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "检索失败", results: [], total: 0 },
      { status: 500 },
    );
  }
}
