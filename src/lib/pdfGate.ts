/** PDF jump / proxy helpers for WeChat mini-program (single allowlisted domain). */

const PRIVATE_V4 =
  /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

/** Public site origin for absolute mini-program URLs (e.g. https://med.aispeedtest.eu). */
export function publicSiteOrigin(reqOrigin?: string | null) {
  const env = process.env.MEDLATTICE_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (env) return env;
  if (reqOrigin?.startsWith("http")) return reqOrigin.replace(/\/$/, "");
  return "";
}

export function assertSafePdfTarget(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("无效的 PDF 链接");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("仅支持 http/https PDF 链接");
  }
  if (u.username || u.password) {
    throw new Error("不允许带凭据的链接");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    throw new Error("不允许访问内网地址");
  }
  if (PRIVATE_V4.test(host) || host === "metadata.google.internal") {
    throw new Error("不允许访问内网地址");
  }
  // Block obvious non-document schemes via path tricks
  if (u.protocol === "http:" && !process.env.MEDLATTICE_ALLOW_HTTP_PDF) {
    throw new Error("请使用 https PDF 链接");
  }
  return u;
}

/** Relative path the mini-program can prepend with https://med.aispeedtest.eu */
export function pdfGatePath(
  targetUrl: string,
  opts?: { mode?: "redirect" | "proxy"; doi?: string | null },
) {
  const q = new URLSearchParams();
  q.set("url", targetUrl);
  if (opts?.mode && opts.mode !== "redirect") q.set("mode", opts.mode);
  if (opts?.doi) q.set("doi", opts.doi.replace(/^https?:\/\/doi\.org\//i, "").trim());
  return `/api/pdf?${q.toString()}`;
}

export function pdfGateAbsolute(
  targetUrl: string,
  opts?: { mode?: "redirect" | "proxy"; doi?: string | null; origin?: string | null },
) {
  const origin = publicSiteOrigin(opts?.origin);
  const path = pdfGatePath(targetUrl, opts);
  return origin ? `${origin}${path}` : path;
}

/** Loose check that upstream looks like a PDF (header or URL). */
export function looksLikePdf(contentType: string | null, url: string) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) return true;
  if (/\.pdf(\?|#|$)/i.test(url)) return true;
  if (/\/pdf\b/i.test(url) || /format=pdf/i.test(url) || /type=pdf/i.test(url)) return true;
  return false;
}
