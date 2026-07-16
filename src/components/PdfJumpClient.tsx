"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function Inner() {
  const sp = useSearchParams();
  const rawUrl = (sp.get("url") || sp.get("u") || "").trim();
  const doi = (sp.get("doi") || "").trim();
  const auto = sp.get("auto") !== "0";

  const apiHref = useMemo(() => {
    const q = new URLSearchParams();
    if (rawUrl) q.set("url", rawUrl);
    if (doi) q.set("doi", doi);
    q.set("mode", "redirect");
    return `/api/pdf?${q.toString()}`;
  }, [rawUrl, doi]);

  const proxyHref = useMemo(() => {
    const q = new URLSearchParams();
    if (rawUrl) q.set("url", rawUrl);
    if (doi) q.set("doi", doi);
    q.set("mode", "proxy");
    return `/api/pdf?${q.toString()}`;
  }, [rawUrl, doi]);

  const [err, setErr] = useState("");

  useEffect(() => {
    if (!auto || (!rawUrl && !doi)) return;
    // Soft auto-jump; user can still tap if blocked by in-app browser
    const t = window.setTimeout(() => {
      try {
        window.location.replace(apiHref);
      } catch {
        setErr("自动跳转被拦截，请点击下方按钮。");
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [auto, rawUrl, doi, apiHref]);

  if (!rawUrl && !doi) {
    return (
      <div className="rounded-xl border border-line bg-white/85 p-5 text-sm text-ink-soft shadow-[var(--shadow)]">
        请通过 <code className="text-ink">/pdf?url=编码后的PDF地址</code> 或{" "}
        <code className="text-ink">/pdf?doi=10.xxxx/...</code> 打开本页。
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-white/85 p-5 shadow-[var(--shadow)]">
      <p className="text-sm text-ink">正在跳转到 PDF…</p>
      {err ? <p className="text-sm text-red-700">{err}</p> : null}
      <div className="flex flex-wrap gap-3 text-sm">
        <a
          href={apiHref}
          className="rounded-md bg-teal px-3 py-2 font-medium text-white hover:bg-teal-deep"
        >
          打开 PDF
        </a>
        <a
          href={proxyHref}
          className="rounded-md border border-line px-3 py-2 text-ink hover:bg-mist/50"
        >
          经本站下载（小文件）
        </a>
      </div>
      <p className="break-all text-xs text-ink-soft">目标：{rawUrl || `doi:${doi}`}</p>
      <p className="text-xs text-ink-soft">
        小程序：业务域名 / downloadFile 合法域名均配置 <code>med.aispeedtest.eu</code> 后，调用{" "}
        <code>/api/pdf?url=...</code>（跳转）或 <code>&amp;mode=proxy</code>（下载）。
      </p>
    </div>
  );
}

export function PdfJumpClient() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-soft">加载中…</p>}>
      <Inner />
    </Suspense>
  );
}
