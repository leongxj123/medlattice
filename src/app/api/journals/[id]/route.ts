import { NextRequest, NextResponse } from "next/server";
import { CONTACT_EMAIL, encodeQuery, fetchJson } from "@/lib/http";

type OpenAlexSource = {
  id: string;
  display_name?: string;
  issn_l?: string | null;
  issn?: string[] | null;
  host_organization_name?: string | null;
  type?: string | null;
  homepage_url?: string | null;
  works_count?: number;
  cited_by_count?: number;
  is_oa?: boolean | null;
  is_in_doaj?: boolean | null;
  country_code?: string | null;
  summary_stats?: {
    "2yr_mean_citedness"?: number;
    h_index?: number;
    i10_index?: number;
  };
  topics?: Array<{ display_name?: string; count?: number }>;
  abbreviated_title?: string | null;
};

function sourceKey(id: string) {
  return id.includes("/") ? id.split("/").pop() || id : id;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (v) => v,
        () => fallback,
      ),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function wikiExtract(titles: string[]) {
  for (const title of titles) {
    if (!title.trim()) continue;
    try {
      const url = `https://en.wikipedia.org/w/api.php?${encodeQuery({
        action: "query",
        prop: "extracts",
        exintro: "1",
        explaintext: "1",
        format: "json",
        origin: "*",
        redirects: "1",
        titles: title.trim(),
      })}`;
      const data = await fetchJson<{
        query?: { pages?: Record<string, { extract?: string; missing?: boolean; title?: string }> };
      }>(url, { cache: "no-store", timeoutMs: 2200 });
      const page = Object.values(data.query?.pages || {})[0];
      if (!page || page.missing || !page.extract) continue;
      // Skip thin disambiguation stubs
      if (page.extract.length < 80 || /may refer to:/i.test(page.extract)) continue;
      return page.extract.slice(0, 1200);
    } catch {
      /* try next title */
    }
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await ctx.params;
    const id = rawId.startsWith("S") ? rawId : `S${rawId}`;

    const source = await fetchJson<OpenAlexSource>(
      `https://api.openalex.org/sources/${id}?${encodeQuery({ mailto: CONTACT_EMAIL })}`,
      { cache: "no-store", timeoutMs: 8000 },
    );

    const sourceOpenAlexId = source.id.includes("/") ? source.id.split("/").pop()! : id;
    const issn = source.issn_l || source.issn?.[0] || null;
    const topic = source.topics?.[0]?.display_name;
    const displayName = source.display_name || "";

    const currentYear = new Date().getFullYear();
    const yearFrom = currentYear - 19;

    // Parallel enrichments with hard timeouts so the page never hangs
    const [yearSeries, crossrefSamples, wiki, similar] = await Promise.all([
      withTimeout(
        (async () => {
          const grouped = await fetchJson<{
            group_by?: Array<{ key?: string; key_display_name?: string; count?: number }>;
          }>(
            `https://api.openalex.org/works?${encodeQuery({
              filter: `primary_location.source.id:${sourceOpenAlexId},publication_year:${yearFrom}-${currentYear}`,
              group_by: "publication_year",
              "per-page": 50,
              mailto: CONTACT_EMAIL,
            })}`,
            { cache: "no-store", timeoutMs: 6500 },
          );
          const byYear = new Map<string, number>();
          for (const g of grouped.group_by || []) {
            const year = g.key_display_name || g.key || "";
            if (!/^\d{4}$/.test(year)) continue;
            byYear.set(year, g.count || 0);
          }
          // Fill continuous years so the chart axis is stable
          const series: Array<{ year: string; count: number }> = [];
          for (let y = yearFrom; y <= currentYear; y++) {
            const key = String(y);
            series.push({ year: key, count: byYear.get(key) || 0 });
          }
          return series;
        })(),
        7000,
        [] as Array<{ year: string; count: number }>,
      ),
      withTimeout(
        (async () => {
          if (!issn) return [] as Array<{ title: string; doi?: string; year?: number; url?: string }>;
          const cr = await fetchJson<{
            message?: {
              items?: Array<{
                title?: string[];
                DOI?: string;
                issued?: { "date-parts"?: number[][] };
                URL?: string;
                type?: string;
              }>;
            };
          }>(
            `https://api.crossref.org/v1/works?${encodeQuery({
              filter: `issn:${issn},type:journal-article,from-pub-date:${currentYear - 5}`,
              rows: 6,
              sort: "published",
              order: "desc",
              mailto: CONTACT_EMAIL,
            })}`,
            { cache: "no-store", timeoutMs: 5000 },
          );
          let items = cr.message?.items || [];
          // Fallback without date filter if empty
          if (!items.length) {
            const cr2 = await fetchJson<{
              message?: { items?: typeof items };
            }>(
              `https://api.crossref.org/v1/works?${encodeQuery({
                filter: `issn:${issn},type:journal-article`,
                rows: 6,
                sort: "published",
                order: "desc",
                mailto: CONTACT_EMAIL,
              })}`,
              { cache: "no-store", timeoutMs: 5000 },
            );
            items = cr2.message?.items || [];
          }
          return items.map((it) => ({
            title: it.title?.[0] || "Untitled",
            doi: it.DOI,
            year: it.issued?.["date-parts"]?.[0]?.[0],
            url: it.URL || (it.DOI ? `https://doi.org/${it.DOI}` : undefined),
          }));
        })(),
        6000,
        [] as Array<{ title: string; doi?: string; year?: number; url?: string }>,
      ),
      withTimeout(
        wikiExtract([
          `${displayName} (journal)`,
          displayName,
          source.abbreviated_title || "",
        ]),
        2500,
        null as string | null,
      ),
      withTimeout(
        (async () => {
          if (!topic) return [] as Array<{ id: string; name: string; meanCitedness2yr: number | null; worksCount: number }>;
          const sim = await fetchJson<{ results: OpenAlexSource[] }>(
            `https://api.openalex.org/sources?${encodeQuery({
              search: topic,
              filter: "type:journal",
              per_page: 8,
              mailto: CONTACT_EMAIL,
            })}`,
            { cache: "no-store", timeoutMs: 4500 },
          );
          return (sim.results || [])
            .filter((s) => sourceKey(s.id) !== sourceOpenAlexId)
            .slice(0, 5)
            .map((s) => ({
              id: sourceKey(s.id),
              name: s.display_name || "Untitled",
              meanCitedness2yr: s.summary_stats?.["2yr_mean_citedness"] ?? null,
              worksCount: s.works_count || 0,
            }));
        })(),
        5000,
        [] as Array<{ id: string; name: string; meanCitedness2yr: number | null; worksCount: number }>,
      ),
    ]);

    const sourcesUsed = ["api.openalex.org"];
    if (crossrefSamples.length) sourcesUsed.push("api.crossref.org");
    if (wiki) sourcesUsed.push("en.wikipedia.org");

    return NextResponse.json({
      live: true,
      sourcesUsed,
      journal: {
        id: sourceOpenAlexId,
        name: source.display_name,
        abbr: source.abbreviated_title || null,
        issn,
        issnList: source.issn || [],
        publisher: source.host_organization_name || null,
        homepage: source.homepage_url || null,
        country: source.country_code || null,
        worksCount: source.works_count || 0,
        citedByCount: source.cited_by_count || 0,
        isOa: Boolean(source.is_oa),
        isInDoaj: Boolean(source.is_in_doaj),
        meanCitedness2yr: source.summary_stats?.["2yr_mean_citedness"] ?? null,
        hIndex: source.summary_stats?.h_index ?? null,
        i10Index: source.summary_stats?.i10_index ?? null,
        topics: (source.topics || []).slice(0, 8).map((t) => t.display_name).filter(Boolean),
        wikipediaExtract: wiki,
        yearSeries,
        crossrefSamples,
        similar,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "期刊详情失败", live: false },
      { status: 500 },
    );
  }
}
