import { NextRequest, NextResponse } from "next/server";
import {
  chictrSearchUrl,
  CONTACT_EMAIL,
  encodeQuery,
  enrichPaperLinks,
  fetchJson,
  resolveWorkQuery,
  stripDoi,
  whoIctrpSearchUrl,
  workTitle,
} from "@/lib/http";

type TrialHit = {
  nctId: string;
  title: string;
  status?: string;
  phase?: string | string[];
  conditions?: string[];
  interventions?: string[];
  sponsor?: string;
  startDate?: string;
  url: string;
};

function mapStudy(s: {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string };
    statusModule?: { overallStatus?: string; startDateStruct?: { date?: string } };
    designModule?: { phases?: string[] };
    conditionsModule?: { conditions?: string[] };
    armsInterventionsModule?: { interventions?: Array<{ name?: string; type?: string }> };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
  };
}): TrialHit | null {
  const id = s.protocolSection?.identificationModule?.nctId;
  if (!id) return null;
  return {
    nctId: id,
    title:
      s.protocolSection?.identificationModule?.briefTitle ||
      s.protocolSection?.identificationModule?.officialTitle ||
      "Untitled trial",
    status: s.protocolSection?.statusModule?.overallStatus,
    phase: s.protocolSection?.designModule?.phases,
    conditions: s.protocolSection?.conditionsModule?.conditions?.slice(0, 6),
    interventions: (s.protocolSection?.armsInterventionsModule?.interventions || [])
      .map((i) => i.name)
      .filter(Boolean)
      .slice(0, 6) as string[],
    sponsor: s.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name,
    startDate: s.protocolSection?.statusModule?.startDateStruct?.date,
    url: `https://clinicaltrials.gov/study/${id}`,
  };
}

async function searchTrials(term: string, pageSize = 12): Promise<TrialHit[]> {
  const ct = await fetchJson<{ studies?: Parameters<typeof mapStudy>[0][] }>(
    `https://clinicaltrials.gov/api/v2/studies?${encodeQuery({
      "query.term": term,
      pageSize,
      format: "json",
    })}`,
  );
  return (ct.studies || []).map(mapStudy).filter(Boolean) as TrialHit[];
}

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q")?.trim() || "";
    const mode = req.nextUrl.searchParams.get("mode") || "auto"; // auto | paper | trial

    if (!q) {
      return NextResponse.json({ error: "请输入 DOI / PMID / NCT 号 / 疾病关键词" }, { status: 400 });
    }

    // Direct NCT lookup
    if (/^NCT\d{8}$/i.test(q)) {
      const detail = await fetchJson<Parameters<typeof mapStudy>[0]>(
        `https://clinicaltrials.gov/api/v2/studies/${q.toUpperCase()}`,
      );
      const trial = mapStudy(detail);
      let relatedPapers: Array<{ title: string; doi?: string | null; year?: number | null; id: string }> = [];
      try {
        const papers = await fetchJson<{ results: Array<{ id: string; display_name?: string; doi?: string; publication_year?: number }> }>(
          `https://api.openalex.org/works?${encodeQuery({
            search: q.toUpperCase(),
            per_page: 8,
            mailto: CONTACT_EMAIL,
          })}`,
        );
        relatedPapers = (papers.results || []).map((p) => ({
          id: p.id,
          title: p.display_name || "Untitled",
          doi: stripDoi(p.doi),
          year: p.publication_year || null,
        }));
      } catch {
        relatedPapers = [];
      }
      return NextResponse.json({
        live: true,
        mode: "trial",
        query: q,
        paper: null,
        trials: trial ? [trial] : [],
        relatedPapers,
        nctFromCrossref: [],
        externalRegistries: {
          chictr: chictrSearchUrl(trial?.conditions?.[0] || q),
          whoIctrp: whoIctrpSearchUrl(trial?.conditions?.[0] || q),
          clinicalTrialsGov: `https://clinicaltrials.gov/study/${q.toUpperCase()}`,
        },
        paperOa: null,
      });
    }

    let paper: {
      title: string;
      doi: string | null;
      year: number | null;
      venue?: string;
      abstract?: string;
    } | null = null;
    let nctFromCrossref: string[] = [];
    let trials: TrialHit[] = [];
    let relatedPapers: Array<{ title: string; doi?: string | null; year?: number | null; id: string }> = [];

    const looksLikePaper = mode === "paper" || /^10\./.test(q) || /pmid/i.test(q) || mode === "auto";

    if (looksLikePaper && mode !== "trial") {
      try {
        const work = await resolveWorkQuery(q);
        if (work) {
          paper = {
            title: workTitle(work),
            doi: stripDoi(work.doi),
            year: work.publication_year || null,
            venue: work.primary_location?.source?.display_name || undefined,
          };

          // Crossref clinical-trial-number on DOI
          if (paper.doi) {
            try {
              const cr = await fetchJson<{
                message?: {
                  "clinical-trial-number"?: Array<{ clinical_trial_number?: string } | string>;
                  title?: string[];
                };
              }>(`https://api.crossref.org/works/${encodeURIComponent(paper.doi)}`);
              const raw = cr.message?.["clinical-trial-number"] || [];
              nctFromCrossref = raw
                .map((item) => {
                  if (typeof item === "string") return item;
                  return item.clinical_trial_number || "";
                })
                .map((s) => s.toUpperCase())
                .filter((s) => /^NCT\d{8}$/.test(s));
            } catch {
              nctFromCrossref = [];
            }
          }

          // Search trials by paper title keywords
          const trialQuery = [
            ...nctFromCrossref,
            paper.title.split(/[:.?]/)[0]?.slice(0, 80),
          ]
            .filter(Boolean)
            .join(" OR ");
          trials = await searchTrials(trialQuery || paper.title, 10);

          // Also fetch trials for each explicit NCT
          for (const nct of nctFromCrossref.slice(0, 5)) {
            if (!trials.some((t) => t.nctId === nct)) {
              try {
                const detail = await fetchJson<Parameters<typeof mapStudy>[0]>(
                  `https://clinicaltrials.gov/api/v2/studies/${nct}`,
                );
                const t = mapStudy(detail);
                if (t) trials.unshift(t);
              } catch {
                /* skip */
              }
            }
          }
        }
      } catch {
        /* continue to keyword trial search */
      }
    }

    if (!trials.length || mode === "trial") {
      trials = await searchTrials(q, 12);
    }

    // Related OpenAlex papers for the query / first trial condition
    try {
      const topic = trials[0]?.conditions?.[0] || q;
      const papers = await fetchJson<{ results: Array<{ id: string; display_name?: string; doi?: string; publication_year?: number }> }>(
        `https://api.openalex.org/works?${encodeQuery({
          search: `${topic} clinical trial`,
          sort: "cited_by_count:desc",
          per_page: 8,
          mailto: CONTACT_EMAIL,
        })}`,
      );
      relatedPapers = (papers.results || []).map((p) => ({
        id: p.id,
        title: p.display_name || "Untitled",
        doi: stripDoi(p.doi),
        year: p.publication_year || null,
      }));
    } catch {
      relatedPapers = [];
    }

    return NextResponse.json({
      live: true,
      mode: paper ? "paper-bridge" : "trial-search",
      query: q,
      paper,
      trials,
      relatedPapers,
      nctFromCrossref,
      externalRegistries: {
        chictr: chictrSearchUrl(q),
        whoIctrp: whoIctrpSearchUrl(q),
        clinicalTrialsGov: `https://clinicaltrials.gov/search?term=${encodeURIComponent(q)}`,
      },
      paperOa: paper?.doi ? await enrichPaperLinks({ doi: paper.doi }).catch(() => null) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "试验桥接失败" },
      { status: 500 },
    );
  }
}
