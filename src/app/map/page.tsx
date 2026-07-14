import { Suspense } from "react";
import { SiteHeader, ToolShell } from "@/components/SiteChrome";
import { LiteratureMapClient } from "@/components/LiteratureMapClient";

export default function MapPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="map" />
      <ToolShell
        active="map"
        title="文献图谱"
        subtitle="输入 DOI/PMID/标题，展开相似、参考文献与被引邻域；可在站内继续查试验、数据、选刊与引文。"
      >
        <Suspense fallback={<p className="text-sm text-ink-soft">加载图谱…</p>}>
          <LiteratureMapClient />
        </Suspense>
      </ToolShell>
    </div>
  );
}
