"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CrossToolLinks } from "@/components/CrossToolLinks";
import { SourceRecordPanel } from "@/components/SourceRecordPanel";
import { friendlyError, friendlyWarning } from "@/lib/userFacing";
import { syncQueryParam } from "@/lib/syncQuery";

type MatchSegment = { text: string; matched: boolean };

type MatchEvidence = {
  titleScore: number;
  abstractScore: number;
  titleInBodyScore?: number;
  yearStatus: "exact" | "near" | "mismatch" | "none";
  doiHit: boolean;
  pmidHit: boolean;
  matchedTitleTokens: string[];
  missedTitleTokens: string[];
  titleSegments: MatchSegment[];
  querySegments: MatchSegment[];
  abstractSnippets: string[];
  reasons: string[];
  matchedSentences: string[];
};

type MatchHit = {
  id: string;
  title: string;
  authors: string;
  year?: number;
  container?: string;
  doi?: string;
  pmid?: string;
  abstract?: string;
  type?: string;
  citedBy?: number;
  url?: string;
  score: number;
  scoreLabel: string;
  sources: string[];
  formats: { apa: string; gbt: string; bibtex: string };
  evidence: MatchEvidence;
};

type SentenceReport = {
  index: number;
  text: string;
  hitCount: number;
  bestScore: number;
  bestHitId: string | null;
  hitIds: string[];
};

const MAX_CHARS = 6000;
const SAMPLE =
  "Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine. Messenger RNA vaccines encoding the SARS-CoV-2 spike protein have shown high efficacy against Covid-19 in clinical trials. In a multinational placebo-controlled trial, BNT162b2 conferred 95% protection against Covid-19 in persons 16 years of age or older.";

function HighlightText({ segments }: { segments: MatchSegment[] }) {
  if (!segments?.length) return null;
  return (
    <span className="leading-relaxed">
      {segments.map((s, i) =>
        s.matched ? (
          <mark key={i} className="rounded-sm bg-teal/20 px-0.5 text-teal-deep not-italic">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

function MatchEvidencePanel({ evidence }: { evidence: MatchEvidence }) {
  const yearLabel =
    evidence.yearStatus === "exact"
      ? "年份一致"
      : evidence.yearStatus === "near"
        ? "年份接近"
        : evidence.yearStatus === "mismatch"
          ? "年份不符"
          : null;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-white/90 p-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-accent">匹配对照</p>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-md bg-teal/10 px-2 py-0.5 font-medium text-teal-deep">
          标题 {Math.round(evidence.titleScore * 100)}%
        </span>
        {typeof evidence.titleInBodyScore === "number" ? (
          <span className="rounded-md bg-mist px-2 py-0.5 text-ink">
            标题词覆盖 {Math.round(evidence.titleInBodyScore * 100)}%
          </span>
        ) : null}
        {evidence.abstractScore >= 0.08 ? (
          <span className="rounded-md bg-mist px-2 py-0.5 text-ink">
            摘要重叠 {Math.round(evidence.abstractScore * 100)}%
          </span>
        ) : null}
        {yearLabel ? (
          <span
            className={`rounded-md px-2 py-0.5 ${
              evidence.yearStatus === "mismatch"
                ? "bg-amber-50 text-amber-900"
                : "bg-teal/10 text-teal-deep"
            }`}
          >
            {yearLabel}
          </span>
        ) : null}
        {evidence.doiHit ? (
          <span className="rounded-md bg-teal/10 px-2 py-0.5 font-medium text-teal-deep">DOI 直达</span>
        ) : null}
        {evidence.pmidHit ? (
          <span className="rounded-md bg-teal/10 px-2 py-0.5 font-medium text-teal-deep">PMID 一致</span>
        ) : null}
      </div>

      {evidence.matchedSentences?.length ? (
        <div className="text-[11px]">
          <p className="mb-1 font-medium text-ink-soft">命中来源句</p>
          <ul className="space-y-1">
            {evidence.matchedSentences.map((s) => (
              <li key={s} className="rounded-md border border-line bg-[#f7faf9] px-2 py-1.5 leading-relaxed text-ink">
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2 text-xs">
        <div>
          <p className="mb-1 font-medium text-ink-soft">候选标题（高亮=与命中句重合）</p>
          <p className="text-ink">
            <HighlightText segments={evidence.titleSegments} />
          </p>
        </div>
        <div>
          <p className="mb-1 font-medium text-ink-soft">命中句（高亮=出现在候选标题中）</p>
          <p className="text-ink">
            <HighlightText segments={evidence.querySegments} />
          </p>
        </div>
      </div>

      {evidence.matchedTitleTokens.length ? (
        <div className="text-[11px]">
          <p className="mb-1 font-medium text-ink-soft">重合词</p>
          <div className="flex flex-wrap gap-1">
            {evidence.matchedTitleTokens.map((t) => (
              <span key={t} className="rounded bg-teal/10 px-1.5 py-0.5 text-teal-deep">
                {t}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {evidence.missedTitleTokens.length ? (
        <div className="text-[11px]">
          <p className="mb-1 font-medium text-ink-soft">句中未出现在标题的词</p>
          <div className="flex flex-wrap gap-1">
            {evidence.missedTitleTokens.map((t) => (
              <span key={t} className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">
                {t}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {evidence.abstractSnippets.length ? (
        <div className="text-[11px]">
          <p className="mb-1 font-medium text-ink-soft">摘要中与输入重叠的句子</p>
          <ul className="space-y-1.5">
            {evidence.abstractSnippets.map((s) => (
              <li
                key={s.slice(0, 40)}
                className="rounded-md border border-line bg-[#f7faf9] px-2 py-1.5 leading-relaxed text-ink"
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function MatchInner() {
  const searchParams = useSearchParams();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<MatchHit[]>([]);
  const [sentenceReports, setSentenceReports] = useState<SentenceReport[]>([]);
  const [filterSentence, setFilterSentence] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [format, setFormat] = useState<"apa" | "gbt" | "bibtex">("apa");
  const [copied, setCopied] = useState(false);
  const [booted, setBooted] = useState(false);
  const [notice, setNotice] = useState("");
  const resultsRef = useRef<HTMLElement | null>(null);
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const visibleResults = useMemo(() => {
    if (filterSentence == null) return results;
    const report = sentenceReports.find((r) => r.index === filterSentence);
    if (!report?.hitIds.length) return [];
    const idSet = new Set(report.hitIds);
    return results.filter((r) => idSet.has(r.id));
  }, [results, filterSentence, sentenceReports]);

  const active = useMemo(
    () => visibleResults.find((r) => r.id === activeId) || visibleResults[0] || null,
    [visibleResults, activeId],
  );

  function clearAll() {
    abortRef.current?.abort();
    requestSeq.current += 1;
    setText("");
    setResults([]);
    setSentenceReports([]);
    setFilterSentence(null);
    setActiveId(null);
    setError("");
    setNotice("");
    setCopied(false);
    setLoading(false);
    syncQueryParam("q", "");
  }

  function selectSentence(report: SentenceReport) {
    if (report.hitCount <= 0) {
      setFilterSentence(report.index);
      setActiveId(null);
      return;
    }
    setFilterSentence(report.index);
    setActiveId(report.bestHitId || report.hitIds[0] || null);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function runMatch(overrideText?: string) {
    const payload = (overrideText ?? text).trim();
    if (payload.length < 8) {
      setError("请输入标题或一段正文（至少数个词）");
      setNotice("");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeq.current;

    setLoading(true);
    setError("");
    setNotice("");
    setCopied(false);
    setFilterSentence(null);
    // 长文本不写进 URL，避免截断后 useSearchParams 回填把输入框内容裁掉
    if (payload.length <= 240) syncQueryParam("q", payload);
    else syncQueryParam("q", "");
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: payload.slice(0, MAX_CHARS) }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (seq !== requestSeq.current) return;
      if (!res.ok) throw new Error(data.error || "匹配失败");
      const nextResults: MatchHit[] = data.results || [];
      const reports: SentenceReport[] =
        data.sentenceReports ||
        (data.sentences || []).map((s: string, index: number) => ({
          index,
          text: s,
          hitCount: 0,
          bestScore: 0,
          bestHitId: null,
          hitIds: [],
        }));
      setResults(nextResults);
      setSentenceReports(reports);
      setActiveId(nextResults[0]?.id || null);
      if (data.warning) {
        setNotice(friendlyWarning(data.warning) || String(data.warning));
      }
      if (!nextResults.length) {
        setError(
          data.sourcesFailed || data.warning
            ? "公开文献源暂时不可用或未返回结果，请稍后重试。"
            : "未找到足够接近的候选文献，可换更具体的标题句或关键正文句。",
        );
      } else if (data.truncated) {
        setNotice(
          [
            data.warning ? friendlyWarning(data.warning) || String(data.warning) : "",
            `输入已截断至 ${MAX_CHARS} 字；本次按前 ${data.sentenceCount || 0} 句匹配（最多 10 句）。`,
          ]
            .filter(Boolean)
            .join(" "),
        );
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError(friendlyError(err, "匹配失败，请稍后重试"));
      setNotice("");
      setResults([]);
      setSentenceReports([]);
      setActiveId(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (booted) return;
    setBooted(true);
    const q = searchParams.get("q");
    if (q) {
      setText(q);
      void runMatch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, booted]);

  async function copyActive() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.formats[format]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择文本");
    }
  }

  async function copyAll() {
    const list = filterSentence == null ? results : visibleResults;
    if (!list.length) return;
    const blob = list.map((r, i) => `${i + 1}. ${r.formats[format]}`).join("\n");
    try {
      await navigator.clipboard.writeText(blob);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择文本");
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-ink-soft">
        粘贴标题、摘要或正文即可：自动拆成最多 10
        句，并行检索 OpenAlex / Crossref / Semantic Scholar / PubMed / Europe PMC，合并去重。下方拆分列表会标出是否命中，点击可跳到对应候选与来源信息。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runMatch()}
          disabled={loading}
          className="rounded-md bg-teal px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "匹配中…" : "开始匹配"}
        </button>
        <button
          type="button"
          onClick={() => {
            setText(SAMPLE);
            void runMatch(SAMPLE);
          }}
          disabled={loading}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-mist/50 disabled:opacity-60"
        >
          填入示例
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={loading || (!text && !results.length)}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-mist/50 disabled:opacity-40"
        >
          清空
        </button>
        <span className="text-[11px] text-ink-soft">
          {text.length}/{MAX_CHARS} 字 · 最多 10 句
        </span>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
        rows={8}
        maxLength={MAX_CHARS}
        className="w-full rounded-xl border border-line bg-white/80 p-3 text-sm leading-relaxed outline-none ring-teal/30 focus:ring-2"
        placeholder="粘贴一段话即可（标题、摘要、正文均可）。系统会按句号/换行拆成最多 10 句，再逐句匹配…"
      />

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-line bg-mist/60 px-3 py-2 text-sm text-ink-soft">{notice}</p>
      ) : null}

      {sentenceReports.length ? (
        <div className="rounded-lg border border-line bg-white/70 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-ink-soft">
              已拆分 {sentenceReports.length} 句（上限 10）· 点击句子查看对应候选
            </p>
            {filterSentence != null ? (
              <button
                type="button"
                onClick={() => {
                  setFilterSentence(null);
                  setActiveId(results[0]?.id || null);
                }}
                className="text-[11px] font-medium text-accent underline underline-offset-2 hover:text-teal-deep"
              >
                显示全部候选
              </button>
            ) : null}
          </div>
          <div className="mt-2 space-y-1.5">
            {sentenceReports.map((r) => {
              const matched = r.hitCount > 0;
              const selected = filterSentence === r.index;
              return (
                <button
                  key={r.index}
                  type="button"
                  onClick={() => selectSentence(r)}
                  className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition ${
                    selected
                      ? "border-teal bg-teal/5"
                      : matched
                        ? "border-line bg-white hover:border-teal/40 hover:bg-mist/40"
                        : "border-line bg-[#fbfcfc] hover:bg-mist/30"
                  }`}
                >
                  <span className="mt-0.5 shrink-0 text-[11px] font-semibold text-ink-soft">句{r.index + 1}</span>
                  <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink">
                    {r.text.length > 160 ? `${r.text.slice(0, 160)}…` : r.text}
                  </span>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      matched ? "bg-teal/10 text-teal-deep" : "bg-amber-50 text-amber-900"
                    }`}
                  >
                    {matched ? `已命中 ${r.hitCount} · ${Math.round(r.bestScore * 100)}%` : "未命中"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section
          ref={resultsRef}
          className="rounded-xl border border-line bg-white/85 p-4 shadow-[var(--shadow)]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink">候选文献</h2>
            {visibleResults.length || results.length ? (
              <span className="text-xs text-ink-soft">
                {filterSentence != null
                  ? `句${filterSentence + 1} · ${visibleResults.length} 条`
                  : `共 ${results.length} 条`}
              </span>
            ) : null}
          </div>
          <div className="mt-3 max-h-[560px] space-y-3 overflow-auto pr-1">
            {!results.length ? (
              <p className="text-sm text-ink-soft">匹配后按相关度列出候选；可直接看命中句与重合词，无需逐条跳转。</p>
            ) : null}
            {results.length && !visibleResults.length ? (
              <p className="text-sm text-ink-soft">该句暂无足够接近的候选。可点「显示全部候选」或换一句。</p>
            ) : null}
            {visibleResults.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setActiveId(r.id)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                  active?.id === r.id ? "border-teal bg-teal/5" : "border-line bg-white/70 hover:bg-mist/40"
                }`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-mist px-2 py-0.5 text-xs font-medium text-ink">
                    {Math.round(r.score * 100)}% · {r.scoreLabel}
                  </span>
                  <span className="text-[11px] text-ink-soft">{r.sources.join(" · ")}</span>
                </div>
                <p className="text-sm font-semibold text-ink">
                  {r.evidence?.titleSegments?.length ? (
                    <HighlightText segments={r.evidence.titleSegments} />
                  ) : (
                    r.title
                  )}
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  {r.authors}
                  {r.year ? ` · ${r.year}` : ""}
                  {r.container ? ` · ${r.container}` : ""}
                </p>
                {r.evidence?.reasons?.length ? (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-teal-deep">
                    {r.evidence.reasons.join(" · ")}
                  </p>
                ) : null}
                {r.doi ? <p className="mt-1 text-[11px] text-accent">DOI: {r.doi}</p> : null}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-white/85 p-4 shadow-[var(--shadow)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink">来源信息 / 标准格式</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as "apa" | "gbt" | "bibtex")}
                className="rounded-md border border-line bg-white px-2 py-1 text-xs"
              >
                <option value="apa">APA</option>
                <option value="gbt">GB/T 7714</option>
                <option value="bibtex">BibTeX</option>
              </select>
              <button
                type="button"
                onClick={() => void copyActive()}
                disabled={!active}
                className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-soft hover:bg-mist/50 disabled:opacity-50"
              >
                {copied ? "已复制" : "复制当前"}
              </button>
              <button
                type="button"
                onClick={() => void copyAll()}
                disabled={!visibleResults.length}
                className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-soft hover:bg-mist/50 disabled:opacity-50"
              >
                复制全部
              </button>
            </div>
          </div>

          {!active ? (
            <p className="mt-4 text-sm text-ink-soft">
              {filterSentence != null && !visibleResults.length
                ? "该句未命中候选，右侧无可展示来源。"
                : "选中上方句子或左侧候选后，此处展示匹配对照、库内信息与可引用格式。"}
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {active.evidence ? <MatchEvidencePanel evidence={active.evidence} /> : null}
              <div className="rounded-lg border border-line bg-[#f7faf9] p-3">
                <SourceRecordPanel
                  record={{
                    title: active.title,
                    authors: active.authors,
                    year: active.year,
                    container: active.container,
                    doi: active.doi,
                    pmid: active.pmid,
                    abstract: active.abstract,
                    type: active.type,
                    citedBy: active.citedBy,
                    url: active.url || (active.doi ? `https://doi.org/${active.doi}` : undefined),
                    sources: active.sources,
                    matchScore: active.score,
                  }}
                />
              </div>
              <pre className="whitespace-pre-wrap rounded-lg border border-line bg-white/80 p-3 text-xs leading-relaxed text-ink">
                {active.formats[format]}
              </pre>
              <CrossToolLinks
                doi={active.doi}
                pmid={active.pmid}
                title={active.title}
                journalName={active.container}
                paperUrl={active.url || (active.doi ? `https://doi.org/${active.doi}` : undefined)}
                omit={["match"]}
                className="rounded-md border border-line bg-[#f7faf9] px-3 py-2"
              />
              <p className="text-[11px] text-ink-soft">找到条目后可用「核引文」做字段级真实性核查。</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function MatchClient() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-soft">加载中…</p>}>
      <MatchInner />
    </Suspense>
  );
}
