# 知识库检索：同一句问话的前后对比

仓库：<https://github.com/alex-zz7/deepseek-harness>  
本文：<https://github.com/alex-zz7/deepseek-harness/blob/main/docs/knowledge-retrieve.md>

问句：

```
Gptimage skill 原理？
```

库里一直有 `skills/vault/07-视频-PPT-设计/gptimage2/SKILL.md`。差别只在检索怎么走。

## 改之前（平铺混合检索）

把 2.5 万段正文摊开，向量 + BM25 融合后塞 8 段，并禁止再读文件。

| 环节 | 结果 |
|---|---|
| 词面 | 问句是 `gptimage`，文件名是 `gptimage2`，BM25 整份 0 命中 |
| 向量 | `gptimage2/SKILL.md` 排到 dense 第 3 |
| 融合 | 只有向量一票，被「skill / 原理」这类常见词的双路文档挤出前 8 |
| 模型看到的 | follow-builders、proma-coach、guizang-ppt-skill 等无关段落 |
| 回答 | 「本库没有讲原理」，或只能转述别人 skill 里「用 GPT-Image 配图」的一句 |

浏览器里的原始 dsh **不走这套知识库检索**，只能靠会话技能摘要，答案更散，对不上那份正文。

## 改之后（先认文档，再读正文）

先对文档卡片（标题 / 别名 / 描述）解析，认准了只打开那一份。

同一句 `Gptimage skill 原理？`：

| 环节 | 结果 |
|---|---|
| 解析 | `Gptimage` → `gptimage2`（去版本号 + 别名） |
| 检索范围 | 只有 `gptimage2/SKILL.md` |
| 模型看到的 | 异步任务、轮询、`--ar` / `--res` / `--ref`、提交与取图 |
| 回答 | 能讲原理：不是同步出图，而是 submit → poll `/v1/tasks/{id}` → 下载；参数怎么映射；两个常见坑（key 未进子进程、不要走已废弃的 `/v1/images/generations`） |

App 知识库对话走这条。设置里可以看到本页地址。

## 和「怎么做某件事」的区别

`怎么用 Cloudflare 部署 Worker`、`怎么写博客` 不会被钉死在碰巧叫 cloudflare / blog 的文件上。两份卡片分数接近，或问的是做法而不是「这一份是什么」，就退回全文混合检索。

手册、项目页也是同一层：`alexsignal 是什么` 认到 `github/projects/alexsignal.md`，不必文件名一字不差。

## 怎么复现

```bash
cd knowledge/.kb
node kb.mjs "Gptimage skill 原理？" -k 3
# intent=skill resolved=gptimage2
# 命中 skills/vault/07-视频-PPT-设计/gptimage2/SKILL.md
```

指定 `--kind` 或 `--raw` 仍是旧的平铺检索，可用来对照。
