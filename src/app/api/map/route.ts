import { NextRequest, NextResponse } from "next/server";
import {
  CONTACT_EMAIL,
  detectEvidenceTags,
  encodeQuery,
  fetchJson,
  openAlexId,
  reconstructAbstract,
  resolveWorkQuery,
  stripDoi,
  workAuthors,
  workTitle,
  type OpenAlexWork,
} from "@/lib/http";

type Node = {
  id: string;
  title: string;
  year: number | null;
  cited: number;
  authors: string;
  venue?: string;
  doi?: string | null;
  pmid?: string | null;
  abstract?: string;
  evidence: string[];
  isOa?: boolean;
  x: number;
  y: number;
  isSeed?: boolean;
  refs?: number;
  relation?: "seed" | "related" | "reference" | "cited-by";
};

function layoutNodes(seed: Node, neighbors: Omit<Node, "x" | "y">[]): Node[] {
  const nodes: Node[] = [{ ...seed, x: 500, y: 270 }];
  const n = Math.max(neighbors.length, 1);
  neighbors.forEach((work, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const radius = 155 + (i % 4) * 30;
    nodes.push({
      ...work,
      x: 500 + Math.cos(angle) * radius,
      y: 270 + Math.sin(angle) * radius * 0.82,
    });
  });
  return nodes;
}

function toNode(
  work: OpenAlexWork,
  opts: { isSeed?: boolean; relation?: Node["relation"] } = {},
): Omit<Node, "x" | "y"> {
  const abstract = reconstructAbstract(work.abstract_inverted_index).slice(0, 800);
  const pmid = work.ids?.pmid?.replace("https://pubmed.ncbi.nlm.nih.gov/", "").replace(/\D/g, "") || null;
  return {
    id: openAlexId(work.id),
    title: workTitle(work),
    year: work.publication_year || null,
    cited: work.cited_by_count || 0,
    authors: workAuthors(work, 5),
    venue: work.primary_location?.source?.display_name || undefined,
    doi: stripDoi(work.doi || work.ids?.doi),
    pmid,
    abstract,
    evidence: detectEvidenceTags({
      title: workTitle(work),
      type: work.type,
      type_crossref: work.type_crossref,
      abstract,
    }),
    isOa: Boolean(work.open_access?.is_oa),
    isSeed: opts.isSeed,
    refs: work.referenced_works?.length || 0,
    relation: opts.relation || (opts.isSeed ? "seed" : "related"),
  };
}

async function fetchWorkSafe(id: string) {
  try {
    const wid = id.startsWith("W") ? id : `W${id}`;
    return await fetchJson<OpenAlexWork>(
      `https://api.openalex.org/works/${wid}?${encodeQuery({ mailto: CONTACT_EMAIL })}`,
    );
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q")?.trim();
    if (!q) return NextResponse.json({ error: "请提供 DOI / PMID / 标题" }, { status: 400 });

    const seed = await resolveWorkQuery(q);
    if (!seed) return NextResponse.json({ error: "未找到相关论文" }, { status: 404 });

    const seedId = openAlexId(seed.id);
    const relatedIds = (seed.related_works || []).slice(0, 10).map(openAlexId);
    const refIds = (seed.referenced_works || []).slice(0, 8).map(openAlexId);

    // Cited-by via OpenAlex filter
    let citedByIds: string[] = [];
    try {
      const cited = await fetchJson<{ results: OpenAlexWork[] }>(
        `https://api.openalex.org/works?${encodeQuery({
          filter: `cites:${seedId.startsWith("W") ? seedId : `W${seedId}`}`,
          sort: "cited_by_count:desc",
          per_page: 8,
          mailto: CONTACT_EMAIL,
        })}`,
      );
      citedByIds = (cited.results || []).map((w) => openAlexId(w.id));
    } catch {
      citedByIds = [];
    }

    const neighborPlan: Array<{ id: string; relation: Node["relation"] }> = [
      ...relatedIds.map((id) => ({ id, relation: "related" as const })),
      ...refIds.map((id) => ({ id, relation: "reference" as const })),
      ...citedByIds.map((id) => ({ id, relation: "cited-by" as const })),
    ];

    const seen = new Set<string>([seedId]);
    const uniquePlan = neighborPlan.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    }).slice(0, 20);

    const neighborsRaw = (
      await Promise.all(
        uniquePlan.map(async (p) => {
          const work = await fetchWorkSafe(p.id);
          return work ? { work, relation: p.relation } : null;
        }),
      )
    ).filter(Boolean) as Array<{ work: OpenAlexWork; relation: Node["relation"] }>;
    const neighborFailed = uniquePlan.length - neighborsRaw.length;

    const seedNode = toNode(seed, { isSeed: true, relation: "seed" });
    const neighborNodes = neighborsRaw
      .map(({ work, relation }) => toNode(work, { relation }))
      .sort((a, b) => b.cited - a.cited);

    const nodes = layoutNodes({ ...seedNode, x: 500, y: 270 }, neighborNodes);
    const edges = neighborNodes.map((n) => ({
      source: seedNode.id,
      target: n.id,
      relation: n.relation,
    }));

    return NextResponse.json({
      live: true,
      mode: neighborNodes.length >= 4 ? "citation-neighborhood" : "sparse-neighborhood",
      seedTitle: `${seedNode.title}${seedNode.year ? ` (${seedNode.year})` : ""}`,
      seed: nodes.find((n) => n.isSeed),
      nodes,
      edges,
      warning:
        neighborFailed > 0
          ? `有 ${neighborFailed} 个邻居节点未能加载（上游超时或限流）`
          : null,
      stats: {
        nodes: nodes.length,
        edges: edges.length,
        related: neighborNodes.filter((n) => n.relation === "related").length,
        references: neighborNodes.filter((n) => n.relation === "reference").length,
        citedBy: neighborNodes.filter((n) => n.relation === "cited-by").length,
        neighborFailed,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "图谱构建失败，请稍后重试" },
      { status: 500 },
    );
  }
}
