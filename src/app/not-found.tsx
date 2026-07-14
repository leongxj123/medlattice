import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <p className="text-xs uppercase tracking-[0.18em] text-accent">404</p>
      <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold text-ink">页面不存在</h1>
      <p className="mt-3 text-sm text-ink-soft">该路径没有对应工具，请返回首页选择模块。</p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-md bg-teal px-5 text-sm font-medium text-white hover:bg-teal-deep"
      >
        回到 MedLattice
      </Link>
    </main>
  );
}
