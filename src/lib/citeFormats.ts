/** Structured author for citation formatting. */
export type CiteAuthor = {
  family?: string;
  given?: string;
  /** Fallback display name when family/given unavailable */
  name?: string;
};

export type FormatInput = {
  authors?: CiteAuthor[] | string;
  title?: string;
  container?: string;
  year?: string | number;
  doi?: string;
  volume?: string | number;
  issue?: string | number;
  pages?: string;
  /** OpenAlex/Crossref type hint for GB/T marker + BibTeX entry */
  type?: string;
};

function clean(s?: string | number | null) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAuthorString(raw: string): CiteAuthor[] {
  const text = raw.replace(/\s+et\s+al\.?/i, "").trim();
  if (!text || text === "—" || /^unknown$/i.test(text)) return [];

  // Already "Family, Given and Family, Given"
  if (/\band\b/i.test(text) && text.includes(",")) {
    return text.split(/\s+and\s+/i).map((part) => {
      const [family, ...rest] = part.split(",").map((x) => x.trim());
      return { family, given: rest.join(" ").trim() || undefined };
    });
  }

  // "Harris Paul A., Taylor Robert, Thielke Robert"
  return text
    .split(/,\s*(?=[A-Z\u4e00-\u9fff])/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      // "Harris, P. A." APA-ish
      if (/,/.test(part)) {
        const [family, ...rest] = part.split(",").map((x) => x.trim());
        return { family, given: rest.join(" ").replace(/\./g, ". ").replace(/\s+/g, " ").trim() || undefined };
      }
      // "Harris Paul A." or "Harris PA" or Chinese "张三"
      const tokens = part.split(/\s+/).filter(Boolean);
      if (tokens.length === 1) return { family: tokens[0] };
      // If last token looks like surname (OpenAlex "Paul A. Harris") — rare in our joined strings
      // Our pipeline usually emits "Family Given"
      const family = tokens[0];
      const given = tokens.slice(1).join(" ");
      return { family, given };
    });
}

function asAuthors(authors?: CiteAuthor[] | string): CiteAuthor[] {
  if (!authors) return [];
  if (typeof authors === "string") return parseAuthorString(authors);
  return authors.filter((a) => a.family || a.given || a.name);
}

function initialsFromGiven(given?: string) {
  if (!given) return "";
  const parts = given
    .replace(/\./g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 0);
  return parts.map((p) => `${p[0]!.toUpperCase()}.`).join(" ");
}

function gbtInitials(given?: string) {
  if (!given) return "";
  const parts = given
    .replace(/\./g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 0);
  // GB/T Western: family + uppercase initials without dots, e.g. Harris PA
  return parts.map((p) => p[0]!.toUpperCase()).join("");
}

function formatApaAuthors(authors: CiteAuthor[]) {
  // APA 7: list up to 20; 21+ → first 19, …, last
  if (authors.length > 20) {
    const head = authors.slice(0, 19).map((a) => {
      if (a.family) {
        const ini = initialsFromGiven(a.given);
        return ini ? `${a.family}, ${ini}` : a.family;
      }
      return a.name || "Unknown";
    });
    const last = authors[authors.length - 1];
    const lastStr = last.family
      ? initialsFromGiven(last.given)
        ? `${last.family}, ${initialsFromGiven(last.given)}`
        : last.family
      : last.name || "Unknown";
    return `${head.join(", ")}, …, ${lastStr}`;
  }
  const list = authors.slice(0, 20).map((a) => {
    if (a.family) {
      const ini = initialsFromGiven(a.given);
      return ini ? `${a.family}, ${ini}` : a.family;
    }
    return a.name || "Unknown";
  });
  if (!list.length) return "Unknown";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}, & ${list[1]}`;
  const head = list.slice(0, -1).join(", ");
  return `${head}, & ${list[list.length - 1]}`;
}

function formatGbtAuthors(authors: CiteAuthor[]) {
  const list = authors.slice(0, 3).map((a) => {
    if (a.family) {
      // Chinese names often have no given split
      if (!a.given && a.family && /[\u4e00-\u9fff]/.test(a.family)) return a.family;
      const ini = gbtInitials(a.given);
      return ini ? `${a.family} ${ini}` : a.family;
    }
    return a.name || "";
  }).filter(Boolean);
  if (!list.length) return "Unknown";
  if (authors.length > 3) return `${list.join(", ")}, et al`;
  return list.join(", ");
}

function formatBibtexAuthors(authors: CiteAuthor[]) {
  const list = authors.map((a) => {
    if (a.family && a.given) return `${a.family}, ${a.given}`;
    if (a.family) return a.family;
    return a.name || "Unknown";
  });
  return list.length ? list.join(" and ") : "Unknown";
}

function volumeIssuePages(opts: FormatInput) {
  const volume = clean(opts.volume);
  const issue = clean(opts.issue);
  const pages = clean(opts.pages).replace(/^pp?\.\s*/i, "");
  return { volume, issue, pages };
}

function escapeBibtex(s: string) {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/[{}]/g, (ch) => `\\${ch}`)
    .replace(/#/g, "\\#")
    .replace(/%/g, "\\%")
    .replace(/&/g, "\\&")
    .replace(/_/g, "\\_")
    .replace(/\$/g, "\\$");
}

function gbtTypeMarker(type?: string) {
  const t = (type || "").toLowerCase();
  if (/book|edited-book|monograph/.test(t)) return "[M]";
  if (/dataset|data/.test(t)) return "[DB]";
  if (/thesis|dissertation/.test(t)) return "[D]";
  if (/conference|proceedings|paper-conference/.test(t)) return "[C]";
  if (/report|working-paper/.test(t)) return "[R]";
  if (/preprint|posted-content/.test(t)) return "[A]";
  if (/patent/.test(t)) return "[P]";
  return "[J]";
}

function bibtexEntryType(type?: string) {
  const t = (type || "").toLowerCase();
  if (/book|edited-book|monograph/.test(t)) return "book";
  if (/dataset|data/.test(t)) return "misc";
  if (/thesis|dissertation/.test(t)) return "phdthesis";
  if (/conference|proceedings|paper-conference/.test(t)) return "inproceedings";
  if (/preprint|posted-content/.test(t)) return "misc";
  return "article";
}

/**
 * Build plain-text APA / GB/T 7714 / BibTeX from resolved bibliographic fields.
 * Intentionally conservative: good enough for paste into manuscripts, not a full CSL engine.
 */
export function buildFormats(opts: FormatInput) {
  const authors = asAuthors(opts.authors);
  const title = clean(opts.title) || "Untitled";
  const container = clean(opts.container);
  const year = clean(opts.year) || "n.d.";
  const doi = clean(opts.doi).replace(/^https?:\/\/doi\.org\//i, "");
  const doiUrl = doi ? `https://doi.org/${doi}` : "";
  const { volume, issue, pages } = volumeIssuePages(opts);
  const marker = gbtTypeMarker(opts.type);
  const entry = bibtexEntryType(opts.type);

  const apaAuthors = formatApaAuthors(authors);
  let apaJournal = container;
  if (volume) {
    apaJournal += apaJournal ? `, ${volume}` : volume;
    if (issue) apaJournal += `(${issue})`;
    if (pages) apaJournal += `, ${pages}`;
  } else if (pages) {
    apaJournal += apaJournal ? `, ${pages}` : pages;
  }
  const apa = `${apaAuthors} (${year}). ${title}.${apaJournal ? ` ${apaJournal}.` : ""}${doiUrl ? ` ${doiUrl}` : ""}`
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();

  const gbtAuthors = formatGbtAuthors(authors);
  let gbtTail = container ? `${container}, ${year}` : String(year);
  if (volume) {
    gbtTail += `, ${volume}`;
    if (issue) gbtTail += `(${issue})`;
    if (pages) gbtTail += `: ${pages}`;
  } else if (pages) {
    gbtTail += `: ${pages}`;
  }
  const gbt = `${gbtAuthors}. ${title}${marker}. ${gbtTail}${doi ? `. DOI: ${doi}` : ""}.`
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();

  const keyBase = (doi || title).replace(/[^a-zA-Z0-9]/g, "");
  const key = `${(authors[0]?.family || "ref").replace(/[^a-zA-Z0-9]/g, "")}${year}${keyBase.slice(-8)}`.slice(0, 40) || "ref";
  const bibLines = [
    `  title={${escapeBibtex(title)}}`,
    `  author={${escapeBibtex(formatBibtexAuthors(authors))}}`,
    container ? `  ${entry === "book" ? "publisher" : "journal"}={${escapeBibtex(container)}}` : null,
    `  year={${escapeBibtex(year)}}`,
    volume ? `  volume={${escapeBibtex(volume)}}` : null,
    issue ? `  number={${escapeBibtex(issue)}}` : null,
    pages ? `  pages={${escapeBibtex(pages)}}` : null,
    doi ? `  doi={${escapeBibtex(doi)}}` : null,
  ].filter(Boolean);
  const bibtex = `@${entry}{${key},\n${bibLines.join(",\n")}\n}`;

  return { apa, gbt, bibtex };
}

/** Convert Crossref-style author objects. */
export function fromCrossrefAuthors(
  authors?: Array<{ family?: string; given?: string; name?: string }>,
): CiteAuthor[] {
  return (authors || [])
    .map((a) => ({
      family: a.family || undefined,
      given: a.given || undefined,
      name: a.name || undefined,
    }))
    .filter((a) => a.family || a.given || a.name);
}

/** Convert OpenAlex authorships.display_name → best-effort Family/Given. */
export function fromOpenAlexAuthors(
  authorships?: Array<{ author?: { display_name?: string } }>,
): CiteAuthor[] {
  return (authorships || [])
    .map((a) => a.author?.display_name)
    .filter(Boolean)
    .map((display) => {
      const name = String(display);
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length === 1) return { family: parts[0] };
      // OpenAlex is usually "Given … Family"
      return { given: parts.slice(0, -1).join(" "), family: parts[parts.length - 1] };
    });
}
