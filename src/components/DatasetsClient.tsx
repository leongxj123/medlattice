"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { syncQueryParam } from "@/lib/syncQuery";
import { CrossToolLinks } from "@/components/CrossToolLinks";
import { friendlyError, friendlyWarning } from "@/lib/userFacing";

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

const TAG_CLASS: Record<string, string> = {
  DATA: "bg-accent/10 text-accent",
  OMICS: "bg-teal/10 text-teal-deep",
  GEO: "bg-teal/15 text-teal-deep",
  FDA: "bg-amber-100 text-amber-950",
  PAPER: "bg-mist text-ink",
  TRIAL: "bg-amber-50 text-amber-900",
  BOOKMARK: "bg-mist text-ink-soft",
};

function DatasetsInner() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const [type, setType] = useState("all");
  const [since, setSince] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [facets, setFacets] = useState({ data: 0, paper: 0, trial: 0 });
  const [citeTarget, setCiteTarget] = useState<Hit | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [warning, setWarning] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);
  const skipFilterEffect = useRef(true);

  async function search(overrideQ?: string) {
    const q = (overrideQ ?? query).trim();
    if (!q) {
      setError("请输入检索关键词");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    setWarning("");
    setHasSearched(true);
    setQuery(q);
    syncQueryParam("q", q);
    try {
      const params = new URLSearchParams({ q, sort, type });
      if (since) params.set("since", since);
      const res = await fetch(`/api/datasets?${params}`, { signal: controller.signal });
      const data = await res.json();
      if (seq !== requestSeq.current) return;
      if (!res.ok) throw new Error(data.error || "检索失败");
      setHits(data.hits || []);
      setFacets(data.facets || { data: 0, paper: 0, trial: 0 });
      if (data.warning) setWarning(friendlyWarning(data.warning) || String(data.warning));
      if (!(data.hits || []).length && !data.warning) {
        setError("未找到结果，可换关键词或放宽筛选试试。");
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError(friendlyError(err, "检索失败，请稍后重试"));
      setHits([]);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) void search(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (skipFilterEffect.current) {
      skipFilterEffect.current = false;
      return;
    }
    if (!hasSearched || !query.trim()) return;
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, type, since]);

  const citeText = useMemo(() => {
    if (!citeTarget) return null;
    const year = citeTarget.year || "n.d.";
    const esc = (s: string) =>
      s.replace(/\\/g, "\\\\").replace(/[{}]/g, (ch) => `\\${ch}`).replace(/[#%&_$]/g, (ch) => `\\${ch}`);
    const apa = `${citeTarget.authors}. (${year}). ${citeTarget.title}. ${citeTarget.venue || ""}${
      citeTarget.doi ? `. https://doi.org/${citeTarget.doi}` : ""
    }`;
    const gbt = `${citeTarget.authors}. ${citeTarget.title}[DB/OL]. ${citeTarget.venue || ""}, ${year}.`;
    const bib = `@misc{${(citeTarget.doi || citeTarget.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)},\n  title={${esc(citeTarget.title)}},\n  author={${esc(citeTarget.authors)}},\n  year={${year}}\n}`;
    return { apa, gbt, bib };
  }, [citeTarget]);

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="space-y-3"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="疾病、干预、组学、药品、临床试验关键词…"
            className="min-h-11 flex-1 rounded-md border border-line bg-white/80 px-3 text-sm outline-none ring-teal/30 focus:ring-2"
          />
          <button
            type="submit"
            disabled={loading}
            className="min-h-11 rounded-md bg-teal px-5 text-sm font-medium text-white hover:bg-teal-deep disabled:opacity-60"
          >
            {loading ? "检索中…" : "检索"}
          </button>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setHits([]);
              setFacets({ data: 0, paper: 0, trial: 0 });
              setCiteTarget(null);
              setError("");
              setWarning("");
              setHasSearched(false);
              setSort("relevance");
              setType("all");
              setSince("");
              abortRef.current?.abort();
              syncQueryParam("q", "");
            }}
            disabled={loading || (!query && !hasSearched)}
            className="min-h-11 rounded-md border border-line px-4 text-sm text-ink-soft hover:bg-mist/50 disabled:opacity-40"
          >
            清空
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <select value={since} onChange={(e) => setSince(e.target.value)} className="rounded-md border border-line bg-white/80 px-2 py-1.5">
            <option value="">时间不限</option>
            <option value="2024">2024以来</option>
            <option value="2022">2022以来</option>
            <option value="2020">2020以来</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-md border border-line bg-white/80 px-2 py-1.5">
            <option value="relevance">相关性</option>
            <option value="date">日期</option>
            <option value="citations">引用数</option>
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-md border border-line bg-white/80 px-2 py-1.5">
            <option value="all">全部类型</option>
            <option value="data">公开数据/数据集</option>
            <option value="paper">学术论文</option>
            <option value="trial">临床试验</option>
          </select>
        </div>
      </form>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      {warning ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{warning}</p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <p className="text-xs text-ink-soft">
            {hasSearched
              ? `当前结果 ${hits.length} 条 · 数据 ${facets.data} · 论文 ${facets.paper} · 试验 ${facets.trial}`
              : "尚未检索"}
          </p>
          {!hasSearched && !loading ? (
            <p className="text-sm text-ink-soft">
              输入关键词检索组学数据、药品安全、临床试验与相关论文；也可从论文/试验页一键带入查询。
            </p>
          ) : null}
          {hasSearched && !hits.length && !loading ? (
            <p className="text-sm text-ink-soft">未找到结果，可换关键词或放宽类型过滤。</p>
          ) : null}
          {hits.map((item) => (
            <article key={item.id} className="rounded-xl border border-line bg-white/80 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${TAG_CLASS[item.tag] || "bg-mist"}`}>
                  {item.tag}
                </span>
                {item.downloadable ? <span className="text-[11px] text-accent">可下载</span> : null}
                {item.year ? <span className="text-[11px] text-ink-soft">{item.year}</span> : null}
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block text-base font-semibold text-ink hover:text-teal-deep"
              >
                {item.title}
              </a>
              <p className="mt-1 text-xs text-ink-soft">
                {item.authors}
                {item.venue ? ` · ${item.venue}` : ""}
                {item.doi ? ` · DOI ${item.doi}` : ""}
              </p>
              {item.description ? <p className="mt-2 text-sm text-ink-soft">{item.description}</p> : null}
              {item.domain?.length ? (
                <p className="mt-1 text-[11px] text-ink-soft">{item.domain.join(" · ")}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                {typeof item.cited === "number" ? <span className="text-ink-soft">被引 {item.cited}</span> : null}
                <button type="button" onClick={() => setCiteTarget(item)} className="text-accent hover:underline">
                  引用
                </button>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent underline underline-offset-2 hover:text-teal-deep"
                >
                  打开
                  <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>
                    ↗
                  </span>
                </a>
                {item.doi || item.kind === "paper" ? (
                  <CrossToolLinks
                    doi={item.doi}
                    title={item.title}
                    venue={item.venue}
                    paperUrl={item.doi ? `https://doi.org/${item.doi}` : item.url || undefined}
                    omit={["datasets"]}
                  />
                ) : item.kind === "trial" ? (
                  <a className="text-accent hover:underline" href={`/trials?q=${encodeURIComponent(item.title)}`}>
                    试验桥接
                  </a>
                ) : (
                  <a className="text-accent hover:underline" href={`/papers?q=${encodeURIComponent(item.title)}`}>
                    相关论文
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>

        <aside className="h-fit rounded-xl border border-line bg-white/80 p-4">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink">覆盖范围</h2>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-soft">
            <li>组学与仓储聚合数据</li>
            <li>表达谱系列</li>
            <li>药品不良事件</li>
            <li>数据集 DOI</li>
            <li>临床试验注册</li>
            <li>相关学术论文</li>
            <li>权威门户书签</li>
          </ul>
        </aside>
      </div>

      {citeTarget && citeText ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" onClick={() => setCiteTarget(null)}>
          <div
            className="w-full max-w-lg rounded-xl border border-line bg-white p-5 shadow-[var(--shadow)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">引用格式</h3>
            <p className="mt-1 text-xs text-ink-soft">{citeTarget.title}</p>
            <div className="mt-4 space-y-3 text-xs leading-relaxed text-ink-soft">
              <div>
                <p className="mb-1 font-medium text-ink">APA</p>
                <pre className="whitespace-pre-wrap rounded-md bg-[#f7faf9] p-2">{citeText.apa}</pre>
              </div>
              <div>
                <p className="mb-1 font-medium text-ink">GB/T 7714</p>
                <pre className="whitespace-pre-wrap rounded-md bg-[#f7faf9] p-2">{citeText.gbt}</pre>
              </div>
              <div>
                <p className="mb-1 font-medium text-ink">BibTeX</p>
                <pre className="whitespace-pre-wrap rounded-md bg-[#f7faf9] p-2">{citeText.bib}</pre>
              </div>
            </div>
            <button
              type="button"
              className="mt-4 rounded-md bg-teal px-4 py-2 text-sm text-white"
              onClick={() => setCiteTarget(null)}
            >
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DatasetsClient() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-soft">加载中…</p>}>
      <DatasetsInner />
    </Suspense>
  );
}
