import { NextRequest, NextResponse } from "next/server";
import { CURATED_DATASETS } from "@/data/datasets";
import {
  CONTACT_EMAIL,
  encodeQuery,
  fetchJson,
  geoDatasetsSearch,
  omicsdiSearch,
  openFdaEventSearch,
  workAuthors,
  workTitle,
  type OpenAlexWork,
} from "@/lib/http";

type Hit = {
  id: string;
  kind: "data" | "paper" | "trial";
  tag: string;
  title: string;
  authors: string;
  venue?: string;
  year: number | null;
  doi: string | null;
  cited: number | null;
  url: string;
  downloadable?: boolean;
  domain?: string[];
  description?: string;
  license?: string;
};

function yearFromIso(s?: string | null) {
  if (!s) return null;
  const y = Number(String(s).slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : null;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim();
    if (!q) {
      return NextResponse.json({ error: "请输入检索关键词", hits: [], total: 0 }, { status: 400 });
    }
    const sort = sp.get("sort") || "relevance";
    const type = sp.get("type") || "all";
    const since = sp.get("since");
    const needle = q.toLowerCase();
    const sourcesUsed: string[] = [];
    const sourcesFailed: string[] = [];

    const curated: Hit[] = CURATED_DATASETS.filter((d) => {
      const blob = `${d.title} ${d.description} ${d.domain.join(" ")} ${d.source}`.toLowerCase();
      return needle.split(/\s+/).some((part: string) => part && blob.includes(part));
    }).map((d) => ({
      id: d.id,
      kind: "data" as const,
      tag: "BOOKMARK",
      title: d.title,
      authors: d.source,
      venue: "本地书签索引（跳转真实门户）",
      year: null,
      doi: null,
      cited: null,
      url: d.url,
      downloadable: d.downloadable,
      domain: d.domain,
      description: d.description,
      license: d.license,
    }));

    const wantData = type === "all" || type === "data";
    const wantPaper = type === "all" || type === "paper" || type === "data";
    const wantTrial = type === "all" || type === "trial";

    const [oaSettled, ctSettled, dcSettled, omicsSettled, geoSettled, fdaSettled] = await Promise.allSettled([
      wantPaper
        ? (async () => {
            const filterParts = ["type:article|dataset"];
            if (since) filterParts.push(`from_publication_date:${since}-01-01`);
            const sortParam =
              sort === "citations" ? "cited_by_count:desc" : sort === "date" ? "publication_date:desc" : undefined;
            return fetchJson<{ results: OpenAlexWork[] }>(
              `https://api.openalex.org/works?${encodeQuery({
                search: `${q} medicine OR clinical OR biomedical OR dataset`,
                filter: filterParts.join(","),
                per_page: 12,
                sort: sortParam,
                mailto: CONTACT_EMAIL,
              })}`,
              { cache: "no-store", timeoutMs: 10000 },
            );
          })()
        : Promise.resolve(null),
      wantTrial
        ? fetchJson<{
            studies?: Array<{
              protocolSection?: {
                identificationModule?: { nctId?: string; briefTitle?: string };
                statusModule?: { overallStatus?: string; startDateStruct?: { date?: string } };
                conditionsModule?: { conditions?: string[] };
                sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
              };
            }>;
          }>(
            `https://clinicaltrials.gov/api/v2/studies?${encodeQuery({
              "query.term": q,
              pageSize: 10,
              format: "json",
            })}`,
            { cache: "no-store", timeoutMs: 8000 },
          )
        : Promise.resolve(null),
      wantData
        ? fetchJson<{
            data?: Array<{
              id: string;
              attributes?: {
                titles?: Array<{ title?: string }>;
                publisher?: string;
                descriptions?: Array<{ description?: string }>;
                url?: string;
                publicationYear?: number;
                types?: { resourceTypeGeneral?: string };
              };
            }>;
          }>(
            `https://api.datacite.org/dois?${encodeQuery({
              query: `${q} (medicine OR clinical OR biomedical OR dataset)`,
              "page[size]": 8,
            })}`,
            { cache: "no-store", timeoutMs: 7000 },
          )
        : Promise.resolve(null),
      wantData ? omicsdiSearch(q, 10) : Promise.resolve(null),
      wantData ? geoDatasetsSearch(`${q} AND (gds[Entry Type] OR gse[Entry Type])`, 8) : Promise.resolve(null),
      wantData ? openFdaEventSearch(q, 6) : Promise.resolve(null),
    ]);

    let papers: Hit[] = [];
    if (oaSettled.status === "fulfilled" && oaSettled.value) {
      sourcesUsed.push("api.openalex.org");
      papers = (oaSettled.value.results || []).map((w) => {
        const doi = w.doi ? w.doi.replace("https://doi.org/", "") : null;
        const isDataset = (w.type || "").includes("dataset");
        return {
          id: w.id,
          kind: isDataset ? ("data" as const) : ("paper" as const),
          tag: isDataset ? "DATA" : "PAPER",
          title: workTitle(w),
          authors: workAuthors(w, 4) || "—",
          venue: w.primary_location?.source?.display_name || undefined,
          year: w.publication_year || null,
          doi,
          cited: w.cited_by_count || 0,
          url: doi ? `https://doi.org/${doi}` : w.id,
          description: isDataset ? "OpenAlex dataset/work" : undefined,
        };
      });
    } else if (wantPaper && oaSettled.status === "rejected") {
      sourcesFailed.push("api.openalex.org");
    }

    let trials: Hit[] = [];
    if (ctSettled.status === "fulfilled" && ctSettled.value) {
      sourcesUsed.push("clinicaltrials.gov");
      trials = (ctSettled.value.studies || []).map((s) => {
        const id = s.protocolSection?.identificationModule?.nctId || `trial-${Math.random().toString(36).slice(2, 8)}`;
        const start = s.protocolSection?.statusModule?.startDateStruct?.date;
        return {
          id,
          kind: "trial" as const,
          tag: "TRIAL",
          title: s.protocolSection?.identificationModule?.briefTitle || "Untitled trial",
          authors: s.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name || "ClinicalTrials.gov",
          venue: "ClinicalTrials.gov",
          year: yearFromIso(start),
          doi: null,
          cited: null,
          url: `https://clinicaltrials.gov/study/${id}`,
          description: s.protocolSection?.statusModule?.overallStatus,
          domain: s.protocolSection?.conditionsModule?.conditions?.slice(0, 3),
        };
      });
    } else if (wantTrial && ctSettled.status === "rejected") {
      sourcesFailed.push("clinicaltrials.gov");
    }

    let datacite: Hit[] = [];
    if (dcSettled.status === "fulfilled" && dcSettled.value) {
      sourcesUsed.push("api.datacite.org");
      datacite = (dcSettled.value.data || []).map((item) => ({
        id: item.id,
        kind: "data" as const,
        tag: "DATA",
        title: item.attributes?.titles?.[0]?.title || item.id,
        authors: item.attributes?.publisher || "DataCite",
        venue: item.attributes?.types?.resourceTypeGeneral || "DataCite",
        year: item.attributes?.publicationYear || null,
        doi: item.id,
        cited: null,
        url: item.attributes?.url || `https://doi.org/${item.id}`,
        downloadable: true,
        description: item.attributes?.descriptions?.[0]?.description?.slice(0, 240),
      }));
    } else if (wantData && dcSettled.status === "rejected") {
      sourcesFailed.push("api.datacite.org");
    }

    let omics: Hit[] = [];
    if (omicsSettled.status === "fulfilled" && omicsSettled.value) {
      sourcesUsed.push("www.omicsdi.org");
      omics = (omicsSettled.value.datasets || []).map((d) => ({
        id: `omicsdi:${d.source}:${d.id}`,
        kind: "data" as const,
        tag: "OMICS",
        title: d.title || d.id,
        authors: d.source || "OmicsDI",
        venue: (d.omics_type || []).join(", ") || "OmicsDI",
        year: yearFromIso(d.publicationDate),
        doi: null,
        cited: null,
        url: `https://www.omicsdi.org/dataset/${encodeURIComponent(d.source)}/${encodeURIComponent(d.id)}`,
        downloadable: true,
        domain: d.organisms?.slice(0, 3),
        description: d.description?.slice(0, 240),
      }));
    } else if (wantData && omicsSettled.status === "rejected") {
      sourcesFailed.push("www.omicsdi.org");
    }

    let geo: Hit[] = [];
    if (geoSettled.status === "fulfilled" && geoSettled.value) {
      sourcesUsed.push("eutils.ncbi.nlm.nih.gov/gds");
      geo = (geoSettled.value.items || []).map((item) => {
        const acc = item.gse ? `GSE${item.gse}`.replace(/^GSEGSE/, "GSE") : `UID${item.id}`;
        return {
          id: `geo:${item.id}`,
          kind: "data" as const,
          tag: "GEO",
          title: item.title,
          authors: "NCBI GEO",
          venue: item.taxon || "GEO DataSets",
          year: yearFromIso(item.pdat),
          doi: null,
          cited: null,
          url: item.gse
            ? `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE${String(item.gse).replace(/^GSE/i, "")}`
            : `https://www.ncbi.nlm.nih.gov/gds/?term=${item.id}[UID]`,
          downloadable: true,
          description: item.summary,
          domain: acc ? [acc] : undefined,
        };
      });
    } else if (wantData && geoSettled.status === "rejected") {
      sourcesFailed.push("eutils.ncbi.nlm.nih.gov/gds");
    }

    let fda: Hit[] = [];
    if (fdaSettled.status === "fulfilled" && fdaSettled.value) {
      sourcesUsed.push("api.fda.gov");
      const qLower = q.toLowerCase();
      fda = (fdaSettled.value.results || []).map((r, i) => {
        const drugNames = (r.patient?.drug || [])
          .map((d) => d.medicinalproduct)
          .filter((x): x is string => Boolean(x));
        const matched = drugNames.find((n) => n.toLowerCase().includes(qLower.split(/\s+/)[0] || qLower));
        const drugs = (matched ? [matched, ...drugNames.filter((n) => n !== matched)] : drugNames)
          .slice(0, 3)
          .join(", ");
        const reactions = (r.patient?.reaction || [])
          .map((x) => x.reactionmeddrapt)
          .filter(Boolean)
          .slice(0, 4)
          .join(", ");
        const sid = r.safetyreportid || `fda-${i}`;
        return {
          id: `fda:${sid}`,
          kind: "data" as const,
          tag: "FDA",
          title: drugs ? `openFDA AE · ${drugs}` : `openFDA safety report ${sid}`,
          authors: "U.S. FDA openFDA",
          venue: "Drug Adverse Event",
          year: yearFromIso(r.receivedate),
          doi: null,
          cited: null,
          url: `https://api.fda.gov/drug/event.json?search=safetyreportid:${encodeURIComponent(sid)}`,
          downloadable: true,
          description: reactions
            ? `Reactions: ${reactions}（打开为 openFDA JSON 记录）`
            : "Drug adverse event report metadata（打开为 openFDA JSON 记录）",
        };
      });
    } else if (wantData && fdaSettled.status === "rejected") {
      sourcesFailed.push("api.fda.gov");
    }

    const seen = new Set<string>();
    const keyOf = (h: Hit) =>
      (h.doi && `doi:${h.doi.toLowerCase()}`) ||
      (h.url && `url:${h.url.toLowerCase()}`) ||
      h.id;

    let hits: Hit[] = [...omics, ...geo, ...fda, ...datacite, ...papers, ...trials, ...curated].filter((h) => {
      const k = keyOf(h);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (since) hits = hits.filter((h) => !h.year || h.year >= Number(since));

    const facets = {
      data: hits.filter((h) => h.kind === "data").length,
      paper: hits.filter((h) => h.kind === "paper").length,
      trial: hits.filter((h) => h.kind === "trial").length,
    };

    if (type === "data") hits = hits.filter((h) => h.kind === "data");
    if (type === "paper") hits = hits.filter((h) => h.kind === "paper");
    if (type === "trial") hits = hits.filter((h) => h.kind === "trial");

    if (sort === "citations") {
      hits = [...hits].sort((a, b) => (b.cited || 0) - (a.cited || 0));
    } else if (sort === "date") {
      hits = [...hits].sort((a, b) => (b.year || 0) - (a.year || 0));
    }

    const allLiveFailed = sourcesFailed.length > 0 && sourcesUsed.length === 0 && !curated.length;
    return NextResponse.json({
      q,
      live: true,
      total: hits.length,
      hits,
      sourcesUsed: [...new Set(sourcesUsed)],
      sourcesFailed: [...new Set(sourcesFailed)],
      warning: allLiveFailed
        ? "公开数据源暂时不可用，请稍后重试"
        : sourcesFailed.length
          ? `部分数据源不可用：${[...new Set(sourcesFailed)].join("、")}`
          : null,
      facets,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "检索失败", hits: [], total: 0 },
      { status: 500 },
    );
  }
}
