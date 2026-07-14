import Link from "next/link";
import { SiteHeader } from "@/components/SiteChrome";
import { TOOLS } from "@/lib/tools";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="home" />
      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 lattice-grid opacity-70" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-14 md:grid-cols-[1.15fr_0.85fr] md:px-6 md:pb-24 md:pt-20">
            <div className="fade-up">
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-accent">Clinical · Basic Medicine</p>
              <h1 className="font-[family-name:var(--font-display)] text-5xl font-semibold leading-[1.05] tracking-tight text-ink md:text-6xl">
                MedLattice
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
                文献图谱、医学数据、选刊、引文核查、引文匹配、查找论文与试验桥接——公开 API + 权威门户书签，专为临床与基础医学研究节奏设计。
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/papers"
                  className="inline-flex min-h-11 items-center rounded-md bg-teal px-5 text-sm font-medium text-white hover:bg-teal-deep"
                >
                  查找论文
                </Link>
                <Link
                  href="/map"
                  className="inline-flex min-h-11 items-center rounded-md border border-line bg-white/70 px-5 text-sm font-medium text-ink hover:bg-mist/60"
                >
                  文献图谱
                </Link>
              </div>
            </div>

            <div className="fade-up-delay relative min-h-[280px] overflow-hidden rounded-2xl border border-line bg-[linear-gradient(145deg,#0f5c56_0%,#0a3f3b_45%,#2a6f8f_100%)] p-6 text-white shadow-[var(--shadow)]">
              <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10 pulse-soft" />
              <div className="absolute bottom-8 left-10 h-24 w-24 rounded-full bg-white/10" />
              <p className="text-xs uppercase tracking-[0.18em] text-white/70">Live APIs</p>
              <p className="mt-6 font-[family-name:var(--font-display)] text-3xl font-semibold leading-tight">
                一张网，串起论文、数据、试验与证据链。
              </p>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/80">
                Semantic Scholar · PubMed · OpenAlex · Crossref · ClinicalTrials · OmicsDI · GEO · openFDA · Unpaywall ·
                Europe PMC
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 md:px-6">
          <div className="mb-6 fade-up-delay-2">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink">七个工具，一个入口</h2>
            <p className="mt-2 text-sm text-ink-soft">自行输入查询；可串成「找论文 → 引文匹配 → 看图谱 → 找试验/数据 → 选刊 → 核引文」。</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {TOOLS.map((tool, i) => (
              <Link
                key={tool.id}
                href={tool.href}
                className="group rounded-xl border border-line bg-white/75 p-5 transition hover:-translate-y-0.5 hover:border-teal/35 hover:bg-white"
                style={{ animationDelay: `${0.08 * i}s` }}
              >
                <p className="text-xs uppercase tracking-[0.16em] text-accent">{tool.nameEn}</p>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-xl font-semibold text-ink group-hover:text-teal-deep">
                  {tool.name}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{tool.blurb}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t border-line py-8 text-center text-xs text-ink-soft">
        MedLattice 医研格 · 原创医学研究工具台 · 数据来自公开 API
      </footer>
    </div>
  );
}
