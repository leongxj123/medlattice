import { NextRequest, NextResponse } from "next/server";
import { runCitationsVerify } from "@/lib/citationsVerify";

export type {
  CiteStatus,
  FieldDiff,
  FieldCheck,
  CiteResult,
  SourceRecord,
  CitationsSummary,
  CitationsVerifyResult,
} from "@/lib/citationsVerify";

/** Internal UI endpoint — same behavior as before; no API key required. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { text?: string };
    const { results, summary, truncated } = await runCitationsVerify({ text: body.text || "" });
    return NextResponse.json({ results, summary, truncated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "核查失败，请稍后重试";
    const status = /请提供至少一条|请粘贴至少一条/.test(message) ? 400 : 500;
    return NextResponse.json(
      { error: status === 400 ? "请粘贴至少一条参考文献" : "核查失败，请稍后重试" },
      { status },
    );
  }
}
