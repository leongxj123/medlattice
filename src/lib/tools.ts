export type ToolId = "map" | "datasets" | "journals" | "citations" | "match" | "papers" | "trials";

export type ToolMeta = {
  id: ToolId;
  href: string;
  name: string;
  nameEn: string;
  blurb: string;
};

export const TOOLS: ToolMeta[] = [
  {
    id: "map",
    href: "/map",
    name: "文献图谱",
    nameEn: "LitMap",
    blurb: "从 DOI/PMID 出发展开引用邻域，标注证据类型并可换中心探索。",
  },
  {
    id: "datasets",
    href: "/datasets",
    name: "数据检索",
    nameEn: "DataFind",
    blurb: "OmicsDI / GEO / openFDA / DataCite / ClinicalTrials / OpenAlex，检索组学数据、试验与论文。",
  },
  {
    id: "journals",
    href: "/journals",
    name: "选刊助手",
    nameEn: "Journal",
    blurb: "OpenAlex/Crossref/Wikipedia 实时期刊档案与发文趋势。",
  },
  {
    id: "citations",
    href: "/citations",
    name: "引文核查",
    nameEn: "CiteCheck",
    blurb: "多源交叉核验参考文献，导出 GB/T、APA、BibTeX。",
  },
  {
    id: "match",
    href: "/match",
    name: "引文匹配",
    nameEn: "CiteMatch",
    blurb: "粘贴一段话（最多 10 句），自动拆分逐句反查标准引文并导出格式。",
  },
  {
    id: "papers",
    href: "/papers",
    name: "查找论文",
    nameEn: "Papers",
    blurb: "S2 + PubMed 检索，附 OpenAlex 期刊指标与 OA 全文链接（非 Clarivate JIF）。",
  },
  {
    id: "trials",
    href: "/trials",
    name: "试验桥接",
    nameEn: "TrialsBridge",
    blurb: "论文 ↔ ClinicalTrials.gov，并外链 ChiCTR / WHO ICTRP。",
  },
];
