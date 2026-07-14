type CrossToolLinksProps = {
  doi?: string | null;
  pmid?: string | null;
  title?: string | null;
  venue?: string | null;
  journalName?: string | null;
  dataQuery?: string | null;
  /** Direct landing / publisher URL when known */
  paperUrl?: string | null;
  /** Open-access PDF when known */
  oaPdfUrl?: string | null;
  omit?: Array<"map" | "trials" | "datasets" | "journals" | "papers" | "paperOpen" | "citations" | "match">;
  className?: string;
};

function seedQuery(doi?: string | null, pmid?: string | null, title?: string | null) {
  if (doi) return doi;
  if (pmid) return `PMID:${pmid}`;
  return (title || "").trim();
}

function doiUrl(doi?: string | null) {
  if (!doi) return null;
  const clean = doi.replace(/^https?:\/\/doi\.org\//i, "").trim();
  return clean ? `https://doi.org/${clean}` : null;
}

function pubmedUrl(pmid?: string | null) {
  if (!pmid) return null;
  const id = String(pmid).replace(/\D/g, "");
  return id ? `https://pubmed.ncbi.nlm.nih.gov/${id}/` : null;
}

type LinkItem = { key: string; href: string; label: string; external?: boolean };

/** In-site tool jumps + direct paper open when DOI/PDF is known. */
export function CrossToolLinks({
  doi,
  pmid,
  title,
  venue,
  journalName,
  dataQuery,
  paperUrl,
  oaPdfUrl,
  omit = [],
  className = "",
}: CrossToolLinksProps) {
  const seed = seedQuery(doi, pmid, title);
  const journalQ = (journalName || venue || "").trim();
  const dataQ = (dataQuery || title || journalQ || seed).trim();
  const citeHint = doi || title || "";
  const matchHint = (title || "").trim();

  const direct: LinkItem[] = [];
  const tools: LinkItem[] = [];

  // Direct open — prefer OA PDF, then explicit URL, then DOI, then PubMed
  if (!omit.includes("paperOpen")) {
    if (oaPdfUrl) {
      direct.push({ key: "pdf", href: oaPdfUrl, label: "PDF", external: true });
    }
    const open =
      paperUrl ||
      doiUrl(doi) ||
      pubmedUrl(pmid) ||
      null;
    if (open) {
      // Avoid duplicating the same URL as PDF
      if (!oaPdfUrl || open !== oaPdfUrl) {
        direct.push({ key: "open", href: open, label: "原文", external: true });
      }
    }
  }

  if (seed && !omit.includes("map")) {
    tools.push({ key: "map", href: `/map?q=${encodeURIComponent(seed)}`, label: "图谱" });
  }
  if (seed && !omit.includes("trials")) {
    tools.push({ key: "trials", href: `/trials?q=${encodeURIComponent(seed)}`, label: "试验" });
  }
  if (dataQ && !omit.includes("datasets")) {
    tools.push({ key: "datasets", href: `/datasets?q=${encodeURIComponent(dataQ)}`, label: "数据" });
  }
  if (journalQ && !omit.includes("journals")) {
    tools.push({ key: "journals", href: `/journals?q=${encodeURIComponent(journalQ)}`, label: "选刊" });
  }
  // Keep in-site paper search even when direct open exists
  if (seed && !omit.includes("papers")) {
    tools.push({ key: "papers", href: `/papers?q=${encodeURIComponent(seed)}`, label: "查找论文" });
  }
  if (matchHint && !omit.includes("match")) {
    tools.push({
      key: "match",
      href: `/match?q=${encodeURIComponent(matchHint.slice(0, 200))}`,
      label: "引文匹配",
    });
  }
  if (citeHint && !omit.includes("citations")) {
    tools.push({
      key: "citations",
      href: `/citations?seed=${encodeURIComponent(citeHint)}`,
      label: "核引文",
    });
  }

  if (!direct.length && !tools.length) return null;

  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-1 text-xs text-accent ${className}`.trim()}>
      {direct.length ? (
        <>
          <span className="text-ink-soft">直达</span>
          {direct.map((l) => (
            <a
              key={l.key}
              href={l.href}
              className="font-medium underline underline-offset-2 hover:text-teal-deep"
              {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
            >
              {l.label}
              {l.external ? (
                <span className="ml-0.5 inline-block text-[10px] no-underline opacity-80" aria-hidden>
                  ↗
                </span>
              ) : null}
            </a>
          ))}
        </>
      ) : null}
      {tools.length ? (
        <>
          <span className="text-ink-soft">{direct.length ? "· 站内" : "站内"}</span>
          {tools.map((l) => (
            <a key={l.key} href={l.href} className="underline underline-offset-2 hover:text-teal-deep">
              {l.label}
            </a>
          ))}
        </>
      ) : null}
    </div>
  );
}
