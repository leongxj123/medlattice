import { NextRequest } from "next/server";
import { GET as papersGet } from "@/app/api/papers/route";
import { v1Options, wrapInternal } from "@/lib/apiGate";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function OPTIONS() {
  return v1Options();
}

/** Public papers search — query same as /api/papers (?q=&sort=&since=&oa=&page=). */
export async function GET(req: NextRequest) {
  return wrapInternal(req, papersGet);
}
