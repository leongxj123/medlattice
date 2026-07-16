import { SiteHeader, ToolShell } from "@/components/SiteChrome";
import { PdfJumpClient } from "@/components/PdfJumpClient";

export default function PdfJumpPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <ToolShell
        title="PDF 跳转"
        subtitle="微信小程序业务域名跳转页：自动打开目标 PDF（本站统一入口，无需配置海量 publisher 域名）。"
      >
        <PdfJumpClient />
      </ToolShell>
    </div>
  );
}
