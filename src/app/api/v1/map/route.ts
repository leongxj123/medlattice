import { NextRequest } from "next/server";
import { GET as mapGet } from "@/app/api/map/route";
import { v1Options, wrapInternal } from "@/lib/apiGate";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function OPTIONS() {
  return v1Options();
}

/** Public literature map — ?q=DOI|PMID|title */
export async function GET(req: NextRequest) {
  return wrapInternal(req, mapGet);
}
