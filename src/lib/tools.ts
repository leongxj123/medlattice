export type ToolId = "map" | "datasets" | "journals" | "citations" | "discover";

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
    blurb: "从一篇医学论文出发，展开引用与相似文献网络。",
  },
  {
    id: "datasets",
    href: "/datasets",
    name: "数据检索",
    nameEn: "DataFind",
    blurb: "检索临床试验、开放医学数据集与本地精选库。",
  },
  {
    id: "journals",
    href: "/journals",
    name: "选刊助手",
    nameEn: "Journal",
    blurb: "面向临床与基础医学期刊的分区与定位速查。",
  },
  {
    id: "citations",
    href: "/citations",
    name: "引文核查",
    nameEn: "CiteCheck",
    blurb: "批量核验参考文献是否真实存在、DOI 是否匹配。",
  },
  {
    id: "discover",
    href: "/discover",
    name: "论文发现",
    nameEn: "Discover",
    blurb: "用几篇种子论文校准兴趣，卡片式浏览相关文献。",
  },
];

export const MAILTO = "mailto:dev@medlattice.local";
