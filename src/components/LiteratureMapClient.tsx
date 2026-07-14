"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { syncQueryParam } from "@/lib/syncQuery";
import { CrossToolLinks } from "@/components/CrossToolLinks";
import { friendlyError } from "@/lib/userFacing";

type MapNode = {
  id: string;
  title: string;
  year: number | null;
  cited: number;
  authors: string;
  venue?: string;
  doi?: string | null;
  pmid?: string | null;
  abstract?: string;
  evidence?: string[];
  isOa?: boolean;
  x: number;
  y: number;
  isSeed?: boolean;
  refs?: number;
  relation?: "seed" | "related" | "reference" | "cited-by";
};

type MapEdge = { source: string; target: string; relation?: string };
type Suggest = {
  id: string;
  title: string;
  year?: number;
  cited?: number;
  authors?: string;
  venue?: string;
  doi?: string;
  pmid?: string;
  evidence?: string[];
};

function yearColor(year: number | null) {
  if (!year) return "#64748b";
  if (year >= 2022) return "#0f5c56";
  if (year >= 2018) return "#2a6f8f";
  if (year >= 2012) return "#4f7cac";
  return "#8aa0b4";
}

const RELATION_LABEL: Record<string, string> = {
  seed: "种子",
  related: "相似",
  reference: "参考文献",
  "cited-by": "被引",
};

export function LiteratureMapClient() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [suggests, setSuggests] = useState<Suggest[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [seedTitle, setSeedTitle] = useState("");
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [mode, setMode] = useState("");
  const [stats, setStats] = useState<{ related?: number; references?: number; citedBy?: number } | null>(null);
  const [view, setView] = useState<"map" | "list" | "detail" | "year">("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [filterRel, setFilterRel] = useState<"all" | "related" | "reference" | "cited-by">("all");
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) || nodes.find((n) => n.isSeed) || null,
    [nodes, selectedId],
  );

  const visibleNodes = useMemo(() => {
    if (filterRel === "all") return nodes;
    return nodes.filter((n) => n.isSeed || n.relation === filterRel);
  }, [nodes, filterRel]);

  const years = useMemo(() => {
    const ys = nodes.map((n) => n.year).filter(Boolean) as number[];
    if (!ys.length) return { min: 2000, max: 2026 };
    return { min: Math.min(...ys), max: Math.max(...ys) };
  }, [nodes]);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setQuery(q);
      void runSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || !suggestOpen) {
      if (q.length < 3) setSuggests([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (suggestOpen) setSuggests((data.results || []).slice(0, 6));
      } catch {
        setSuggests([]);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [query, suggestOpen]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!inputWrapRef.current?.contains(e.target as Node)) setSuggestOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSuggestOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function runSearch(q = query) {
    if (!q.trim()) {
      setError("请输入 DOI、PMID 或标题");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    setWarning("");
    setSuggests([]);
    setSuggestOpen(false);
    syncQueryParam("q", q);
    try {
      const res = await fetch(`/api/map?q=${encodeURIComponent(q.trim())}`, { signal: controller.signal });
      const data = await res.json();
      if (seq !== requestSeq.current) return;
      if (!res.ok) throw new Error(data.error || "查询失败");
      setSeedTitle(data.seedTitle);
      setNodes(data.nodes);
      setEdges(data.edges);
      setMode(data.mode || "");
      setStats(data.stats || null);
      setSelectedId(data.seed?.id || data.nodes?.[0]?.id || null);
      setView("map");
      if (data.warning) setWarning(String(data.warning));
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError(friendlyError(err, "图谱构建失败，请换 DOI/PMID 或标题重试"));
      setNodes([]);
      setEdges([]);
      setWarning("");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  const showSuggest = suggestOpen && suggests.length > 0 && !loading;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <div className="relative min-w-0 flex-1" ref={inputWrapRef}>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSuggestOpen(true);
            }}
            onFocus={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current);
              setSuggestOpen(true);
            }}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setSuggestOpen(false), 160);
            }}
            placeholder="输入 DOI、PMID 或论文标题"
            className="min-h-11 w-full rounded-md border border-line bg-white/80 px-3 text-sm outline-none ring-teal/30 focus:ring-2"
            autoComplete="off"
          />
          {showSuggest ? (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-auto rounded-md border border-line bg-white shadow-[var(--shadow)]">
              <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white px-3 py-1.5">
                <span className="text-[11px] text-ink-soft">候选论文（点选后生成图谱）</span>
                <button
                  type="button"
                  className="text-[11px] text-ink-soft hover:text-ink"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setSuggestOpen(false)}
                >
                  收起
                </button>
              </div>
              {suggests.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="block w-full border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-mist/50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const next = s.doi || (s.pmid ? `PMID:${s.pmid}` : s.id);
                    setQuery(next);
                    setSuggests([]);
                    setSuggestOpen(false);
                    void runSearch(next);
                  }}
                >
                  <p className="line-clamp-2 text-sm font-medium text-ink">{s.title}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    {s.venue ? `${s.venue} · ` : ""}
                    {s.year || "n.d."}
                    {typeof s.cited === "number" ? ` · 被引 ${s.cited}` : ""}
                    {s.evidence?.length ? ` · ${s.evidence.join("/")}` : ""}
                  </p>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="min-h-11 shrink-0 rounded-md bg-teal px-5 text-sm font-medium text-white hover:bg-teal-deep disabled:opacity-60"
        >
          {loading ? "构建中…" : "生成文献图谱"}
        </button>
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setNodes([]);
            setEdges([]);
            setSelectedId(null);
            setSeedTitle("");
            setMode("");
            setStats(null);
            setSuggests([]);
            setSuggestOpen(false);
            setError("");
            setWarning("");
            setView("map");
            setHoverId(null);
            setFilterRel("all");
            abortRef.current?.abort();
            syncQueryParam("q", "");
          }}
          disabled={loading || (!query && !nodes.length)}
          className="min-h-11 shrink-0 rounded-md border border-line px-4 text-sm text-ink-soft hover:bg-mist/50 disabled:opacity-40"
        >
          清空
        </button>
      </form>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      {warning ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{warning}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-ink-soft">
          {seedTitle || "等待选择种子论文"}
          {mode ? ` · ${mode === "citation-neighborhood" ? "引文邻域图" : "邻居较少"}` : ""}
          {stats
            ? ` · 相似 ${stats.related || 0} / 参考文献 ${stats.references || 0} / 被引 ${stats.citedBy || 0}`
            : ""}
        </div>
        <div className="flex flex-wrap gap-1">
          {(["all", "related", "reference", "cited-by"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setFilterRel(r)}
              className={`rounded-md px-2 py-1 text-xs ${filterRel === r ? "bg-accent/15 text-accent" : "bg-mist/60 text-ink-soft"}`}
            >
              {r === "all" ? "全部" : RELATION_LABEL[r]}
            </button>
          ))}
          {(["map", "list", "detail", "year"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 text-xs ${view === v ? "bg-teal text-white" : "bg-mist/70 text-ink-soft"}`}
            >
              {{ map: "图谱", list: "列表", detail: "详情", year: "年份" }[v]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="overflow-hidden rounded-xl border border-line bg-white/70 shadow-[var(--shadow)]">
          {view === "map" ? (
            <div className="relative h-[540px] lattice-grid bg-[linear-gradient(180deg,#f7faf9,#eef4f2)]">
              {nodes.length === 0 && !loading ? (
                <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-ink-soft">
                  输入 DOI / PMID / 标题并检索，生成可点击的研究地图。圆点大小=被引，颜色=年份。
                </div>
              ) : null}
              <svg viewBox="0 0 1000 540" className="h-full w-full">
                {edges.map((edge, i) => {
                  const a = visibleNodes.find((n) => n.id === edge.source) || nodes.find((n) => n.id === edge.source);
                  const b = visibleNodes.find((n) => n.id === edge.target);
                  if (!a || !b) return null;
                  const dim = hoverId && hoverId !== a.id && hoverId !== b.id;
                  return (
                    <line
                      key={`${edge.source}-${edge.target}-${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={dim ? "rgba(15,92,86,0.05)" : "rgba(15,92,86,0.25)"}
                      strokeWidth="1.2"
                    />
                  );
                })}
                {visibleNodes.map((node) => {
                  const r = Math.max(9, Math.min(30, 9 + Math.sqrt(node.cited || 1) * 0.55));
                  const dim = hoverId && hoverId !== node.id && !node.isSeed;
                  return (
                    <g
                      key={node.id}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoverId(node.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={() => {
                        setSelectedId(node.id);
                        setView("detail");
                      }}
                      onDoubleClick={() => {
                        setSelectedId(node.id);
                        setView("detail");
                        if (node.doi) void runSearch(node.doi);
                        else if (node.pmid) void runSearch(`PMID:${node.pmid}`);
                      }}
                    >
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={r}
                        fill={yearColor(node.year)}
                        fillOpacity={dim ? 0.25 : node.isSeed ? 1 : 0.88}
                        stroke={node.isSeed || selectedId === node.id ? "#132528" : "transparent"}
                        strokeWidth={node.isSeed ? 3 : selectedId === node.id ? 2 : 0}
                      />
                      <title>{`${node.title} · ${RELATION_LABEL[node.relation || ""] || ""} · 被引 ${node.cited}`}</title>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : null}

          {view === "list" ? (
            <div className="max-h-[540px] space-y-2 overflow-auto p-3">
              {[...visibleNodes]
                .sort((a, b) => b.cited - a.cited)
                .map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(n.id);
                      setView("detail");
                    }}
                    className="block w-full rounded-lg border border-line px-3 py-2 text-left hover:bg-mist/40"
                  >
                    <p className="text-sm font-medium text-ink">
                      {n.relation ? `${RELATION_LABEL[n.relation]} · ` : ""}
                      {n.title}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {n.venue ? `${n.venue} · ` : ""}
                      {n.year || "n.d."} · 被引 {n.cited}
                      {n.evidence?.length ? ` · ${n.evidence.join(" / ")}` : ""}
                    </p>
                  </button>
                ))}
            </div>
          ) : null}

          {view === "detail" && selected ? (
            <div className="max-h-[540px] overflow-auto p-5">
              <p className="text-xs uppercase tracking-[0.16em] text-accent">
                {RELATION_LABEL[selected.relation || "seed"] || "Paper"}
              </p>
              <h3 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold text-ink">{selected.title}</h3>
              <p className="mt-2 text-sm text-ink-soft">
                {selected.authors}
                {selected.year ? ` · ${selected.year}` : ""}
                {selected.venue ? ` · ${selected.venue}` : ""}
              </p>
              {selected.evidence?.length ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {selected.evidence.map((tag) => (
                    <span key={tag} className="rounded-md bg-teal/10 px-2 py-0.5 text-xs text-teal-deep">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="mt-3 text-sm text-ink-soft">
                被引 {selected.cited} · 参考文献 {selected.refs || 0}
                {selected.isOa ? " · OA" : ""}
              </p>
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">{selected.abstract || "暂无摘要。"}</p>
            </div>
          ) : null}

          {view === "year" ? (
            <div className="grid h-[540px] place-items-center p-6">
              <div className="w-full max-w-md">
                <p className="mb-3 text-sm text-ink-soft">
                  年份色带：{years.min} → {years.max}
                </p>
                <div className="h-3 rounded-full bg-[linear-gradient(90deg,#8aa0b4,#4f7cac,#2a6f8f,#0f5c56)]" />
                <ul className="mt-6 space-y-2 text-sm text-ink-soft">
                  {[...nodes]
                    .filter((n) => n.year)
                    .sort((a, b) => (b.year || 0) - (a.year || 0))
                    .slice(0, 12)
                    .map((n) => (
                      <li key={n.id}>
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: yearColor(n.year) }} />{" "}
                        {n.year} · {n.title.slice(0, 52)}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="rounded-xl border border-line bg-white/80 p-4">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink">论文详情</h2>
          {!selected ? (
            <div className="mt-3 space-y-1">
              <p className="text-sm text-ink-soft">点击图谱节点查看摘要与站内延伸工具。</p>
              <p className="text-[11px] text-ink-soft">证据标签为启发式提示，非正式证据分级。</p>
            </div>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              <p className="font-medium text-ink">{selected.title}</p>
              <p className="text-xs text-ink-soft">{selected.authors}</p>
              <p className="text-xs text-ink-soft">
                {selected.year || "—"} · 被引 {selected.cited} · 参考文献 {selected.refs || 0}
                {selected.venue ? ` · ${selected.venue}` : ""}
              </p>
              {selected.evidence?.length ? (
                <p className="text-xs text-accent">{selected.evidence.join(" · ")}</p>
              ) : null}
              <p className="text-xs leading-relaxed text-ink-soft">{selected.abstract || "暂无摘要"}</p>
              <CrossToolLinks
                doi={selected.doi}
                pmid={selected.pmid}
                title={selected.title}
                venue={selected.venue}
                paperUrl={selected.doi ? `https://doi.org/${selected.doi}` : undefined}
                omit={["map"]}
                className="rounded-md border border-line bg-[#f7faf9] px-3 py-2"
              />
              <button
                type="button"
                className="rounded-md bg-teal px-3 py-1.5 text-xs font-medium text-white"
                onClick={() => void runSearch(selected.doi || (selected.pmid ? `PMID:${selected.pmid}` : selected.id))}
              >
                以此为中心重建图谱
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
