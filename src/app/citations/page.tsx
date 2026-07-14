import { SiteHeader, ToolShell } from "@/components/SiteChrome";
import { CitationsClient } from "@/components/CitationsClient";

export default function CitationsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="citations" />
      <ToolShell
        active="citations"
        title="引文核查"
        subtitle="支持 DOI / 仅 PMID / 无标识符三种路径：有 ID 直查核对字段；无 ID 则多源按题名+作者+年份匹配并补全标识符。"
      >
        <CitationsClient />
      </ToolShell>
    </div>
  );
}
