import { NextRequest, NextResponse } from "next/server";
import {
  CONTACT_EMAIL,
  detectEvidenceTags,
  encodeQuery,
  fetchJson,
  pubmedSearchIds,
  pubmedSummaries,
  reconstructAbstract,
  stripDoi,
  workAuthors,
  workTitle,
  type OpenAlexWork,
} from "@/lib/http";

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q")?.trim();
    if (!q || q.length < 2) return NextResponse.json({ results: [] });

    // Direct DOI / PMID shortcuts
    if (/^10\.\d{4,}\/\S+/i.test(q) || /^PMID[:\s]*/i.test(q) || /^[0-9]{5,9}$/.test(q)) {
      try {
        const path = /^10\./.test(q)
          ? `doi:${encodeURIComponent(q)}`
          : `pmid:${encodeURIComponent(q.replace(/^PMID[:\s]*/i, ""))}`;
        const work = await fetchJson<OpenAlexWork>(
          `https://api.openalex.org/works/${path}?${encodeQuery({ mailto: CONTACT_EMAIL })}`,
        );
        const abstract = reconstructAbstract(work.abstract_inverted_index).slice(0, 280);
        return NextResponse.json({
          results: [
            {
              id: work.id,
              title: workTitle(work),
              year: work.publication_year,
              cited: work.cited_by_count || 0,
              authors: workAuthors(work),
              venue: work.primary_location?.source?.display_name,
              doi: stripDoi(work.doi),
              pmid: work.ids?.pmid?.replace(/\D/g, "") || null,
              evidence: detectEvidenceTags({
                title: workTitle(work),
                type: work.type,
                abstract,
              }),
            },
          ],
        });
      } catch {
        /* fall through to search */
      }
    }

    const search = await fetchJson<{ results: OpenAlexWork[] }>(
      `https://api.openalex.org/works?${encodeQuery({
        search: q,
        per_page: 8,
        mailto: CONTACT_EMAIL,
      })}`,
    );

    let results = (search.results || []).map((work) => {
      const abstract = reconstructAbstract(work.abstract_inverted_index).slice(0, 280);
      return {
        id: work.id,
        title: workTitle(work),
        year: work.publication_year,
        cited: work.cited_by_count || 0,
        authors: workAuthors(work),
        venue: work.primary_location?.source?.display_name,
        doi: stripDoi(work.doi),
        pmid: work.ids?.pmid?.replace(/\D/g, "") || null,
        evidence: detectEvidenceTags({
          title: workTitle(work),
          type: work.type,
          abstract,
        }),
      };
    });

    // If thin results, supplement with PubMed IDs → OpenAlex
    if (results.length < 3) {
      try {
        const pmids = await pubmedSearchIds(q, 5);
        const summaries = await pubmedSummaries(pmids);
        const extras = summaries
          .filter((s) => !results.some((r) => r.pmid === s.pmid))
          .map((s) => ({
            id: `pmid:${s.pmid}`,
            title: s.title,
            year: s.pubdate ? Number(String(s.pubdate).slice(0, 4)) || undefined : undefined,
            cited: 0,
            authors: s.authors || "—",
            venue: s.source,
            doi: null as string | null,
            pmid: s.pmid,
            evidence: detectEvidenceTags({ title: s.title }),
          }));
        results = [...results, ...extras].slice(0, 10);
      } catch {
        /* optional */
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "搜索失败", results: [] },
      { status: 500 },
    );
  }
}
