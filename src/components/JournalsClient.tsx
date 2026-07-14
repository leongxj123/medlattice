"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { syncQueryParam } from "@/lib/syncQuery";
import { CrossToolLinks } from "@/components/CrossToolLinks";
import { friendlyError } from "@/lib/userFacing";

type JournalHit = {
  id: string;
  name: string;
  issn: string | null;
  publisher: string | null;
  worksCount: number;
  citedByCount: number;
  isOa: boolean;
  meanCitedness2yr: number | null;
  hIndex: number | null;
  topics: string[];
};

type JournalDetail = {
  id: string;
  name: string;
  abbr: string | null;
  issn: string | null;
  issnList: string[];
  publisher: string | null;
  homepage: string | null;
  country: string | null;
  worksCount: number;
  citedByCount: number;
  isOa: boolean;
  isInDoaj?: boolean;
  meanCitedness2yr: number | null;
  hIndex: number | null;
  i10Index: number | null;
  topics: string[];
  wikipediaExtract: string | null;
  yearSeries: Array<{ year: string; count: number }>;
  crossrefSamples: Array<{ title: string; doi?: string; year?: number; url?: string }>;
  similar: Array<{ id: string; name: string; meanCitedness2yr: number | null; worksCount: number }>;
};

function hitToPreview(hit: JournalHit): JournalDetail {
  return {
    id: hit.id,
    name: hit.name,
    abbr: null,
    issn: hit.issn,
    issnList: hit.issn ? [hit.issn] : [],
    publisher: hit.publisher,
    homepage: null,
    country: null,
    worksCount: hit.worksCount,
    citedByCount: hit.citedByCount,
    isOa: hit.isOa,
    meanCitedness2yr: hit.meanCitedness2yr,
    hIndex: hit.hIndex,
    i10Index: null,
    topics: hit.topics || [],
    wikipediaExtract: null,
    yearSeries: [],
    crossrefSamples: [],
    similar: [],
  };
}

export function JournalsClient() {
  const searchParams = useSearchParams();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [hits, setHits] = useState<JournalHit[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const detailAbortRef = useRef<AbortController | null>(null);

  async function search(query = q) {
    if (!query.trim()) {
      setError("请输入期刊名、缩写或 ISSN");
      return;
    }
    setLoading(true);
    setError("");
    setHasSearched(true);
    syncQueryParam("q", query);
    try {
      const res = await fetch(`/api/journals?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "检索失败");
      const results = (data.results || []) as JournalHit[];
      setHits(results);
      const first = results[0];
      if (first) {
        setActiveId(first.id);
        setDetail(hitToPreview(first));
        void loadDetail(first.id);
      } else {
        setDetail(null);
        setActiveId(null);
        setError(data.error || "未找到匹配期刊");
      }
    } catch (err) {
      setError(friendlyError(err, "检索失败"));
      setHits([]);
      setDetail(null);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const boot = searchParams.get("q");
    if (boot) {
      setQ(boot);
      void search(boot);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function loadDetail(id: string) {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    setDetailLoading(true);
    setError("");
    try {
      const timer = setTimeout(() => controller.abort(), 18000);
      const res = await fetch(`/api/journals/${id}`, { signal: controller.signal });
      clearTimeout(timer);
      if (controller.signal.aborted) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "详情失败");
      setDetail(data.journal);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof Error && err.name === "AbortError") {
        setError("详情请求超时，左侧指标仍可用；可再点一次期刊重试。");
      } else {
        setError(friendlyError(err, "详情加载失败，请重试"));
      }
    } finally {
      if (detailAbortRef.current === controller) {
        setDetailLoading(false);
      }
    }
  }

  function selectJournal(hit: JournalHit) {
    setActiveId(hit.id);
    setDetail(hitToPreview(hit));
    void loadDetail(hit.id);
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="flex flex-col gap-3 md:flex-row"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="期刊名、缩写或关键词"
          className="min-h-11 flex-1 rounded-md border border-line bg-white/80 px-3 text-sm outline-none ring-teal/30 focus:ring-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="min-h-11 rounded-md bg-teal px-5 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "检索中…" : "检索期刊"}
        </button>
        <button
          type="button"
          onClick={() => {
            detailAbortRef.current?.abort();
            setQ("");
            setHits([]);
            setDetail(null);
            setActiveId(null);
            setError("");
            setHasSearched(false);
            setDetailLoading(false);
            syncQueryParam("q", "");
          }}
          disabled={loading || (!q && !hasSearched)}
          className="min-h-11 rounded-md border border-line px-4 text-sm text-ink-soft hover:bg-mist/50 disabled:opacity-40"
        >
          清空
        </button>
      </form>

      <p className="text-xs text-ink-soft">
        实时拉取期刊档案、近年发文趋势与样例文章。指标为公开学术统计（含 2yr mean citedness / h-index），不是 Clarivate
        JIF / 中科院分区。
        {detailLoading ? " · 正在补充简介与趋势…" : ""}
      </p>

      {error ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{error}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="max-h-[760px] space-y-2 overflow-auto">
          {hits.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => selectJournal(j)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                activeId === j.id ? "border-teal bg-teal/5" : "border-line bg-white/75 hover:bg-white"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-ink">{j.name}</h2>
                  <p className="mt-1 text-xs text-ink-soft">
                    {j.issn ? `ISSN ${j.issn}` : "无 ISSN"}
                    {j.publisher ? ` · ${j.publisher}` : ""}
                  </p>
                </div>
                <div className="text-right text-[11px] text-ink-soft">
                  <p>2yr cite {j.meanCitedness2yr?.toFixed?.(2) ?? j.meanCitedness2yr ?? "—"}</p>
                  <p>h-index {j.hIndex ?? "—"}</p>
                </div>
              </div>
            </button>
          ))}
          {!hits.length && !loading && hasSearched ? (
            <p className="text-sm text-ink-soft">无结果，换个刊名或 ISSN 试试。</p>
          ) : null}
          {!hits.length && !loading && !hasSearched ? (
            <p className="text-sm text-ink-soft">输入刊名后开始检索，例如 Nature Medicine、Lancet、ISSN。</p>
          ) : null}
        </div>

        <aside className="rounded-xl border border-line bg-white/85 p-5 shadow-[var(--shadow)]">
          {!detail ? <p className="text-sm text-ink-soft">选择左侧期刊查看实时详情。</p> : null}
          {detail ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-accent">
                  Live journal dossier{detailLoading ? " · enriching" : ""}
                </p>
                <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold text-ink">{detail.name}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {detail.abbr || "—"}
                  {detail.publisher ? ` · ${detail.publisher}` : ""}
                  {detail.country ? ` · ${detail.country}` : ""}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <Info label="ISSN" value={detail.issn || "—"} />
                <Info
                  label="OA / DOAJ"
                  value={`${detail.isOa ? "OA" : "非全 OA"} / ${detail.isInDoaj ? "DOAJ" : "未知"}`}
                />
                <Info label="2yr mean citedness" value={fmt(detail.meanCitedness2yr)} />
                <Info label="h-index" value={String(detail.hIndex ?? "—")} />
                <Info label="Works" value={detail.worksCount.toLocaleString()} />
                <Info label="Cited by" value={detail.citedByCount.toLocaleString()} />
              </div>

              {detail.wikipediaExtract ? (
                <div>
                  <h3 className="text-sm font-semibold text-ink">期刊简介</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{detail.wikipediaExtract}</p>
                </div>
              ) : detailLoading ? (
                <p className="text-xs text-ink-soft">正在补充简介、发文趋势与近期样例…</p>
              ) : null}

              {detail.topics?.length ? (
                <p className="text-xs text-ink-soft">Topics：{detail.topics.join(" · ")}</p>
              ) : null}

              {detail.yearSeries.length ? (
                <YearChart series={detail.yearSeries} />
              ) : !detailLoading ? (
                <p className="text-xs text-ink-soft">暂无近年发文量分布（上游超时或无数据，可重试）。</p>
              ) : null}

              {detail.crossrefSamples.length ? (
                <div>
                  <h3 className="text-sm font-semibold text-ink">近期发文样例</h3>
                  <ul className="mt-2 space-y-2">
                    {detail.crossrefSamples.map((s, i) => (
                      <li key={`${s.doi || s.title}-${i}`} className="rounded-md border border-line px-3 py-2 text-xs text-ink-soft">
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-teal-deep">
                            {s.title}
                          </a>
                        ) : (
                          <span className="font-medium text-ink">{s.title}</span>
                        )}
                        <p className="mt-1">
                          {s.year || "n.d."}
                          {s.doi ? ` · ${s.doi}` : ""}
                        </p>
                        {s.doi ? (
                          <a href={`/map?q=${encodeURIComponent(s.doi)}`} className="mt-1 inline-block text-accent">
                            打开图谱
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : !detailLoading ? (
                <p className="text-xs text-ink-soft">暂无近期发文样例。</p>
              ) : null}

              {detail.similar.length ? (
                <div>
                  <h3 className="text-sm font-semibold text-ink">相近期刊</h3>
                  <div className="mt-2 space-y-2">
                    {detail.similar.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setActiveId(s.id);
                          setDetail({
                            ...hitToPreview({
                              id: s.id,
                              name: s.name,
                              issn: null,
                              publisher: null,
                              worksCount: s.worksCount,
                              citedByCount: 0,
                              isOa: false,
                              meanCitedness2yr: s.meanCitedness2yr,
                              hIndex: null,
                              topics: [],
                            }),
                          });
                          void loadDetail(s.id);
                        }}
                        className="block w-full rounded-md border border-line px-3 py-2 text-left text-sm hover:bg-mist/40"
                      >
                        <span className="font-medium text-ink">{s.name}</span>
                        <span className="mt-1 block text-xs text-ink-soft">
                          2yr {fmt(s.meanCitedness2yr)} · works {s.worksCount.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {detail.homepage ? (
                <a
                  href={detail.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent underline underline-offset-2 hover:text-teal-deep"
                >
                  期刊主页
                  <span aria-hidden>↗</span>
                </a>
              ) : null}

              <CrossToolLinks
                journalName={detail.name}
                venue={detail.name}
                dataQuery={detail.name}
                title={detail.crossrefSamples[0]?.title}
                doi={detail.crossrefSamples[0]?.doi}
                paperUrl={
                  detail.crossrefSamples[0]?.doi
                    ? `https://doi.org/${detail.crossrefSamples[0].doi}`
                    : undefined
                }
                omit={["journals"]}
                className="rounded-md border border-line bg-[#f7faf9] px-3 py-2"
              />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function YearChart({ series }: { series: Array<{ year: string; count: number }> }) {
  const max = Math.max(...series.map((y) => y.count), 1);
  const chartH = 112;

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink">近年发文量</h3>
      <div className="flex items-end gap-1" style={{ height: chartH + 18 }}>
        {series.map((y) => {
          const barH = y.count > 0 ? Math.max(6, Math.round((y.count / max) * chartH)) : 2;
          return (
            <div key={y.year} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" style={{ height: chartH + 18 }}>
              <div
                className={`w-full rounded-t-sm ${y.count > 0 ? "bg-teal/85" : "bg-line"}`}
                style={{ height: barH }}
                title={`${y.year}: ${y.count.toLocaleString()} 篇`}
              />
              <span className="text-[9px] text-ink-soft">{y.year.slice(2)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-ink-soft">
        {series[0]?.year}–{series[series.length - 1]?.year} · 峰值 {max.toLocaleString()} 篇/年
      </p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-[#f7faf9] px-3 py-2">
      <p className="text-[11px] text-ink-soft">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}

function fmt(n: number | null) {
  if (n === null || n === undefined) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
