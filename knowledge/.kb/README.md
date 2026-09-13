# .kb/ — 知识库检索层（本地 RAG）

把 `knowledge/` 这个 Markdown 库变成**能在对话里直接检索**的引擎，做成 MCP 工具接进 DeepSeek Harness。

对标 AnythingLLM 的效果：你用中文提问 → 它从 2268 个文件、24754 个分块里找出最相关的几段 → 带文件路径和行号返回 → 我据此回答并引用。

**全本地、零 API 密钥、零联网**（模型首次下载后）。

## 快速使用

在对话里直接说人话就行，我会调用：

| 工具 | 用途 | 例子 |
|---|---|---|
| `mcp__kb__kb_search` | 语义+关键词混合检索 | 「知识库里怎么做 App Store 截图」 |
| `mcp__kb__kb_read` | 读全文或指定行段 | 「把 skills/INDEX.md 前 40 行读出来」 |
| `mcp__kb__kb_status` | 看索引新鲜度 | 「知识库索引过期了吗」 |

命令行等价物（不依赖 DSH）：

```bash
cd knowledge/.kb
node kb.mjs "怎么做外链建设"          # 混合检索
node kb.mjs "GBP suspension" -k 5 --kind skill
node kb.mjs --status                  # 索引统计/是否过期
node kb.mjs --read skills/INDEX.md --lines 1-40
```

## 架构

```
提问 ──┬─→ 向量检索 (e5-large, 1024维余弦)  ─┐
       │     找语义/跨语言近似                │
       └─→ BM25 关键词检索                   ├─→ RRF 融合 ─→ 文件级去重 ─→ top-k
             找精确标识符/flag/错误串         ┘
```

**为什么要两路**：向量擅长「中文问 → 英文答」的语义匹配，但会把 `gbp-suspension-recovery` 这种标识符模糊掉；BM25 反过来。两者分数不可比，所以用 RRF（倒数排名融合）只信排名，不信分数。

**文件级融合**：直接在分块层面融合会崩——一个长 skill（如 `yt-story-script`）贡献几十个近似分块，把结果槽位占满，真正该出现的文件被挤到 300 名开外。所以先把每个文件收敛成它最好的一跳，再融合。

**索引文件降权**：`skills/INDEX.md` 和各个 `README.md` 是中文、关键词密集、列了每个 skill 的描述，几乎能命中任何中文提问，曾经霸占 rank 1 把正确答案挤出前十。它们是地图不是答案，所以降权而非删除——真没别的结果时它们仍会出现。

## 文件

| 文件 | 作用 |
|---|---|
| `build-index.mjs` | 建索引：遍历 → 分块 → 向量 → 落盘（增量，按内容哈希复用） |
| `server.mjs` | MCP stdio 服务器，暴露三个工具 |
| `kb.mjs` | 命令行检索前端 |
| `eval.mjs` | 检索质量评测（20 条真实用例 + MRR） |
| `smoke.mjs` | MCP 协议冒烟测试（JSON-RPC 握手 + 三个工具） |
| `lib/chunk.mjs` | Markdown 分块器 |
| `lib/tokenize.mjs` | 中英混合分词（中文二元组 + camelCase 拆解） |
| `lib/search.mjs` | 混合检索核心 |
| `lib/walk.mjs` | 遍历规则与分类 |
| `index/` | 生成物：`chunks.jsonl` + `vectors.f32` + `manifest.json` |

## 维护

```bash
cd knowledge/.kb

node eval.mjs              # 改完检索逻辑先跑这个，看有没有变差
node eval.mjs --verbose    # 看 miss 的详情

node build-index.mjs       # 增量重建（改了 vault 内容后）
node build-index.mjs --force  # 全量重建（改了分块/嵌入逻辑后）
```

改完 vault 内容（`sync-skills.sh` / `sync-github.sh` 之后）需要重建索引，否则 `kb_status` 会报 `STALE`。

全量重建约 2 小时（e5-large q8 + 24754 分块，3.3 chunks/s）。**增量重建很快**：只对内容哈希变过的分块重新嵌入。

## 当前实测分数

```
exact 10/20   family-inclusive 18/20   MRR 0.537   avg 102ms/query
```

- **exact**：top-10 里出现「最佳答案」那个文件
- **family-inclusive**：把「同主题但非最佳」也算命中（例如问字幕，命中 yt-story-script 也算找到地方了）
- 两个数字的差距（10 vs 18）说明：**模型很擅长找对领域，但选不出该领域里最专业的那个文件**

精确标识符查询（`gbp-suspension-recovery`、`asc-submission-health`）稳定 hit@1。中文口语化提问是弱项——原因见下面第 5 条，是模型能力上限，不是管线 bug。

## 踩过的坑（改代码前先读）

1. **中文分词不能按字算 token**。最初按「CJK 一字一 token」估算分块大小，拿真实 tokenizer 一验，实际是估算值的 1.18–1.69 倍（生僻汉字一字吃 2–3 token），**9% 的分块会被模型静默截断**。现在用实测系数 `TOKEN_FUDGE = 1.45` 校准，残留 0.28%。

2. **frontmatter 的 description 必须进嵌入文本**。skill 的 `description` 列出了用户真正会说的触发词（"write blog" / "protect a form from bots"），而正文用的是 skill 自己的词汇。不嵌入它，中文提问就完全检索不到对应 skill。这是提升最大的一处改动（5/18 → 14/20）。

3. **YAML 折叠标量 `description: >` 要多行读取**。只抓第一行会得到 `">"` 这个垃圾值，36 个分块里 32 个存了空描述。

4. **导航文件要「条件降权」，不能一刀切**。`skills/INDEX.md` / `README.md` 是中文、关键词密集，会霸占任何中文提问的 rank 1。但把它们一律降到底，会砸掉「我有哪些仓库」「skill 分几类」这类**本来就该由索引回答**的问题。现在只在查询不是问目录本身时才降权（见 `search.mjs` 的 `META_QUERY`）。改这里之前先想清楚这两类问题的区别。

5. **中文口语 → 英文 skill 是模型能力上限，别指望调参解决**。`怎么防止表单被机器人提交` 问的是 turnstile，但 gold 在 24754 个分块里只排到 dense #213（BM25 >400，零词面重叠）。实测过两条路都不通：
   - **换更大的模型**：e5-base 和 e5-small 都是 4/5 分离度，e5-large 才 5/5——但那是拿手写的理想描述测的，真实语料上仍有 2/20 失败。
   - **加 cross-encoder 重排**：`ms-marco-MiniLM-L-6-v2` 是纯英文模型，中文 query 直接出分布外，会给**错误**答案更高的分（-8.00 vs 正确答案 -8.69）。**加它只会更糟，不要加。**

6. **模型/dtype 必须和索引一致**。不同模型或不同量化精度的向量互相比对不报错，只是结果变成噪声。`search.mjs` 里现在有硬校验，`manifest.json` 记录了 `model` 和 `dtype`。

7. **失败的加载不能缓存**。MCP 服务器比索引活得久：它在索引重建期间启动会看到「no index」，如果把这个 rejection 缓存下来，工具就永久坏死到手动重启。现在失败时清空缓存，下次调用重试。

## 为什么选 q8 而不是 fp32

实测同一组 gold-vs-junk 对比：q8 保持 **5/5 分离度**，margin 0.0050 对 fp32 的 0.0059（几乎无差），但吞吐 **12.2 vs 4.5 chunks/s**。fp32 建一次要 5 小时，q8 只要 2 小时。要换回 fp32：`KB_DTYPE=fp32 node build-index.mjs --force`（索引和查询会自动跟随 manifest）。

## 边界

- 只索引 Markdown。`skills/vault/` 里的图片、模板工程、二进制文件不收。
- `knowledge/.kb/` 自己、`.git`、`.obsidian`、`node_modules` 被排除。
- 仓库里的 skill 正文是**已打码**版本（见 `skills/_quarantine.txt`）。需要真实密钥值请回源目录 `~/Desktop/skill-knowledge-base`，不要从这里读。
