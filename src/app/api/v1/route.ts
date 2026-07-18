import { API_VERSION, V1_CATALOG, v1Json, v1Options } from "@/lib/apiGate";

export const runtime = "nodejs";

export async function OPTIONS() {
  return v1Options();
}

/** Catalog of public MedLattice v1 APIs. */
export async function GET() {
  return v1Json({
    ok: true,
    version: API_VERSION,
    name: "MedLattice Public API",
    auth: {
      required: true,
      headers: ["X-API-Key", "Authorization: Bearer"],
    },
    base: "/api/v1",
    endpoints: V1_CATALOG,
    docs: {
      citations: "GET /api/v1/citations",
      envelope: {
        success: "{ ok: true, version: \"1\", data: {...}, meta?: {...} }",
        citationsSpecial: "{ ok: true, version: \"1\", summary, results, meta }",
        error: "{ ok: false, version: \"1\", error, code, details? }",
      },
    },
  });
}
