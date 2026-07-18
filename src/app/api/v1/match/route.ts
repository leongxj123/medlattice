import { NextRequest } from "next/server";
import { POST as matchPost } from "@/app/api/match/route";
import { v1Options, wrapInternal } from "@/lib/apiGate";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function OPTIONS() {
  return v1Options();
}

/** Public citation match — body { text } same as /api/match. */
export async function POST(req: NextRequest) {
  return wrapInternal(req, matchPost);
}
