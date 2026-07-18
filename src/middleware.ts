import { NextRequest, NextResponse } from "next/server";

/**
 * Anti-scrape gate for APIs.
 * - /api/v1/* : requires MEDLATTICE_API_KEY (except OPTIONS)
 * - other /api/* : same-origin / same-site browser calls, or valid key
 * - /api/pdf   : left open for WeChat downloadFile / jump (no custom headers)
 */

function extractKey(req: NextRequest) {
  const headerKey = req.headers.get("x-api-key")?.trim() || "";
  const auth = req.headers.get("authorization")?.trim() || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() || "";
  return headerKey || bearer;
}

function keyOk(req: NextRequest) {
  const expected = process.env.MEDLATTICE_API_KEY?.trim();
  if (!expected) return false;
  const provided = extractKey(req);
  return Boolean(provided && provided === expected);
}

function isBrowserSameSite(req: NextRequest) {
  const site = (req.headers.get("sec-fetch-site") || "").toLowerCase();
  if (site === "same-origin" || site === "same-site") return true;

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host === req.nextUrl.host) return true;
    } catch {
      /* ignore */
    }
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const r = new URL(referer);
      if (r.host === req.nextUrl.host) return true;
    } catch {
      /* ignore */
    }
  }

  const host = req.nextUrl.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;

  return false;
}

function deny(message: string, status = 403) {
  return NextResponse.json(
    { ok: false, error: message, code: status === 401 ? "unauthorized" : "forbidden" },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    },
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/api/")) {
    const res = NextResponse.next();
    // Soft anti-index on API is enough; pages stay normal
    return res;
  }

  // Never index API responses
  const withNoIndex = (res: NextResponse) => {
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return res;
  };

  if (req.method === "OPTIONS") {
    return withNoIndex(NextResponse.next());
  }

  // WeChat PDF gate must stay reachable without custom headers
  if (pathname === "/api/pdf" || pathname.startsWith("/api/pdf/")) {
    return withNoIndex(NextResponse.next());
  }

  // Public v1: credential required
  if (pathname.startsWith("/api/v1")) {
    const expected = process.env.MEDLATTICE_API_KEY?.trim();
    if (!expected) {
      return deny("Service unavailable", 503);
    }
    if (!keyOk(req)) {
      return deny("Unauthorized", 401);
    }
    return withNoIndex(NextResponse.next());
  }

  // Internal UI APIs: same-site browser OR credential
  if (keyOk(req) || isBrowserSameSite(req)) {
    return withNoIndex(NextResponse.next());
  }

  return deny("Forbidden", 403);
}

export const config = {
  matcher: ["/api/:path*"],
};
