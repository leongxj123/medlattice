import { SiteHeader, ToolShell } from "@/components/SiteChrome";
import { DatasetsClient } from "@/components/DatasetsClient";

export default function DatasetsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="datasets" />
      <ToolShell
        active="datasets"
        title="数据检索"
        subtitle="关键词检索多源医学数据、临床试验与相关论文；合并 OmicsDI、GEO、openFDA、DataCite、ClinicalTrials.gov、OpenAlex 与权威门户书签。"
      >
        <DatasetsClient />
      </ToolShell>
    </div>
  );
}
