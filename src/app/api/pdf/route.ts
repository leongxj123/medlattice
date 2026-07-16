import { NextRequest, NextResponse } from "next/server";
import { unpaywallLookup, CONTACT_EMAIL } from "@/lib/http";
import { assertSafePdfTarget, looksLikePdf, pdfGateAbsolute } from "@/lib/pdfGate";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_PROXY_BYTES = 4.5 * 1024 * 1024; // Vercel serverless response soft limit
const FETCH_TIMEOUT_MS = 20000;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

async function resolveTargetUrl(req: NextRequest): Promise<{ url: string; via?: string }> {
  const sp = req.nextUrl.searchParams;
  const rawUrl = (sp.get("url") || sp.get("u") || "").trim();
  const doi = (sp.get("doi") || "").trim().replace(/^https?:\/\/doi\.org\//i, "");

  if (rawUrl) {
    const u = assertSafePdfTarget(rawUrl);
    return { url: u.toString() };
  }

  if (doi) {
    const oa = await unpaywallLookup(doi);
    if (oa?.pdfUrl) {
      const u = assertSafePdfTarget(oa.pdfUrl);
      return { url: u.toString(), via: "unpaywall" };
    }
    throw new Error("该 DOI 暂未找到可开放获取的 PDF");
  }

  throw new Error("请提供 url=PDF链接 或 doi=");
}

/**
 * WeChat mini-program PDF gate (bind download / business domain to this host only).
 *
 * Examples:
 *   GET /api/pdf?url=https%3A%2F%2F...%2Fpaper.pdf          → 302 jump (default)
 *   GET /api/pdf?url=...&mode=proxy                        → stream PDF (downloadFile)
 *   GET /api/pdf?doi=10.1056/NEJMoa2034577&mode=redirect  → resolve OA then jump
 *   GET /api/pdf?url=...&format=json                       → { jumpUrl, proxyUrl, target }
 */
export async function GET(req: NextRequest) {
  const headers = corsHeaders();
  try {
    const mode = (req.nextUrl.searchParams.get("mode") || "redirect").toLowerCase();
    const format = (req.nextUrl.searchParams.get("format") || "").toLowerCase();
    const { url: target, via } = await resolveTargetUrl(req);

    const origin = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    const jumpUrl = pdfGateAbsolute(target, { mode: "redirect", origin });
    const proxyUrl = pdfGateAbsolute(target, { mode: "proxy", origin });

    if (format === "json") {
      return NextResponse.json(
        { target, via: via || null, jumpUrl, proxyUrl, mode },
        { headers },
      );
    }

    // Default / explicit redirect — for web-view、浏览器、小程序跳转打开
    if (mode === "redirect" || mode === "jump" || mode === "go") {
      return new NextResponse(null, {
        status: 302,
        headers: {
          ...headers,
          Location: target,
          "X-PDF-Gate": "redirect",
          ...(via ? { "X-PDF-Via": via } : {}),
        },
      });
    }

    if (mode !== "proxy" && mode !== "download" && mode !== "file") {
      return NextResponse.json(
        { error: "mode 仅支持 redirect | proxy", jumpUrl, proxyUrl },
        { status: 400, headers },
      );
    }

    // Proxy stream — wx.downloadFile 只需白名单本站域名
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "application/pdf,*/*",
          "User-Agent": `MedLattice-PDFGate/0.1 (mailto:${CONTACT_EMAIL})`,
        },
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `上游 PDF 不可用 (${upstream.status})`, target, jumpUrl },
        { status: 502, headers },
      );
    }

    const ct = upstream.headers.get("content-type");
    if (!looksLikePdf(ct, target)) {
      // Not a PDF — fall back to redirect so callers still reach the resource
      return new NextResponse(null, {
        status: 302,
        headers: { ...headers, Location: target, "X-PDF-Gate": "fallback-redirect" },
      });
    }

    const lenHeader = upstream.headers.get("content-length");
    const len = lenHeader ? Number(lenHeader) : NaN;
    if (Number.isFinite(len) && len > MAX_PROXY_BYTES) {
      return NextResponse.json(
        {
          error: `PDF 超过代理上限（${Math.round(MAX_PROXY_BYTES / 1024 / 1024)}MB），请改用跳转：jumpUrl`,
          target,
          jumpUrl,
          size: len,
        },
        { status: 413, headers },
      );
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > MAX_PROXY_BYTES) {
      return NextResponse.json(
        {
          error: `PDF 超过代理上限（${Math.round(MAX_PROXY_BYTES / 1024 / 1024)}MB），请改用跳转：jumpUrl`,
          target,
          jumpUrl,
          size: buf.byteLength,
        },
        { status: 413, headers },
      );
    }

    // Sniff %PDF
    const head = buf.subarray(0, 5).toString("utf8");
    if (!head.startsWith("%PDF") && !looksLikePdf(ct, target)) {
      return new NextResponse(null, {
        status: 302,
        headers: { ...headers, Location: target, "X-PDF-Gate": "fallback-redirect" },
      });
    }

    const filename =
      target.split("/").pop()?.split("?")[0]?.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "paper.pdf";

    return new NextResponse(buf, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Length": String(buf.byteLength),
        "Content-Disposition": `inline; filename="${filename.endsWith(".pdf") ? filename : `${filename}.pdf`}"`,
        "X-PDF-Gate": "proxy",
        "X-PDF-Target": target.slice(0, 500),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF 网关失败";
    const status = /无效|仅支持|不允许|请提供|暂未找到/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status, headers });
  }
}
