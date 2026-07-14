"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { syncQueryParam } from "@/lib/syncQuery";
import { CrossToolLinks } from "@/components/CrossToolLinks";
import { friendlyError } from "@/lib/userFacing";

type Trial = {
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

type Paper = {
  title: string;
  doi: string | null;
  year: number | null;
  venue?: string;
};

type RelatedPaper = {
  id: string;
  title: string;
  doi?: string | null;
  year?: number | null;
};

type ExternalRegistries = {
  chictr?: string;
  whoIctrp?: string;
  clinicalTrialsGov?: string;
};

type PaperOa = {
  oaPdfUrl?: string;
  oaLandingUrl?: string;
  europePmcUrl?: string;
} | null;

export function TrialsClient() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paper, setPaper] = useState<Paper | null>(null);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [relatedPapers, setRelatedPapers] = useState<RelatedPaper[]>([]);
  const [ncts, setNcts] = useState<string[]>([]);
  const [mode, setMode] = useState("");
  const [external, setExternal] = useState<ExternalRegistries>({});
  const [paperOa, setPaperOa] = useState<PaperOa>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);

  async function run(q = query) {
    const term = q.trim();
    if (!term) {
      setError("请输入 DOI / PMID / NCT 号或关键词");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    setHasSearched(true);
    syncQueryParam("q", term);
    try {
      const res = await fetch(`/api/trials?q=${encodeURIComponent(term)}`, { signal: controller.signal });
      const data = await res.json();
      if (seq !== requestSeq.current) return;
      if (!res.ok) throw new Error(data.error || "查询失败");
      setPaper(data.paper || null);
      setTrials(data.trials || []);
      setRelatedPapers(data.relatedPapers || []);
      setNcts(data.nctFromCrossref || []);
      setMode(data.mode || "");
      setExternal(data.externalRegistries || {});
      setPaperOa(data.paperOa || null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError(friendlyError(err, "查询失败，请稍后重试"));
      setPaper(null);
      setTrials([]);
      setRelatedPapers([]);
      setNcts([]);
      setMode("");
      setExternal({});
      setPaperOa(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setQuery(q);
      void run(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="DOI / PMID / NCT 号 / 疾病或干预关键词"
          className="min-h-11 flex-1 rounded-md border border-line bg-white/80 px-3 text-sm outline-none ring-teal/30 focus:ring-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="min-h-11 rounded-md bg-teal px-5 text-sm font-medium text-white hover:bg-teal-deep disabled:opacity-60"
        >
          {loading ? "桥接中…" : "论文 ↔ 试验"}
        </button>
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setPaper(null);
            setTrials([]);
            setRelatedPapers([]);
            setNcts([]);
            setMode("");
            setExternal({});
            setPaperOa(null);
            setError("");
            setHasSearched(false);
            abortRef.current?.abort();
            syncQueryParam("q", "");
          }}
          disabled={loading || (!query && !hasSearched)}
          className="min-h-11 rounded-md border border-line px-4 text-sm text-ink-soft hover:bg-mist/50 disabled:opacity-40"
        >
          清空
        </button>
      </form>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      {mode ? (
        <p className="text-xs text-ink-soft">
          {mode === "trial"
            ? "按试验号检索"
            : mode === "paper-bridge"
              ? "按论文桥接试验"
              : mode === "trial-search"
                ? "按关键词检索试验"
                : mode}
          {ncts.length ? ` · 文中登记号：${ncts.join(", ")}` : ""}
        </p>
      ) : null}

      {(external.chictr || external.whoIctrp || external.clinicalTrialsGov) && query.trim() ? (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-ink-soft">扩展注册库（外链）：</span>
          {external.clinicalTrialsGov ? (
            <a
              href={external.clinicalTrialsGov}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent underline underline-offset-2 hover:text-teal-deep"
            >
              国际试验库
              <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                ↗
              </span>
            </a>
          ) : null}
          {external.chictr ? (
            <a
              href={external.chictr}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent underline underline-offset-2 hover:text-teal-deep"
            >
              中国临床试验
              <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                ↗
              </span>
            </a>
          ) : null}
          {external.whoIctrp ? (
            <a
              href={external.whoIctrp}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent underline underline-offset-2 hover:text-teal-deep"
            >
              WHO 试验检索
              <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                ↗
              </span>
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-white/80 p-4">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink">论文侧</h2>
          {!paper ? (
            <p className="mt-3 text-sm text-ink-soft">输入 DOI/PMID 可解析论文，并尝试抽取文中临床试验登记号。</p>
          ) : (
            <div className="mt-3 space-y-2 text-sm">
              <p className="font-medium text-ink">{paper.title}</p>
              <p className="text-xs text-ink-soft">
                {paper.year || "n.d."}
                {paper.venue ? ` · ${paper.venue}` : ""}
                {paper.doi ? ` · ${paper.doi}` : ""}
              </p>
              {paperOa?.europePmcUrl ? (
                <div className="flex flex-wrap gap-3 text-xs text-accent">
                  <a
                    href={paperOa.europePmcUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline underline-offset-2 hover:text-teal-deep"
                  >
                    摘要页
                    <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                      ↗
                    </span>
                  </a>
                </div>
              ) : null}
              <CrossToolLinks
                doi={paper.doi}
                title={paper.title}
                venue={paper.venue}
                dataQuery={trials[0]?.conditions?.[0] || paper.title}
                oaPdfUrl={paperOa?.oaPdfUrl}
                paperUrl={paper.doi ? `https://doi.org/${paper.doi}` : undefined}
                omit={["trials"]}
                className="mt-2"
              />
            </div>
          )}

          <h3 className="mt-6 text-sm font-semibold text-ink">相关高被引文献</h3>
          <div className="mt-2 max-h-72 space-y-2 overflow-auto">
            {relatedPapers.map((p) => (
              <div key={p.id} className="rounded-md border border-line px-3 py-2 text-xs hover:bg-mist/40">
                <a
                  href={p.doi ? `https://doi.org/${p.doi}` : `https://openalex.org/${p.id.split("/").pop()}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-ink hover:text-teal-deep"
                >
                  {p.title}
                </a>
                <p className="mt-1 text-ink-soft">
                  {p.year || "n.d."}
                  {p.doi ? ` · ${p.doi}` : ""}
                </p>
                {p.doi ? (
                  <CrossToolLinks doi={p.doi} title={p.title} omit={["trials", "datasets"]} className="mt-1" />
                ) : null}
              </div>
            ))}
            {!relatedPapers.length && hasSearched && !loading ? (
              <p className="text-xs text-ink-soft">暂无相关文献。</p>
            ) : null}
            {!relatedPapers.length && !hasSearched ? (
              <p className="text-xs text-ink-soft">检索后显示相关高被引文献。</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-white/80 p-4">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink">
            试验命中 · {trials.length}
          </h2>
          <p className="mt-1 text-[11px] text-ink-soft">
            优先展示可直接打开的注册记录；中国与 WHO 注册请用上方扩展外链。
          </p>
          <div className="mt-3 max-h-[560px] space-y-3 overflow-auto">
            {trials.map((t) => (
              <article key={t.nctId} className="rounded-lg border border-line px-3 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-950">{t.nctId}</span>
                  {t.status ? <span className="text-ink-soft">{t.status}</span> : null}
                  {t.phase ? (
                    <span className="text-ink-soft">{Array.isArray(t.phase) ? t.phase.join(", ") : t.phase}</span>
                  ) : null}
                </div>
                <a href={t.url} target="_blank" rel="noreferrer" className="mt-1 block text-sm font-semibold text-ink hover:text-teal-deep">
                  {t.title}
                </a>
                <p className="mt-1 text-xs text-ink-soft">
                  {t.sponsor || "—"}
                  {t.startDate ? ` · ${t.startDate}` : ""}
                </p>
                {t.conditions?.length ? (
                  <p className="mt-2 text-xs text-ink-soft">Conditions: {t.conditions.join(" · ")}</p>
                ) : null}
                {t.interventions?.length ? (
                  <p className="mt-1 text-xs text-ink-soft">Interventions: {t.interventions.join(" · ")}</p>
                ) : null}
              </article>
            ))}
            {!trials.length && !loading && hasSearched ? (
              <p className="text-sm text-ink-soft">暂无试验命中；可试 ChiCTR / WHO ICTRP 外链。</p>
            ) : null}
            {!trials.length && !loading && !hasSearched ? (
              <p className="text-sm text-ink-soft">输入 DOI、PMID、NCT 或关键词后开始桥接。</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
