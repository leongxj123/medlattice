import { SiteHeader, ToolShell } from "@/components/SiteChrome";
import { MatchClient } from "@/components/MatchClient";

export default function MatchPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="match" />
      <ToolShell
        active="match"
        title="引文匹配"
        subtitle="粘贴标题、摘要或正文（最多 10 句）；并行检索多源文献库后逐句反查，生成 APA / GB/T / BibTeX，并可跳转核引文与图谱。"
      >
        <MatchClient />
      </ToolShell>
    </div>
  );
}
