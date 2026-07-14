import { Suspense } from "react";
import { SiteHeader, ToolShell } from "@/components/SiteChrome";
import { JournalsClient } from "@/components/JournalsClient";

export default function JournalsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="journals" />
      <ToolShell
        active="journals"
        title="选刊助手"
        subtitle="实时 OpenAlex / Crossref / Wikipedia：引用指标、近年发文趋势、近期 ISSN 样例与百科摘要。"
      >
        <Suspense fallback={<p className="text-sm text-ink-soft">加载选刊助手…</p>}>
          <JournalsClient />
        </Suspense>
      </ToolShell>
    </div>
  );
}
