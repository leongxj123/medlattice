"use client";

import { SiteHeader } from "@/components/SiteChrome";
import { friendlyError } from "@/lib/userFacing";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-accent">Error</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold text-ink">页面出错了</h1>
        <p className="mt-3 text-sm text-ink-soft">{friendlyError(error, "未知错误，请稍后重试")}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex min-h-11 items-center rounded-md bg-teal px-5 text-sm font-medium text-white hover:bg-teal-deep"
        >
          重试
        </button>
      </main>
    </div>
  );
}
