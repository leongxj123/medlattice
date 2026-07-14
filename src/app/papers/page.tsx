import { Suspense } from "react";
import { SiteHeader, ToolShell } from "@/components/SiteChrome";
import { PapersClient } from "@/components/PapersClient";

export default function PapersPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="papers" />
      <ToolShell
        active="papers"
        title="查找论文"
        subtitle="Semantic Scholar + PubMed 检索；OpenAlex 期刊指标（非 Clarivate JIF）；Unpaywall / Europe PMC 提供 OA 全文链接。"
      >
        <Suspense fallback={<p className="text-sm text-ink-soft">加载查找论文…</p>}>
          <PapersClient />
        </Suspense>
      </ToolShell>
    </div>
  );
}
