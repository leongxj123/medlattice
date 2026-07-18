import { NextRequest } from "next/server";
import { GET as trialsGet } from "@/app/api/trials/route";
import { v1Options, wrapInternal } from "@/lib/apiGate";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function OPTIONS() {
  return v1Options();
}

/** Public trials bridge — ?q=&mode=auto|paper|trial */
export async function GET(req: NextRequest) {
  return wrapInternal(req, trialsGet);
}
