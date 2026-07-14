/** Update the address bar without re-triggering Next.js navigation (avoids double-fetch). */
export function syncQueryParam(key: string, value: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const trimmed = value.trim();
  if (trimmed) url.searchParams.set(key, trimmed);
  else url.searchParams.delete(key);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, "", next);
  }
}
