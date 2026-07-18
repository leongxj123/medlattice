import { NextRequest } from "next/server";
import { GET as journalDetailGet } from "@/app/api/journals/[id]/route";
import { v1Options, wrapInternal } from "@/lib/apiGate";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function OPTIONS() {
  return v1Options();
}

/** Public journal detail — /api/v1/journals/:id */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return wrapInternal(req, (r, c) => journalDetailGet(r, c as { params: Promise<{ id: string }> }), ctx);
}
