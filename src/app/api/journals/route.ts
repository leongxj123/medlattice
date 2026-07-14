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
  summary_stats?: {
    "2yr_mean_citedness"?: number;
    h_index?: number;
    i10_index?: number;
  };
  topics?: Array<{ display_name?: string; count?: number }>;
};

function sourceKey(id: string) {
  return id.includes("/") ? id.split("/").pop() || id : id;
}

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q")?.trim();
    if (!q) {
      return NextResponse.json({ error: "请输入期刊名或 ISSN", results: [], live: false }, { status: 400 });
    }
    const medicineBias = "medicine OR clinical OR biomedical OR oncology OR immunology OR cardiology";

    const search = await fetchJson<{ results: OpenAlexSource[] }>(
      `https://api.openalex.org/sources?${encodeQuery({
        search: q,
        filter: "type:journal",
        per_page: 15,
        mailto: CONTACT_EMAIL,
      })}`,
    );

    // If empty, retry with medicine-biased query
    let results = search.results || [];
    if (!results.length) {
      const retry = await fetchJson<{ results: OpenAlexSource[] }>(
        `https://api.openalex.org/sources?${encodeQuery({
          search: `${q} ${medicineBias}`,
          filter: "type:journal",
          per_page: 15,
          mailto: CONTACT_EMAIL,
        })}`,
      );
      results = retry.results || [];
    }

    return NextResponse.json({
      live: true,
      source: "api.openalex.org",
      q,
      results: results.map((s) => ({
        id: sourceKey(s.id),
        openalexId: s.id,
        name: s.display_name || "Untitled journal",
        issn: s.issn_l || s.issn?.[0] || null,
        issnList: s.issn || [],
        publisher: s.host_organization_name || null,
        type: s.type || "journal",
        homepage: s.homepage_url || null,
        worksCount: s.works_count || 0,
        citedByCount: s.cited_by_count || 0,
        isOa: Boolean(s.is_oa || s.is_in_doaj),
        meanCitedness2yr: s.summary_stats?.["2yr_mean_citedness"] ?? null,
        hIndex: s.summary_stats?.h_index ?? null,
        i10Index: s.summary_stats?.i10_index ?? null,
        topics: (s.topics || []).slice(0, 5).map((t) => t.display_name).filter(Boolean),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "期刊检索失败", live: false },
      { status: 500 },
    );
  }
}
