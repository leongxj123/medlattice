"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CrossToolLinks } from "@/components/CrossToolLinks";
import { SourceRecordPanel } from "@/components/SourceRecordPanel";
import { friendlyError } from "@/lib/userFacing";
import { syncQueryParam } from "@/lib/syncQuery";

type CiteStatus = "ok" | "review" | "risk" | "insufficient";

type FieldDiff = {
  field: string;
  label: string;
  cited: string;
  resolved: string;
  matchScore?: number;
};

type FieldCheck = FieldDiff & {
  ok: boolean;
  citedMissing?: boolean;
};

type CiteResult = {
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
  fieldDiffs?: FieldDiff[];
  fieldChecks?: FieldCheck[];
  links: { label: string; url: string }[];
  record?: {
    title?: string;
    authors?: string;
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
    sources?: string[];
    matchScore?: number;
  } | null;
  formats: { apa: string; gbt: string; bibtex: string };
};

type Summary = {
  total?: number;
  ok: number;
  review: number;
  risk: number;
  insufficient: number;
  driftFields: string[];
  driftCounts?: Record<string, number>;
  sources: string[];
  sourceCounts?: Record<string, number>;
  reviewIndexes: number[];
};

const STATUS_META: Record<CiteStatus, { label: string; className: string; dot: string }> = {
  ok: { label: "正常", className: "bg-teal/10 text-teal-deep", dot: "bg-teal" },
  review: { label: "需复核", className: "bg-amber-100 text-amber-950", dot: "bg-amber-500" },
  risk: { label: "高风险", className: "bg-red-100 text-red-800", dot: "bg-red-500" },
  insufficient: { label: "证据不足", className: "bg-mist text-ink-soft", dot: "bg-slate-400" },
};

const FIELD_CN: Record<string, string> = {
  doi: "DOI",
  year: "年份",
  title: "标题",
  first_author: "第一作者",
  container: "期刊",
  volume: "卷号",
  issue: "期号",
  pages: "页码",
  pmid: "PMID",
};

const EXPORTABLE: CiteStatus[] = ["ok", "review"];

const SAMPLE = `1. Polack FP, Thomas SJ, Kitchin N, et al. Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine. N Engl J Med. 2020;383:2603-2615. doi:10.1056/NEJMoa2034577
2. Fake Fan. Completely fabricated imaginary paper about miracle cure. Fake Journal. 2024. doi:10.1234/fake.doi.9999
3. Wolchok JD, et al. Overall Survival with Combined Nivolumab and Ipilimumab in Advanced Melanoma. N Engl J Med. 2017;377(14):1345-1356. PMID: 28889792
4. Harris PA, Taylor R, Thielke R, et al. Research electronic data capture (REDCap)--a metadata-driven methodology and workflow process for providing translational research informatics support. J Biomed Inform. 2009;42(2):377-381.`;

function CitationsInner() {
  const searchParams = useSearchParams();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<CiteResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [format, setFormat] = useState<"apa" | "gbt" | "bibtex">("apa");
  const [active, setActive] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [seedBooted, setSeedBooted] = useState(false);
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (seedBooted) return;
    setSeedBooted(true);
    const seed = searchParams.get("seed");
    if (seed) {
      setText(seed);
      void verify(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, seedBooted]);

  async function verify(overrideText?: string) {
    const payload = (overrideText ?? text).trim();
    if (!payload) {
      setError("请粘贴参考文献列表");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeq.current;

    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch("/api/citations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: payload }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (seq !== requestSeq.current) return;
      if (!res.ok) throw new Error(data.error || "核查失败");
      setResults(data.results || []);
      setSummary(data.summary || null);
      setActive(data.results?.[0]?.index ?? null);
      if (data.truncated) setError("已截取前 15 条或过长输入进行核查，其余请分批粘贴。");
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError(friendlyError(err, "核查失败，请稍后重试"));
      setResults([]);
      setSummary(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  const exportableResults = useMemo(
    () => results.filter((r) => EXPORTABLE.includes(r.status) && (r.formats?.[format] || "").trim()),
    [results, format],
  );

  const exportText = useMemo(() => {
    return exportableResults.map((r, i) => `${i + 1}. ${r.formats[format]}`).join("\n");
  }, [exportableResults, format]);

  const activeRow = useMemo(
    () => results.find((r) => r.index === active) || results[0] || null,
    [results, active],
  );

  async function copyAll() {
    if (!exportText) return;
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择文本");
    }
  }

  function downloadTxt() {
    if (!exportText) return;
    const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "medlattice-citations.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearAll() {
    abortRef.current?.abort();
    requestSeq.current += 1;
    setText("");
    setResults([]);
    setSummary(null);
    setActive(null);
    setError("");
    setCopied(false);
    setLoading(false);
    syncQueryParam("seed", "");
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-ink-soft">
        粘贴参考文献后点「开始」。优先按 [1]/[2] 或 1. / 2. 编号切分；软换行不会拆成多条。逐条给出「引用中 → 库内」对比。单次最多 15 条。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void verify()}
          disabled={loading}
          className="rounded-md bg-teal px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "交叉比对中…" : "开始核查"}
        </button>
        <button
          type="button"
          onClick={() => {
            setText(SAMPLE);
            void verify(SAMPLE);
          }}
          disabled={loading}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-mist/50 disabled:opacity-60"
        >
          填入示例并核查
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={loading || (!text && !results.length)}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-mist/50 disabled:opacity-40"
        >
          清空
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void verify();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-line bg-white/80 p-3 text-sm leading-relaxed outline-none ring-teal/30 focus:ring-2"
          placeholder="粘贴参考文献列表。建议使用 [1] [2] 或 1. 2. 编号；同一条内的换行会自动合并…"
        />
      </form>

      {error ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{error}</p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Summary */}
        <section className="rounded-xl border border-line bg-white/85 p-4 shadow-[var(--shadow)]">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink">总结报告</h2>
            {summary ? (
              <span className="text-xs text-ink-soft">共核查 {summary.total ?? results.length} 条</span>
            ) : null}
          </div>
          {!summary ? (
            <p className="mt-3 text-sm text-ink-soft">运行后显示正常 / 复核 / 风险 / 不足统计。</p>
          ) : (
            <div className="mt-4 space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["ok", summary.ok],
                    ["review", summary.review],
                    ["risk", summary.risk],
                    ["insufficient", summary.insufficient],
                  ] as const
                ).map(([key, n]) => (
                  <span
                    key={key}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${STATUS_META[key].className}`}
                  >
                    {STATUS_META[key].label} {n}
                  </span>
                ))}
              </div>

              <div>
                <p className="text-xs font-medium text-ink">高频偏差字段</p>
                <p className="mt-1 text-ink-soft">
                  {summary.driftCounts && Object.keys(summary.driftCounts).length
                    ? Object.entries(summary.driftCounts)
                        .map(([k, n]) => `${FIELD_CN[k] || k}: ${n}`)
                        .join(" · ")
                    : "无"}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-ink">命中数据源</p>
                <p className="mt-1 text-ink-soft">
                  {summary.sourceCounts && Object.keys(summary.sourceCounts).length
                    ? Object.entries(summary.sourceCounts)
                        .map(([k, n]) => `${k}: ${n}`)
                        .join(" · ")
                    : "无"}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-ink">建议优先复核</p>
                <p className="mt-1 text-ink-soft">
                  {summary.reviewIndexes.length ? summary.reviewIndexes.map((i) => `[${i}]`).join(" ") : "—"}
                </p>
              </div>

              {activeRow ? (
                <CrossToolLinks
                  doi={activeRow.doi}
                  title={activeRow.title || activeRow.raw}
                  journalName={activeRow.container}
                  paperUrl={
                    activeRow.links.find((l) => l.label === "原文")?.url ||
                    (activeRow.doi ? `https://doi.org/${activeRow.doi}` : undefined)
                  }
                  omit={["citations"]}
                  className="rounded-md border border-line bg-[#f7faf9] px-3 py-2"
                />
              ) : null}
            </div>
          )}
        </section>

        {/* Result list */}
        <section className="rounded-xl border border-line bg-white/85 p-4 shadow-[var(--shadow)]">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink">结果列表</h2>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-soft">
            {(Object.keys(STATUS_META) as CiteStatus[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${STATUS_META[k].dot}`} />
                {STATUS_META[k].label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-soft">本模式核验参考文献条目真实性，并给出字段级对比。</p>

          <div className="mt-3 max-h-[560px] space-y-3 overflow-auto pr-1">
            {!results.length ? <p className="text-sm text-ink-soft">核查后显示逐条结果与字段对比。</p> : null}
            {results.map((r) => {
              const hasYuanwenLink = r.links.some((l) => l.label === "原文");
              return (
                <button
                  key={r.index}
                  type="button"
                  onClick={() => setActive(r.index)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    active === r.index ? "border-teal bg-teal/5" : "border-line bg-white/70 hover:bg-mist/40"
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink-soft">[{r.index}]</span>
                    <span className={`rounded-md px-2 py-0.5 text-xs ${STATUS_META[r.status].className}`}>
                      {STATUS_META[r.status].label}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-ink">{r.title || r.raw.slice(0, 110)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">{r.message}</p>

                  {(() => {
                    const rows: FieldCheck[] =
                      r.fieldChecks && r.fieldChecks.length
                        ? r.fieldChecks
                        : (r.fieldDiffs || []).map((d) => ({ ...d, ok: false as const }));
                    if (!rows.length) return null;
                    return (
                      <div className="mt-2 space-y-1.5 rounded-md border border-line bg-[#fbfcfc] px-2.5 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-soft">
                          字段核对（引用中 → 库内）
                        </p>
                        {rows.map((d) => (
                          <div key={`${r.index}-${d.field}-${d.ok ? "ok" : "bad"}`} className="text-[11px] leading-relaxed">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-ink-soft">{d.label}</span>
                              <span
                                className={`rounded px-1 py-0.5 text-[10px] ${
                                  d.ok
                                    ? d.citedMissing
                                      ? "bg-mist text-ink-soft"
                                      : "bg-teal/10 text-teal-deep"
                                    : "bg-red-50 text-red-800"
                                }`}
                              >
                                {d.ok ? (d.citedMissing ? "未提取" : "一致") : "不一致"}
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded px-1.5 py-0.5 ${
                                  d.ok
                                    ? "bg-white text-ink-soft"
                                    : "bg-red-50 text-red-800 line-through decoration-red-300"
                                }`}
                              >
                                {d.cited}
                              </span>
                              <span className="text-ink-soft">→</span>
                              <span className="rounded bg-teal/10 px-1.5 py-0.5 text-teal-deep">
                                {d.resolved}
                                {typeof d.matchScore === "number" && d.matchScore < 1 && !d.ok
                                  ? ` (${Math.round(d.matchScore * 100)}%)`
                                  : ""}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-accent">
                    {!hasYuanwenLink && r.doi ? (
                      <a
                        href={`https://doi.org/${r.doi}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium underline underline-offset-2 hover:text-teal-deep"
                      >
                        原文
                        <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                          ↗
                        </span>
                      </a>
                    ) : null}
                    {r.links.map((l) => (
                      <a
                        key={l.label}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium underline underline-offset-2 hover:text-teal-deep"
                      >
                        {l.label}
                        <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                          ↗
                        </span>
                      </a>
                    ))}
                    {r.doi ? (
                      <a
                        href={`/map?q=${encodeURIComponent(r.doi)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="underline underline-offset-2 hover:text-teal-deep"
                      >
                        图谱
                      </a>
                    ) : null}
                    {r.doi || r.title ? (
                      <a
                        href={`/papers?q=${encodeURIComponent(r.doi || r.title || "")}`}
                        onClick={(e) => e.stopPropagation()}
                        className="underline underline-offset-2 hover:text-teal-deep"
                      >
                        查找论文
                      </a>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Formats + inline source record */}
        <section className="rounded-xl border border-line bg-white/85 p-4 shadow-[var(--shadow)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink">库内信息 / 标准格式</h2>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as "apa" | "gbt" | "bibtex")}
              className="rounded-md border border-line bg-white px-2 py-1 text-xs"
            >
              <option value="apa">APA</option>
              <option value="gbt">GB/T 7714</option>
              <option value="bibtex">BibTeX</option>
            </select>
          </div>

          <div className="mt-3 rounded-lg border border-line bg-[#f7faf9] p-3">
            <SourceRecordPanel
              record={activeRow?.record}
              emptyHint={
                results.length
                  ? "当前条目没有可展示的库内命中（DOI 未找到且标题也无接近文献）。"
                  : "核查后，点选中间列表中的条目，这里直接展示来源库信息页。"
              }
            />
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void copyAll()}
              disabled={!exportText}
              className="rounded-md border border-line px-3 py-1.5 text-xs disabled:opacity-40"
            >
              {copied ? "已复制" : "复制全部"}
            </button>
            <button
              type="button"
              onClick={downloadTxt}
              disabled={!exportText}
              className="rounded-md border border-line px-3 py-1.5 text-xs disabled:opacity-40"
            >
              导出 TXT
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink-soft">仅导出状态为「正常 / 需复核」且有标准格式的条目。</p>
          <div className="mt-3 max-h-[280px] space-y-2 overflow-auto">
            {!results.length ? (
              <p className="text-sm text-ink-soft">核查后可按格式导出。</p>
            ) : !exportableResults.length ? (
              <p className="text-sm text-ink-soft">暂无可导出条目（高风险 / 证据不足不纳入导出）。</p>
            ) : (
              exportableResults.map((r, i) => (
                <div
                  key={r.index}
                  className={`rounded-lg border border-dashed px-3 py-2.5 text-xs leading-relaxed text-ink-soft ${
                    active === r.index ? "border-teal bg-teal/5" : "border-line bg-white/70"
                  }`}
                >
                  <span className="mr-1 font-medium text-ink">{i + 1}.</span>
                  <span className="text-ink">{r.formats[format]}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function CitationsClient() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-soft">加载中…</p>}>
      <CitationsInner />
    </Suspense>
  );
}
