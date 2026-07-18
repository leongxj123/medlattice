import { NextRequest } from "next/server";
import { GET as pdfGet } from "@/app/api/pdf/route";
import { v1Options, wrapInternal } from "@/lib/apiGate";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function OPTIONS() {
  return v1Options();
}

/** Public PDF gate — ?url=|&doi=&mode=redirect|proxy|&format=json */
export async function GET(req: NextRequest) {
  return wrapInternal(req, pdfGet);
}
