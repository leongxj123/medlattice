"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { syncQueryParam } from "@/lib/syncQuery";
import { CrossToolLinks } from "@/components/CrossToolLinks";
import { friendlyError, friendlyWarning } from "@/lib/userFacing";

type JournalMetrics = {
  sourceId?: string;
  sourceName?: string;
  issn?: string | null;
  issnList?: string[];
  publisher?: string | null;
  homepage?: string | null;
  country?: string | null;
  meanCitedness2yr?: number | null;
  hIndex?: number | null;
  i10Index?: number | null;
  worksCount?: number | null;
  citedByCount?: number | null;
  isOa?: boolean;
  isInDoaj?: boolean;
};

type PaperHit = {
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
  source?: "semantic-scholar" | "pubmed" | string;
  url?: string;
  journal?: JournalMetrics | null;
  oaPdfUrl?: string;
  oaLandingUrl?: string;
  europePmcUrl?: string;
};

const PER_PAGE = 15;

function fmtNum(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

export function PapersClient() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const [since, setSince] = useState("");
  const [oaOnly, setOaOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emptyMsg, setEmptyMsg] = useState("");
  const [results, setResults] = useState<PaperHit[]>([]);
  const [total, setTotal] = useState(0);
  const [warning, setWarning] = useState("");
  const [metricsNote, setMetricsNote] = useState("");
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const skipFilterEffect = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);

  const active = useMemo(
    () => results.find((r) => r.id === activeId) || results[0] || null,
    [results, activeId],
  );

  async function search(nextPage = 1, overrideQ?: string) {
    const q = (overrideQ ?? query).trim();
    if (!q) {
      setError("请输入关键词、DOI 或 PMID");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    setEmptyMsg("");
    syncQueryParam("q", q);
    try {
      const params = new URLSearchParams({
        q,
        sort,
        page: String(nextPage),
        perPage: String(PER_PAGE),
      });
      if (since) params.set("since", since);
      if (oaOnly) params.set("oa", "1");
      const res = await fetch(`/api/papers?${params}`, { signal: controller.signal });
      const data = await res.json();
      if (seq !== requestSeq.current) return;
      if (!res.ok) throw new Error(data.error || "检索失败");
      setResults(data.results || []);
      setTotal(data.total || 0);
      setWarning(friendlyWarning(data.warning) || "");
      setMetricsNote(data.metricsNote || "");
      setPage(nextPage);
      setActiveId(data.results?.[0]?.id || null);
      setHasSearched(true);
      if (!(data.results || []).length) {
        setEmptyMsg(data.error || "未找到相关论文，可换关键词、去掉「仅 OA」或放宽年份试试。");
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError(friendlyError(err, "检索失败，请稍后重试"));
      setResults([]);
      setTotal(0);
      setWarning("");
      setMetricsNote("");
      setEmptyMsg("");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setQuery(q);
      void search(1, q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (skipFilterEffect.current) {
      skipFilterEffect.current = false;
      return;
    }
    if (!hasSearched || !query.trim()) return;
    void search(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, since, oaOnly]);

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(1);
        }}
        className="space-y-3"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入关键词、DOI 或 PMID"
            className="min-h-11 flex-1 rounded-md border border-line bg-white/80 px-3 text-sm outline-none ring-teal/30 focus:ring-2"
          />
          <button
            type="submit"
            disabled={loading}
            className="min-h-11 rounded-md bg-teal px-5 text-sm font-medium text-white hover:bg-teal-deep disabled:opacity-60"
          >
            {loading ? "检索中…" : "查找论文"}
          </button>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              setTotal(0);
              setActiveId(null);
              setError("");
              setEmptyMsg("");
              setWarning("");
              setMetricsNote("");
              setPage(1);
              setHasSearched(false);
              setSort("relevance");
              setSince("");
              setOaOnly(false);
              abortRef.current?.abort();
              syncQueryParam("q", "");
            }}
            disabled={loading || (!query && !results.length)}
            className="min-h-11 rounded-md border border-line px-4 text-sm text-ink-soft hover:bg-mist/50 disabled:opacity-40"
          >
            清空
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-md border border-line bg-white/80 px-2 py-1.5"
          >
            <option value="relevance">相关性</option>
            <option value="citations">引用数</option>
            <option value="date">日期</option>
          </select>
          <select
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="rounded-md border border-line bg-white/80 px-2 py-1.5"
          >
            <option value="">时间不限</option>
            <option value="2024">2024以来</option>
            <option value="2022">2022以来</option>
            <option value="2020">2020以来</option>
          </select>
          <label className="inline-flex items-center gap-2 rounded-md border border-line bg-white/80 px-2 py-1.5 text-ink-soft">
            <input type="checkbox" checked={oaOnly} onChange={(e) => setOaOnly(e.target.checked)} />
            仅 OA
          </label>
        </div>
      </form>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      {emptyMsg ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{emptyMsg}</p>
      ) : null}

      {warning ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{warning}</p>
      ) : null}

      {!results.length && !loading && !error && !emptyMsg ? (
        <p className="text-sm text-ink-soft">
          输入关键词、DOI 或 PMID 检索。结果会附带期刊档案（ISSN / 出版商 / 引文统计等，非 Clarivate JIF）与可用全文链接。
        </p>
      ) : null}

      {results.length ? (
        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-3">
            <p className="text-xs text-ink-soft">
              约 {total.toLocaleString()} 条 · 第 {page} 页
            </p>
            {metricsNote ? <p className="text-[11px] text-ink-soft">{metricsNote}</p> : null}
            <p className="text-[11px] text-ink-soft">证据标签为启发式提示，非正式证据分级。</p>
            {results.map((item) => {
              const jName = item.journal?.sourceName || item.venue;
              return (
                <article
                  key={item.id}
                  className={`rounded-xl border px-4 py-3 transition ${
                    active?.id === item.id ? "border-teal bg-teal/5" : "border-line bg-white/80"
                  }`}
                >
                  <button type="button" className="w-full text-left" onClick={() => setActiveId(item.id)}>
                    <div className="flex flex-wrap gap-2 text-[11px] text-ink-soft">
                      <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal-deep">
                        {item.source === "semantic-scholar" ? "综合库" : "生物医学库"}
                      </span>
                      {item.year ? <span>{item.year}</span> : null}
                      <span>被引 {item.cited}</span>
                      {item.isOa ? <span className="text-accent">OA</span> : null}
                    </div>
                    <h2 className="mt-1 text-base font-semibold text-ink">{item.title}</h2>
                    <p className="mt-1 text-xs text-ink-soft">{item.authors}</p>
                    {item.abstract && item.abstract.trim().length > 40 ? (
                      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink-soft">{item.abstract}</p>
                    ) : null}
                    {jName ? (
                      <div className="mt-2 rounded-md border border-line/80 bg-[#f7faf9] px-2.5 py-1.5 text-[11px] text-ink-soft">
                        <p className="font-medium text-ink">{jName}</p>
                        <p className="mt-0.5">
                          {item.journal?.issn ? `ISSN ${item.journal.issn}` : null}
                          {item.journal?.issn && item.journal?.publisher ? " · " : null}
                          {item.journal?.publisher || null}
                          {(item.journal?.issn || item.journal?.publisher) &&
                          typeof item.journal?.meanCitedness2yr === "number"
                            ? " · "
                            : null}
                          {typeof item.journal?.meanCitedness2yr === "number"
                            ? `2yr ${item.journal.meanCitedness2yr.toFixed(2)}`
                            : null}
                          {typeof item.journal?.hIndex === "number" ? ` · h ${item.journal.hIndex}` : null}
                          {item.journal?.isOa ? " · 期刊 OA" : null}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-ink-soft">期刊信息待补充（需 DOI/PMID）</p>
                    )}
                    {item.evidence?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.evidence.map((tag) => (
                          <span key={tag} className="rounded-md bg-teal/10 px-2 py-0.5 text-[11px] text-teal-deep">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {item.europePmcUrl ? (
                      <a
                        className="font-medium text-accent underline underline-offset-2 hover:text-teal-deep"
                        href={item.europePmcUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        摘要页
                        <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                          ↗
                        </span>
                      </a>
                    ) : null}
                    <CrossToolLinks
                      doi={item.doi}
                      pmid={item.pmid}
                      title={item.title}
                      venue={item.venue}
                      journalName={item.journal?.sourceName}
                      oaPdfUrl={item.oaPdfUrl}
                      paperUrl={item.url || item.oaLandingUrl || undefined}
                      omit={["papers"]}
                    />
                  </div>
                </article>
              );
            })}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => void search(page - 1)}
                className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={loading || results.length < PER_PAGE}
                onClick={() => void search(page + 1)}
                className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>

          <aside className="h-fit space-y-4 rounded-xl border border-line bg-white/85 p-4 shadow-[var(--shadow)]">
            {active ? (
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-accent">论文详情</p>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-xl font-semibold text-ink">
                  {active.title}
                </h3>
                <p className="mt-2 text-xs text-ink-soft">
                  {active.authors}
                  {active.year ? ` · ${active.year}` : ""}
                </p>

                <JournalPanel journal={active.journal} venue={active.venue} />

                <div className="mt-4">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-ink-soft">摘要</p>
                  <p className="mt-2 text-sm leading-relaxed text-ink">
                    {active.abstract && active.abstract.trim().length > 40
                      ? active.abstract
                      : "暂无摘要（部分文献未提供公开摘要）。"}
                  </p>
                </div>

                <div className="mt-3">
                  <CrossToolLinks
                    doi={active.doi}
                    pmid={active.pmid}
                    title={active.title}
                    venue={active.venue}
                    journalName={active.journal?.sourceName}
                    oaPdfUrl={active.oaPdfUrl}
                    paperUrl={active.url || active.oaLandingUrl || undefined}
                    omit={["papers"]}
                    className="rounded-md border border-line bg-[#f7faf9] px-3 py-2"
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-accent">
                  {active.europePmcUrl ? (
                    <a
                      href={active.europePmcUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline underline-offset-2 hover:text-teal-deep"
                    >
                      摘要页
                      <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                        ↗
                      </span>
                    </a>
                  ) : null}
                  {active.oaLandingUrl &&
                  active.oaLandingUrl !== active.url &&
                  active.oaLandingUrl !== active.oaPdfUrl ? (
                    <a
                      href={active.oaLandingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline underline-offset-2 hover:text-teal-deep"
                    >
                      OA 页面
                      <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                        ↗
                      </span>
                    </a>
                  ) : null}
                  {active.journal?.homepage ? (
                    <a
                      href={active.journal.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline underline-offset-2 hover:text-teal-deep"
                    >
                      期刊主页
                      <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                        ↗
                      </span>
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-soft">选择左侧结果查看详情。</p>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function JournalPanel({
  journal,
  venue,
}: {
  journal?: JournalMetrics | null;
  venue?: string;
}) {
  const name = journal?.sourceName || venue;
  if (!name && !journal) {
    return (
      <div className="mt-3 rounded-md border border-dashed border-line px-3 py-2 text-xs text-ink-soft">
        暂无期刊档案（缺少 DOI/PMID 时无法自动补全）。
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-[#f7faf9] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-soft">Journal</p>
          <p className="mt-1 text-sm font-semibold text-ink">{name || "—"}</p>
          <p className="mt-1 text-[11px] text-ink-soft">
            {journal?.issn ? `ISSN ${journal.issn}` : "ISSN —"}
            {journal?.publisher ? ` · ${journal.publisher}` : ""}
            {journal?.country ? ` · ${journal.country}` : ""}
          </p>
        </div>
        {name ? (
          <a
            href={`/journals?q=${encodeURIComponent(name)}`}
            className="shrink-0 text-xs text-accent hover:underline"
          >
            打开选刊档案 →
          </a>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <Metric label="2yr citedness" value={fmtNum(journal?.meanCitedness2yr)} />
        <Metric label="h-index" value={String(journal?.hIndex ?? "—")} />
        <Metric label="i10" value={String(journal?.i10Index ?? "—")} />
        <Metric
          label="Works"
          value={journal?.worksCount != null ? journal.worksCount.toLocaleString() : "—"}
        />
        <Metric
          label="Cited by"
          value={journal?.citedByCount != null ? journal.citedByCount.toLocaleString() : "—"}
        />
        <Metric
          label="OA / DOAJ"
          value={`${journal?.isOa ? "OA" : "非全OA"} / ${journal?.isInDoaj ? "DOAJ" : "—"}`}
        />
      </div>
      <p className="mt-2 text-[10px] text-ink-soft">以上为公开学术统计，不是 Clarivate JIF / 中科院分区。</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-white/80 px-2 py-1.5">
      <p className="text-ink-soft">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}
