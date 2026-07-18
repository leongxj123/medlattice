import { NextRequest } from "next/server";
import { runCitationsVerify } from "@/lib/citationsVerify";
import { API_VERSION, assertApiKey, v1Json, v1Options } from "@/lib/apiGate";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function OPTIONS() {
  return v1Options();
}

/** Usage / discovery for integrators. */
export async function GET() {
  return v1Json({
    ok: true,
    version: API_VERSION,
    endpoint: "/api/v1/citations",
    methods: ["GET", "POST", "OPTIONS"],
    auth: {
      required: true,
      headers: ["X-API-Key", "Authorization: Bearer"],
    },
    body: {
      oneOf: [
        { text: "1. Ref A\\n2. Ref B  (auto-split, max 15)" },
        { references: ["Ref A", "Ref B"] },
        { reference: "single reference string" },
      ],
      limits: { maxChars: 30000, maxReferences: 15 },
    },
    example: {
      curl: `curl -X POST "$MEDLATTICE_BASE_URL/api/v1/citations" -H "Content-Type: application/json" -H "X-API-Key: $MEDLATTICE_API_KEY" -d "{\\"reference\\":\\"...\\"}"`,
    },
    response: {
      ok: true,
      version: "1",
      summary: { total: 1, ok: 1, review: 0, risk: 0, insufficient: 0 },
      results: ["CiteResult[]"],
      meta: { truncated: false, count: 1 },
    },
  });
}

/**
 * Public citation verification API for other products.
 * POST JSON: { text } | { references: string[] } | { reference }
 */
export async function POST(req: NextRequest) {
  const auth = assertApiKey(req);
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as {
      text?: string;
      references?: string[];
      reference?: string;
    };

    const hasText = typeof body.text === "string" && body.text.trim();
    const hasRefs = Array.isArray(body.references) && body.references.some((r) => String(r || "").trim());
    const hasOne = typeof body.reference === "string" && body.reference.trim();
    if (!hasText && !hasRefs && !hasOne) {
      return v1Json(
        {
          ok: false,
          version: API_VERSION,
          error: "Provide text, references[], or reference",
          code: "bad_request",
        },
        400,
      );
    }

    const { results, summary, truncated } = await runCitationsVerify({
      text: body.text,
      references: body.references,
      reference: body.reference,
    });

    return v1Json({
      ok: true,
      version: API_VERSION,
      summary,
      results,
      meta: {
        truncated,
        count: results.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Citation verify failed";
    if (/请提供至少一条|请粘贴至少一条/.test(message)) {
      return v1Json(
        {
          ok: false,
          version: API_VERSION,
          error: "At least one reference is required",
          code: "bad_request",
        },
        400,
      );
    }
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
