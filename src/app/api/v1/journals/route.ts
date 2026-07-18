import { NextRequest } from "next/server";
import { GET as journalsGet } from "@/app/api/journals/route";
import { v1Options, wrapInternal } from "@/lib/apiGate";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function OPTIONS() {
  return v1Options();
}

/** Public journal search — ?q= */
export async function GET(req: NextRequest) {
  return wrapInternal(req, journalsGet);
}
