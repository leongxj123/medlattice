const USER_AGENT = "MedLattice/0.1 (clinical-research-toolkit; mailto:dev@medlattice.local)";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(init?.headers || {}),
    },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

export function encodeQuery(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export type OpenAlexWork = {
  id: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string | null } | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  referenced_works?: string[];
  related_works?: string[];
  type?: string | null;
};

export function workTitle(work: OpenAlexWork) {
  return work.display_name || work.title || "Untitled";
}

export function workAuthors(work: OpenAlexWork, limit = 3) {
  const names = (work.authorships || [])
    .map((a) => a.author?.display_name)
    .filter(Boolean) as string[];
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} et al.`;
}

export function reconstructAbstract(index?: Record<string, number[]> | null) {
  if (!index) return "";
  const pairs: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) pairs.push([pos, word]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map(([, w]) => w).join(" ");
}

export function openAlexId(idOrUrl: string) {
  if (idOrUrl.startsWith("http")) return idOrUrl.split("/").pop() || idOrUrl;
  return idOrUrl.replace(/^W/i, "W");
}
