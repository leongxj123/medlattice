import { NextRequest, NextResponse } from "next/server";

export const API_VERSION = "1";

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Max-Age": "86400",
  };
}

export function v1Json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders() });
}

export function v1Options() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/** Require MEDLATTICE_API_KEY on /api/v1 (middleware also enforces). */
export function assertApiKey(req: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const expected = process.env.MEDLATTICE_API_KEY?.trim();
  if (!expected) {
    return {
      ok: false,
      response: v1Json(
        {
          ok: false,
          version: API_VERSION,
          error: "Service unavailable",
          code: "upstream",
        },
        503,
      ),
    };
  }

  const headerKey = req.headers.get("x-api-key")?.trim() || "";
  const auth = req.headers.get("authorization")?.trim() || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() || "";
  const provided = headerKey || bearer;

  if (!provided || provided !== expected) {
    return {
      ok: false,
      response: v1Json(
        {
          ok: false,
          version: API_VERSION,
          error: "Unauthorized",
          code: "unauthorized",
        },
        401,
      ),
    };
  }
  return { ok: true };
}

type RouteHandler = (req: NextRequest, ctx?: unknown) => Promise<Response> | Response;

/**
 * Run an internal App Router handler and wrap JSON in a stable v1 envelope.
 * Binary / redirect responses (e.g. PDF) are passed through with CORS headers.
 */
export async function wrapInternal(req: NextRequest, handler: RouteHandler, ctx?: unknown) {
  const auth = assertApiKey(req);
  if (!auth.ok) return auth.response;

  try {
    const res = await handler(req, ctx);
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const isJson = contentType.includes("application/json");
    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has("location");

    if (!isJson || isRedirect || contentType.includes("application/pdf")) {
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
      return new NextResponse(res.body, { status: res.status, headers });
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const code =
        res.status === 400
          ? "bad_request"
          : res.status === 404
            ? "not_found"
            : res.status === 401
              ? "unauthorized"
              : "upstream";
      return v1Json(
        {
          ok: false,
          version: API_VERSION,
          error: typeof data.error === "string" ? data.error : res.statusText || "Request failed",
          code,
          details: data,
        },
        res.status,
      );
    }

    // Already a v1-shaped payload (e.g. citations)
    if (data && typeof data === "object" && data.ok === true && data.version != null) {
      return v1Json(data, res.status);
    }

    return v1Json(
      {
        ok: true,
        version: API_VERSION,
        data,
        meta: { status: res.status },
      },
      res.status,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream failure";
    return v1Json(
      {
        ok: false,
        version: API_VERSION,
        error: message.slice(0, 300),
        code: "upstream",
      },
      500,
    );
  }
}

export const V1_CATALOG = [
  {
    path: "/api/v1/citations",
    methods: ["GET", "POST"],
    summary: "引文核查 — text | references[] | reference",
  },
  {
    path: "/api/v1/match",
    methods: ["POST"],
    summary: "引文匹配 — { text } 正文/标题片段",
  },
  {
    path: "/api/v1/papers",
    methods: ["GET"],
    summary: "查找论文 — ?q=&sort=&since=&oa=&page=",
  },
  {
    path: "/api/v1/map",
    methods: ["GET"],
    summary: "文献图谱 — ?q=DOI|PMID|标题",
  },
  {
    path: "/api/v1/datasets",
    methods: ["GET"],
    summary: "数据检索 — ?q=",
  },
  {
    path: "/api/v1/journals",
    methods: ["GET"],
    summary: "选刊列表 — ?q=",
  },
  {
    path: "/api/v1/journals/{id}",
    methods: ["GET"],
    summary: "选刊详情 — OpenAlex source id",
  },
  {
    path: "/api/v1/trials",
    methods: ["GET"],
    summary: "试验桥接 — ?q=&mode=auto|paper|trial",
  },
  {
    path: "/api/v1/search",
    methods: ["GET"],
    summary: "轻量检索 — ?q=",
  },
  {
    path: "/api/v1/pdf",
    methods: ["GET"],
    summary: "PDF 网关 — ?url=|&doi=&mode=redirect|proxy",
  },
] as const;
