# MedLattice 医研格

面向**临床与基础医学**的一体化研究工具台（公开学术 API，可部署 Vercel）。

## 模块

| 路由 | 功能 |
|------|------|
| `/papers` | 查找论文（S2 + PubMed + OpenAlex 指标 + Unpaywall/Europe PMC OA） |
| `/map` | 文献图谱（相似 / 参考文献 / 被引） |
| `/datasets` | 数据检索（OmicsDI · GEO · openFDA · DataCite · ClinicalTrials · OpenAlex + 书签） |
| `/journals` | 实时期刊档案 |
| `/citations` | 多源引文核查（单次最多 15 条） |
| `/match` | 引文匹配（标题 / 正文片段 → 候选文献） |
| `/trials` | 论文 ↔ ClinicalTrials.gov + ChiCTR/WHO 外链 |

`/discover` 已重定向到 `/papers`。各检索页支持 `?q=` 深链，提交后会同步到地址栏便于分享。

不调用任何第三方商业封装站（如 medcite.cn）；期刊「影响」类数字一律标明为 OpenAlex 公开统计，**不是** Clarivate JIF。

## 本地运行

```bash
cd medlattice
npm install
npm run dev
```

打开 http://localhost:3000

复制 `.env.example` 为 `.env.local` 可按需填写：

| 变量 | 说明 |
|------|------|
| `SEMANTIC_SCHOLAR_API_KEY` | Semantic Scholar API Key（请求头 `x-api-key`）。无密钥时易触发限流，查找论文会自动回退到仅 PubMed。 |
| `MEDLATTICE_CONTACT_EMAIL` | 可选联系邮箱，用于 OpenAlex / Unpaywall 礼貌标识（未设则用占位邮箱）。 |

## 部署到 Vercel

```bash
cd medlattice
npm run build   # 本地确认通过
npx vercel --prod
```

或在 [Vercel](https://vercel.com) 导入本仓库，Root Directory 选 `medlattice`。在 Project Settings → Environment Variables 中按需添加上表变量。`vercel.json` 已为引文/论文等 API 提高 `maxDuration`。
