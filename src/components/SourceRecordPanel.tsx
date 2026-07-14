type SourceRecordLike = {
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
};

export function SourceRecordPanel({
  record,
  emptyHint = "选中一条结果后，这里展示库内命中的信息页，便于当场核对。",
}: {
  record?: SourceRecordLike | null;
  emptyHint?: string;
}) {
  if (!record) {
    return <p className="text-sm text-ink-soft">{emptyHint}</p>;
  }

  const meta: Array<[string, string]> = [];
  if (record.authors || record.firstAuthor) meta.push(["作者", record.authors || record.firstAuthor || ""]);
  if (record.year != null) meta.push(["年份", String(record.year)]);
  if (record.container) meta.push(["期刊/来源", record.container]);
  if (record.doi) meta.push(["DOI", record.doi]);
  if (record.pmid) meta.push(["PMID", record.pmid]);
  if (record.volume || record.issue || record.pages) {
    const loc = [record.volume && `卷 ${record.volume}`, record.issue && `期 ${record.issue}`, record.pages && `页 ${record.pages}`]
      .filter(Boolean)
      .join(" · ");
    if (loc) meta.push(["卷期页", loc]);
  }
  if (record.type) meta.push(["类型", record.type]);
  if (typeof record.citedBy === "number") meta.push(["被引", String(record.citedBy)]);
  if (record.sources?.length) meta.push(["命中源", record.sources.join(" · ")]);
  if (typeof record.matchScore === "number") {
    meta.push(["标题相近度", `${Math.round(record.matchScore * 100)}%`]);
  }

  const sourceHref = record.url || (record.doi ? `https://doi.org/${record.doi}` : null);
  const doiHref = record.doi
    ? `https://doi.org/${String(record.doi).replace(/^https?:\/\/doi\.org\//i, "")}`
    : null;
  const pmidHref = record.pmid
    ? `https://pubmed.ncbi.nlm.nih.gov/${String(record.pmid).replace(/\D/g, "")}/`
    : null;

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-[11px] uppercase tracking-[0.14em] text-accent">库内命中信息</p>
        <h3 className="mt-1 font-[family-name:var(--font-display)] text-base font-semibold leading-snug text-ink">
          {record.title || "（无标题）"}
        </h3>
      </div>
      <dl className="space-y-1.5 text-xs">
        {meta.map(([k, v]) => {
          let href: string | null = null;
          if (k === "DOI" && doiHref) href = doiHref;
          if (k === "PMID" && pmidHref) href = pmidHref;
          return (
            <div key={k} className="grid grid-cols-[4.5rem_1fr] gap-2">
              <dt className="text-ink-soft">{k}</dt>
              <dd className="break-all text-ink">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-accent underline underline-offset-2 hover:text-teal-deep"
                  >
                    {v}
                    <span className="ml-0.5 inline-block text-[10px] no-underline opacity-80" aria-hidden>
                      ↗
                    </span>
                  </a>
                ) : (
                  v
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {record.abstract ? (
        <div>
          <p className="text-xs font-medium text-ink">摘要</p>
          <p className="mt-1 max-h-40 overflow-auto text-xs leading-relaxed text-ink-soft">{record.abstract}</p>
        </div>
      ) : (
        <p className="text-[11px] text-ink-soft">该命中暂无摘要字段。</p>
      )}
      {sourceHref ? (
        <a
          href={sourceHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-xs font-medium text-accent underline underline-offset-2 hover:border-accent/50 hover:bg-accent/10 hover:text-teal-deep"
        >
          打开来源页
          <span aria-hidden>↗</span>
        </a>
      ) : null}
    </div>
  );
}
