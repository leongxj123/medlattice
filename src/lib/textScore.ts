/** Shared text normalize / tokenize / title similarity for match + citations. */

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "were",
  "was",
  "are",
  "been",
  "have",
  "has",
  "had",
  "into",
  "onto",
  "over",
  "under",
  "between",
  "among",
  "using",
  "used",
  "based",
  "study",
  "results",
  "methods",
  "background",
  "conclusion",
  "conclusions",
  "objective",
  "objectives",
  "purpose",
  "a",
  "an",
  "of",
  "in",
  "on",
  "to",
  "by",
  "or",
  "as",
  "at",
  "is",
  "be",
  "we",
  "our",
  "their",
  "its",
]);

export function normalizeText(s?: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
}

/** Latin words + CJK character bigrams (so continuous Chinese is comparable). */
export function textTokens(s?: string, minLen = 2): string[] {
  const n = normalizeText(s);
  if (!n) return [];
  const out: string[] = [];
  for (const part of n.split(" ").filter(Boolean)) {
    if (/[\u4e00-\u9fff]/.test(part)) {
      if (part.length === 1) out.push(part);
      else {
        for (let i = 0; i < part.length - 1; i++) out.push(part.slice(i, i + 2));
      }
    } else if (part.length >= minLen && !STOP.has(part)) {
      out.push(part);
    }
  }
  return out;
}

export function tokenF1(a?: string, b?: string) {
  const wa = textTokens(a);
  const wb = textTokens(b);
  if (!wa.length || !wb.length) return 0;
  const setB = new Set(wb);
  const setA = new Set(wa);
  const interA = wa.filter((w) => setB.has(w)).length;
  const interB = wb.filter((w) => setA.has(w)).length;
  const precision = interA / wa.length;
  const recall = interB / wb.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Title similarity in [0,1].
 * `strict` enables citation-verification heuristics (truncation / missing lead words).
 */
export function titleSimilarityScore(a?: string, b?: string, opts?: { strict?: boolean }) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const f1 = tokenF1(a, b);
  const lenRatio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);

  if (na.includes(nb) || nb.includes(na)) {
    return Math.min(opts?.strict ? 0.98 : 0.99, Math.max(f1, lenRatio * (opts?.strict ? 0.92 : 0.95)));
  }

  if (opts?.strict) {
    const wa = textTokens(a);
    const wb = textTokens(b);
    const setA = new Set(wa);
    const precision = wa.length ? wa.filter((w) => new Set(wb).has(w)).length / wa.length : 0;
    const recall = wb.length ? wb.filter((w) => setA.has(w)).length / wb.length : 0;
    const missingLead = wb.slice(0, 2).some((w) => !setA.has(w));
    if (missingLead && precision >= 0.8) return Math.min(f1, 0.84);
    if (precision >= 0.85 && recall < 0.9) return Math.min(f1, 0.86);
    if (lenRatio < 0.82) return Math.min(f1, lenRatio + 0.08);
    return f1;
  }

  if (lenRatio < 0.55) return Math.min(f1, lenRatio + 0.15);
  return f1;
}

/** Run async tasks with a fixed concurrency limit. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
