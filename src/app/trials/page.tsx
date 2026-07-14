import { Suspense } from "react";
import { SiteHeader, ToolShell } from "@/components/SiteChrome";
import { TrialsClient } from "@/components/TrialsClient";

export default function TrialsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="trials" />
      <ToolShell
        active="trials"
        title="试验桥接"
        subtitle="DOI/PMID ↔ ClinicalTrials.gov；Crossref 抽取 NCT；外链 ChiCTR / WHO ICTRP；论文侧附 Unpaywall / Europe PMC OA 链接。"
      >
        <Suspense fallback={<p className="text-sm text-ink-soft">加载试验桥接…</p>}>
          <TrialsClient />
        </Suspense>
      </ToolShell>
    </div>
  );
}
