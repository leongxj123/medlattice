import Link from "next/link";
import { TOOLS, type ToolId } from "@/lib/tools";
import { cn } from "@/lib/cn";

export function SiteHeader({ active }: { active?: ToolId | "home" }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-[#f4f7f6]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-teal text-sm font-semibold tracking-tight text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.15)]">
            ML
          </span>
          <span className="leading-tight">
            <span className="block font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-ink">
              MedLattice
            </span>
            <span className="block text-[11px] uppercase tracking-[0.16em] text-ink-soft">
              医研格 · 临床与基础医学
            </span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-0.5 xl:flex">
          {TOOLS.map((tool) => (
            <Link
              key={tool.id}
              href={tool.href}
              className={cn(
                "rounded-md px-2 py-1.5 text-[13px] transition-colors",
                active === tool.id
                  ? "bg-teal/10 font-medium text-teal-deep"
                  : "text-ink-soft hover:bg-mist/70 hover:text-ink",
              )}
            >
              {tool.name}
            </Link>
          ))}
        </nav>

        <details className="relative ml-auto xl:hidden">
          <summary className="cursor-pointer list-none rounded-md border border-line bg-white/70 px-3 py-1.5 text-sm text-ink-soft">
            工具
          </summary>
          <div className="absolute right-0 mt-2 w-48 overflow-hidden rounded-md border border-line bg-white shadow-[var(--shadow)]">
            {TOOLS.map((tool) => (
              <Link
                key={tool.id}
                href={tool.href}
                className="block px-3 py-2 text-sm text-ink-soft hover:bg-mist/60 hover:text-ink"
              >
                {tool.name}
              </Link>
            ))}
          </div>
        </details>
      </div>
    </header>
  );
}

export function ToolShell({
  title,
  subtitle,
  children,
  active,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  active?: ToolId;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <div className="mb-8 max-w-2xl fade-up">
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-accent">
          MedLattice{active ? ` / ${active}` : ""}
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-ink md:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-soft">{subtitle}</p>
      </div>
      <div className="fade-up-delay">{children}</div>
    </div>
  );
}
