import { SiteHeader, ToolShell } from "@/components/SiteChrome";
import { CitationsClient } from "@/components/CitationsClient";

export default function CitationsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="citations" />
      <ToolShell
        active="citations"
        title="引文核查"
        subtitle="粘贴参考文献后一键核验：总结报告、逐条字段对比（引用中→库内）、标准格式导出。"
      >
        <CitationsClient />
      </ToolShell>
    </div>
  );
}
